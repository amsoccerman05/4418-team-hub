-- Automatic absence strikes start only when leadership newly finalizes a meeting.
-- No historical backfill, data corrections, role changes, parent contact, or
-- removal action. Existing audit/notification triggers keep their actor contract.
begin;

alter table public.team_meetings
 add column auto_absence_strikes_enabled boolean not null default false;
alter table public.team_attendance_strikes
 add column source text not null default 'manual'
 check(source in ('manual','automatic_absence'));
alter table public.team_attendance_strikes add constraint automatic_absence_strike_shape
 check(source<>'automatic_absence' or (category='Unexcused Absence' and quantity=1));
-- Retain the record after rescission: a human override is never silently undone.
create unique index team_one_automatic_absence_strike
 on public.team_attendance_strikes(attendance_id) where source='automatic_absence';
grant select(auto_absence_strikes_enabled) on public.team_meetings to authenticated;

-- Private, SECURITY INVOKER helper: only the already-authorized management RPC
-- can reach it. It never accepts an actor ID or changes access permissions.
create function team_attendance_private.reconcile_absence_strike(attendance_id uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare a public.team_attendance; m public.team_meetings; is_required boolean; eligible boolean; n integer;
begin
 if auth.uid() is null or not (team_attendance_private.manager() or team_attendance_private.reviewer()) then
  raise exception 'Leadership access required' using errcode='42501';
 end if;
 select * into a from public.team_attendance where id=$1 for update;
 if not found then raise exception 'Attendance record not found';end if;
 select * into m from public.team_meetings where id=a.meeting_id;
 if m.status<>'finalized' or not m.auto_absence_strikes_enabled then return 0;end if;
 select required into is_required from public.team_meeting_members
 where meeting_id=a.meeting_id and student_id=a.student_id;
 eligible:=coalesce(is_required,false) and a.physical_status='absent' and a.review_status in ('none','denied');
 if not eligible then
  update public.team_attendance_strikes set rescinded_by=auth.uid(),rescinded_at=now(),
   rescind_reason='Automatic absence strike rescinded after attendance or excuse correction.'
  where team_attendance_strikes.attendance_id=a.id and source='automatic_absence' and rescinded_at is null;
  get diagnostics n=row_count;
  return -n;
 end if;
 -- Any earlier automatic incident or human absence decision, including a
 -- rescission, is authoritative. Other manual categories do not block this one.
 if exists(select 1 from public.team_attendance_strikes st where st.attendance_id=a.id
  and (st.source='automatic_absence' or lower(trim(st.category))='unexcused absence')) then return 0;end if;
 insert into public.team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by,source)
 values(a.id,a.student_id,a.meeting_id,'Unexcused Absence',1,
  'Automatic strike for a required unexcused absence after attendance completion.',auth.uid(),'automatic_absence');
 return 1;
