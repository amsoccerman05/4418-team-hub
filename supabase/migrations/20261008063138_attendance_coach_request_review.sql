-- Narrow Attendance request review and request-review notifications only.
-- Apply after the PM participation and notification-routing migrations.
-- Preserve shared roles, legacy strike/read/meeting capabilities, audit schema,
-- historical requests and decisions. No profile, position or roster backfill.
begin;

-- Coach assignment narrows existing mentor review eligibility. A coach position
-- alone does not grant review powers to another shared role. PM eligibility uses
-- the existing Attendance predicate and its supported active-account roles.
create function team_attendance_private.is_lead_coach(member_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p
 join public.team_member_positions mp on mp.user_id=p.id and mp.revoked_at is null
 join public.team_positions tp on tp.key=mp.position_key and tp.active
 where p.id=member_id and p.active and p.role::text='mentor'
 and tp.key in ('lead_coach_1','lead_coach_2'))
$$;
create function team_attendance_private.request_reviewer(member_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select team_attendance_private.is_lead_coach(member_id)
 or team_attendance_private.is_program_manager(member_id)
$$;

-- The same live check governs mutations, new notification recipients, existing
-- inbox rows and delivery-time eligibility. A dual coach/PM cannot review a PM.
create or replace function team_attendance_private.can_review_request(requester uuid, reviewer uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select requester is not null and reviewer is not null and requester<>reviewer
 and team_attendance_private.request_reviewer(reviewer)
 and (not team_attendance_private.is_program_manager(requester)
 or (team_attendance_private.is_lead_coach(reviewer)
 and not team_attendance_private.is_program_manager(reviewer)))
$$;
revoke all on function team_attendance_private.is_lead_coach(uuid),team_attendance_private.request_reviewer(uuid),team_attendance_private.can_review_request(uuid,uuid) from public,anon,authenticated;

-- Only the review-status guards differ from the preceding participation RPC.
-- They run even when a caller combines review_status with physical corrections.
CREATE OR REPLACE FUNCTION public.team_attendance_manage(action text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.team_meetings; a public.team_attendance; s public.team_attendance_strikes;
 mid uuid; code text; target text; uid uuid; result jsonb;
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
 update public.team_attendance att set physical_status='absent',version=att.version+1 from public.team_meeting_members mm
 where att.meeting_id=mid and mm.meeting_id=att.meeting_id and mm.student_id=att.student_id and mm.required and att.physical_status='pending';
 update public.team_meetings set status='finalized',check_in_open=false,code_hash=null,code_expires_at=null,version=version+1 where id=mid;
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
 elsif action='strike' then
 insert into public.team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by)
 values(a.id,a.student_id,a.meeting_id,p->>'category',(p->>'quantity')::integer,trim(p->>'explanation'),auth.uid());
 elsif action='rescind' then
 select * into s from public.team_attendance_strikes where id=(p->>'strike_id')::uuid and attendance_id=a.id for update;
 if not found or s.rescinded_at is not null then raise exception 'Active strike not found'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'Rescind reason is required'; end if;
 update public.team_attendance_strikes set rescinded_by=auth.uid(),rescinded_at=now(),rescind_reason=trim(p->>'explanation') where id=s.id;
 else raise exception 'Unknown attendance action'; end if;
 return '{}'::jsonb;
end $function$;

-- can_review retains its legacy strike-policy meaning. Request UI must use
-- can_review_requests and the per-request PM/self-review restrictions instead.
create or replace function public.team_attendance_policy_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare boundary timestamptz;
begin
 if coalesce(team_attendance_private.role(),'') not in ('student','lead','mentor','admin') then raise exception 'Active Attendance account required' using errcode='42501';end if;
 -- User-approved annual reset: January 1, using the database UTC calendar.
 boundary:=date_trunc('year',now() at time zone 'UTC') at time zone 'UTC';
 return jsonb_build_object('user_id',auth.uid(),'can_participate',team_attendance_private.participant(),'can_review',team_attendance_private.reviewer(),'can_review_requests',team_attendance_private.request_reviewer(),'can_read_team',team_attendance_private.reader(),'can_manage_meetings',team_attendance_private.manager(),'strike_year_start',boundary,
 'can_review_program_manager_requests',team_attendance_private.is_lead_coach(auth.uid()) and not team_attendance_private.is_program_manager(auth.uid()),
 'mentor_review_required_for',case when team_attendance_private.reader() then (select coalesce(jsonb_agg(p.id),'[]'::jsonb) from public.profiles p where team_attendance_private.is_program_manager(p.id)) else '[]'::jsonb end,
 'people',case when team_attendance_private.reader() then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'role',p.role,'positions',(select coalesce(jsonb_agg(tp.name),'[]') from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active where mp.user_id=p.id and mp.revoked_at is null))),'[]') from public.profiles p where p.active) else '[]'::jsonb end,
 'warnings',(select coalesce(jsonb_agg(jsonb_build_object('student_id',h.student_id,'at',h.performed_at,'actor',h.performed_by,'note',h.after_data->>'note') order by h.id desc),'[]') from public.team_attendance_history h where h.entity='attendance_policy' and h.action='WARNING_PARENT_CONTACT' and (boundary is null or h.performed_at>=boundary) and (team_attendance_private.reader() or h.student_id=auth.uid())));
end $$;

commit;