end $$;
revoke all on function team_attendance_private.reconcile_absence_strike(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.team_attendance_manage(action text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.team_meetings; a public.team_attendance; s public.team_attendance_strikes;
 mid uuid; code text; target text; uid uuid; result jsonb;
 automatic_count integer:=0; changed integer:=0; automatic_ids jsonb;
begin
 if not (team_attendance_private.manager() or (team_attendance_private.reviewer() and action in ('attendance','strike','rescind'))) then raise exception 'Leadership access required' using errcode='42501'; end if;
 -- Serializes leadership mutations, including roster snapshots.
 perform pg_advisory_xact_lock(4418,10);
 if not (team_attendance_private.manager() or (team_attendance_private.reviewer() and action in ('attendance','strike','rescind'))) then raise exception 'Leadership access required' using errcode='42501'; end if;
 if action='member' then
 uid:=(p->>'student_id')::uuid;
 if not team_attendance_private.is_participant(uid) then raise exception 'Active Attendance participant required'; end if;
 insert into public.team_attendance_members(student_id,member_status,team_area) values(uid,p->>'member_status',trim(coalesce(p->>'team_area','')))
 on conflict(student_id) do update set member_status=excluded.member_status,team_area=excluded.team_area;
 return '{}'::jsonb;
 elsif action='create' then
 if p->>'requirement'='areas' and jsonb_array_length(coalesce(p->'areas','[]'))=0 then raise exception 'Select at least one area'; end if;
 if p->>'requirement'='selected' and jsonb_array_length(coalesce(p->'selected_students','[]'))=0 then raise exception 'Select at least one student'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p->'selected_students','[]')) v where not exists(
 select 1 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where pr.id=v::uuid and team_attendance_private.is_participant(pr.id) and coalesce(mem.member_status,'prospective')<>'inactive')) then raise exception 'Selected student is unavailable'; end if;
 insert into public.team_meetings(title,meeting_type,starts_at,ends_at,late_minutes,requirement,areas,selected_students,created_by)
 values(trim(p->>'title'),p->>'meeting_type',(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,
 5,coalesce(p->>'requirement','active'),array(select jsonb_array_elements_text(coalesce(p->'areas','[]'))),
 array(select jsonb_array_elements_text(coalesce(p->'selected_students','[]'))::uuid),auth.uid()) returning * into m;
 insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
 select m.id,pr.id,case m.requirement when 'active' then true when 'registered' then coalesce(mem.member_status,'prospective')='registered'
 when 'areas' then coalesce(mem.member_status,'prospective')='registered' and coalesce(mem.team_area,'')=any(m.areas)
 when 'selected' then pr.id=any(m.selected_students) else false end,coalesce(mem.member_status,'prospective'),coalesce(mem.team_area,'')
 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where team_attendance_private.is_participant(pr.id) and coalesce(mem.member_status,'prospective')<>'inactive';
 insert into public.team_attendance(meeting_id,student_id,review_status) select meeting_id,student_id,case when required then 'none' else 'not_required' end from public.team_meeting_members where meeting_id=m.id;
 -- Audit the initial required roster using the existing production history table.
 insert into public.team_attendance_history(meeting_id,entity,entity_id,action,after_data,performed_by)
 select m.id,'team_meeting_members',m.id::text,'SNAPSHOT',coalesce(jsonb_agg(to_jsonb(mm)-'attempts'-'attempt_window'),'[]'),auth.uid() from public.team_meeting_members mm where mm.meeting_id=m.id;
 return jsonb_build_object('id',m.id);
 end if;
 mid:=(p->>'meeting_id')::uuid;
 select * into m from public.team_meetings where id=mid for update;
 if not found then raise exception 'Meeting not found'; end if;
 if action in ('open','close','finalize') then
 if m.version is distinct from (p->>'version')::integer then raise exception 'Meeting changed. Refresh and try again.'; end if;
 if m.status='finalized' then raise exception 'Meeting is finalized'; end if;
 if action='open' then
 if now()<m.starts_at-interval '30 minutes' or now()>=m.ends_at then raise exception 'Check-in opens from 30 minutes before start until the scheduled end'; end if;
 loop
 code:=lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%1000000)::text,6,'0');
 exit when sha256(convert_to(m.id::text||code,'UTF8')) is distinct from m.code_hash;
 end loop;
 update public.team_meetings set status='open',check_in_open=true,code_hash=sha256(convert_to(id::text||code,'UTF8')),
 code_expires_at=least(now()+interval '30 minutes',ends_at),version=version+1 where id=mid;
 return jsonb_build_object('code',code,'expires_at',least(now()+interval '30 minutes',m.ends_at));
 elsif action='close' then
 if clock_timestamp()<m.starts_at-interval '30 minutes' then raise exception 'Check-in window has not started';end if;
 if m.status not in ('draft','open') then raise exception 'Only a draft or open meeting can be closed'; end if;
 update public.team_meetings set status='closed',check_in_open=false,code_hash=null,code_expires_at=null,version=version+1 where id=mid;
 else
 if m.status<>'closed' or now()<m.ends_at then raise exception 'Close check-in and wait until the scheduled end before finalizing'; end if;
 -- Require the current UI consequence preview. Old clients fail safely instead
 -- of silently opting a meeting into a newly consequential policy.
 select count(*),coalesce(jsonb_agg(att.id::text order by att.id::text),'[]'::jsonb)
 into automatic_count,automatic_ids from public.team_attendance att
 join public.team_meeting_members mm on mm.meeting_id=att.meeting_id and mm.student_id=att.student_id
 where att.meeting_id=mid and mm.required and att.physical_status in ('pending','absent')
 and att.review_status in ('none','denied') and not exists(
  select 1 from public.team_attendance_strikes st where st.attendance_id=att.id
  and (st.source='automatic_absence' or lower(trim(st.category))='unexcused absence'));
 if jsonb_typeof(p->'automatic_absence_strike_attendance_ids') is distinct from 'array' then
  raise exception 'Automatic absence strike preview changed or is missing. Refresh and review before completing attendance';
 end if;
 if (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(p->'automatic_absence_strike_attendance_ids') v) is distinct from automatic_ids
 or jsonb_typeof(p->'automatic_absence_strike_count') is distinct from 'number'
 or (p->>'automatic_absence_strike_count')::numeric is distinct from automatic_count::numeric then
  raise exception 'Automatic absence strike preview changed or is missing. Refresh and review before completing attendance';
 end if;
 update public.team_attendance att set physical_status='absent',version=att.version+1 from public.team_meeting_members mm
 where att.meeting_id=mid and mm.meeting_id=att.meeting_id and mm.student_id=att.student_id and mm.required and att.physical_status='pending';
 -- Only this new finalization opts in. Existing finalized meetings keep false,
 -- even when their attendance or excuse decisions are later corrected.
 update public.team_meetings set status='finalized',auto_absence_strikes_enabled=true,
 check_in_open=false,code_hash=null,code_expires_at=null,version=version+1 where id=mid;
 for a in select * from public.team_attendance where meeting_id=mid order by id for update loop
  changed:=changed+team_attendance_private.reconcile_absence_strike(a.id);
 end loop;
 return jsonb_build_object('automatic_absence_strikes',changed);
 end if;
 return '{}'::jsonb;
 end if;
 select * into a from public.team_attendance where id=(p->>'attendance_id')::uuid and meeting_id=mid for update;
 if not found then raise exception 'Attendance record not found'; end if;
 if action in ('strike','rescind') and not team_attendance_private.reviewer() then raise exception 'Mentor or active Program Manager required' using errcode='42501';end if;
 if action='attendance' then
 if p ? 'review_status' and (not team_attendance_private.request_reviewer() or a.student_id=auth.uid()) then raise exception 'Another active Lead Coach or Program Manager must review this request' using errcode='42501';end if;
 if p ? 'review_status' and not team_attendance_private.can_review_request(a.student_id) then raise exception 'A non-Program-Manager Lead Coach must review Program Manager attendance requests' using errcode='42501';end if;
 if not team_attendance_private.manager() and (p ? 'physical_status' or nullif(p->>'left_at','')::timestamptz is distinct from a.left_at) then raise exception 'Meeting leadership required for physical attendance corrections' using errcode='42501';end if;
 if a.version is distinct from (p->>'version')::integer then raise exception 'Attendance changed. Refresh and try again.'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'A correction/review explanation is required'; end if;
 target:=coalesce(p->>'physical_status',a.physical_status);
 if m.status='finalized' and target='pending' then raise exception 'Finalized attendance cannot be pending'; end if;
 if target='left_early' and (nullif(p->>'left_at','') is null or (p->>'left_at')::timestamptz>=m.ends_at or (p->>'left_at')::timestamptz<m.starts_at) then raise exception 'Departure must be during the meeting, before its end'; end if;
 update public.team_attendance set physical_status=target,review_status=coalesce(p->>'review_status',review_status),
 left_at=case when not (p ? 'physical_status') then a.left_at when target='left_early' then (p->>'left_at')::timestamptz else null end,
 review_reason=case when p ? 'review_status' then trim(p->>'explanation') else review_reason end,
 reviewed_by=case when p ? 'review_status' then auth.uid() else reviewed_by end,
 reviewed_at=case when p ? 'review_status' then now() else reviewed_at end,version=version+1 where id=a.id;
 -- Preserve physical-correction reasons without impersonating an excuse review.
 if not (p ? 'review_status') then
  insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
  values(mid,a.student_id,'team_attendance',a.id::text,'CORRECTION_NOTE',jsonb_build_object('explanation',trim(p->>'explanation')),auth.uid());
 end if;
 -- Reconcile only policy-enabled meetings, only the automatic source. Manual
 -- strikes and historic meetings remain unchanged by attendance corrections.
 changed:=team_attendance_private.reconcile_absence_strike(a.id);
 result:=jsonb_build_object('automatic_absence_strikes',greatest(changed,0),
  'automatic_absence_strikes_rescinded',greatest(-changed,0));
 elsif action='strike' then
 if lower(trim(p->>'category'))='unexcused absence' and exists(
  select 1 from public.team_attendance_strikes st where st.attendance_id=a.id
  and st.source='automatic_absence' and st.rescinded_at is null) then
  raise exception 'An automatic absence strike already exists. Review or rescind it before assigning a replacement';
 end if;
 insert into public.team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by)
 values(a.id,a.student_id,a.meeting_id,p->>'category',(p->>'quantity')::integer,trim(p->>'explanation'),auth.uid());
 elsif action='rescind' then
 select * into s from public.team_attendance_strikes where id=(p->>'strike_id')::uuid and attendance_id=a.id for update;
 if not found or s.rescinded_at is not null then raise exception 'Active strike not found'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'Rescind reason is required'; end if;
 update public.team_attendance_strikes set rescinded_by=auth.uid(),rescinded_at=now(),rescind_reason=trim(p->>'explanation') where id=s.id;
 else raise exception 'Unknown attendance action'; end if;
 return coalesce(result,'{}'::jsonb);
end $function$;


commit;
