-- MANUAL ONLY: after Attendance requests/recurrence and Team Management V2.
-- No roster backfill occurs during migration. Run the leadership sync explicitly.
begin;
alter table public.team_meetings drop constraint team_meetings_requirement_check;
alter table public.team_meetings add constraint team_meetings_requirement_check
 check(requirement in ('active','registered','areas','selected','optional'));
create or replace function public.team_attendance_manage(action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; a public.team_attendance; s public.team_attendance_strikes;
 mid uuid; code text; target text; uid uuid; result jsonb;
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501'; end if;
 -- Serializes leadership mutations, including roster snapshots.
 perform pg_advisory_xact_lock(4418,10);
 if action='member' then
 uid:=(p->>'student_id')::uuid;
 if not exists(select 1 from public.profiles where id=uid and active and role::text in ('student','lead')) then raise exception 'Active student or lead required'; end if;
 insert into public.team_attendance_members(student_id,member_status,team_area) values(uid,p->>'member_status',trim(coalesce(p->>'team_area','')))
 on conflict(student_id) do update set member_status=excluded.member_status,team_area=excluded.team_area;
 return '{}'::jsonb;
 elsif action='create' then
 if p->>'requirement'='areas' and jsonb_array_length(coalesce(p->'areas','[]'))=0 then raise exception 'Select at least one area'; end if;
 if p->>'requirement'='selected' and jsonb_array_length(coalesce(p->'selected_students','[]'))=0 then raise exception 'Select at least one student'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p->'selected_students','[]')) v where not exists(
 select 1 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where pr.id=v::uuid and pr.active and pr.role::text in ('student','lead') and coalesce(mem.member_status,'prospective')<>'inactive')) then raise exception 'Selected student is unavailable'; end if;
 insert into public.team_meetings(title,meeting_type,starts_at,ends_at,late_minutes,requirement,areas,selected_students,created_by)
 values(trim(p->>'title'),p->>'meeting_type',(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,
 coalesce((p->>'late_minutes')::integer,10),coalesce(p->>'requirement','active'),array(select jsonb_array_elements_text(coalesce(p->'areas','[]'))),
 array(select jsonb_array_elements_text(coalesce(p->'selected_students','[]'))::uuid),auth.uid()) returning * into m;
 insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
 select m.id,pr.id,case m.requirement when 'active' then true when 'registered' then coalesce(mem.member_status,'prospective')='registered'
 when 'areas' then coalesce(mem.member_status,'prospective')='registered' and coalesce(mem.team_area,'')=any(m.areas)
 when 'selected' then pr.id=any(m.selected_students) else false end,coalesce(mem.member_status,'prospective'),coalesce(mem.team_area,'')
 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where pr.active and pr.role::text in ('student','lead') and coalesce(mem.member_status,'prospective')<>'inactive';
 insert into public.team_attendance(meeting_id,student_id,review_status) select meeting_id,student_id,case when required then 'none' else 'not_required' end from public.team_meeting_members where meeting_id=m.id;
 -- Audit the immutable required roster as part of meeting creation.
 insert into team_attendance_private.history(meeting_id,entity,entity_id,action,after_data,performed_by)
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
 if action='attendance' then
 if a.version is distinct from (p->>'version')::integer then raise exception 'Attendance changed. Refresh and try again.'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'A correction/review explanation is required'; end if;
 target:=coalesce(p->>'physical_status',a.physical_status);
 if m.status='finalized' and target='pending' then raise exception 'Finalized attendance cannot be pending'; end if;
 if target='left_early' and (nullif(p->>'left_at','') is null or (p->>'left_at')::timestamptz>=m.ends_at or (p->>'left_at')::timestamptz<m.starts_at) then raise exception 'Departure must be during the meeting, before its end'; end if;
 update public.team_attendance set physical_status=target,review_status=coalesce(p->>'review_status',review_status),
 left_at=case when target='left_early' then (p->>'left_at')::timestamptz else null end,
 review_reason=trim(p->>'explanation'),reviewed_by=auth.uid(),reviewed_at=now(),version=version+1 where id=a.id;
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
end $$;


-- Applies to all future broad-roster occurrences, including existing series.
-- Recurrence currently has no persisted series ID; never infer it from titles.
create function public.team_attendance_sync_future_rosters() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; candidate record; mm public.team_meeting_members;
 a public.team_attendance; before_snapshot jsonb; added integer:=0; promoted integer:=0; skipped integer:=0;
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(4418,10);
 for m in select * from public.team_meetings where starts_at>clock_timestamp()
 and status<>'finalized' and requirement in ('active','registered') order by starts_at,id for update loop
  -- Recheck time after waiting for the meeting lock.
  if m.starts_at<=clock_timestamp() or m.status='finalized' then continue;end if;
  for candidate in select p.id,coalesce(r.member_status,'prospective') member_status,coalesce(r.team_area,'') team_area
   from public.profiles p left join public.team_attendance_members r on r.student_id=p.id
   where p.active and p.role::text in ('student','lead') and coalesce(r.member_status,'prospective')<>'inactive'
   and (m.requirement='active' or r.member_status='registered') order by p.id loop
   select * into mm from public.team_meeting_members where meeting_id=m.id and student_id=candidate.id for update;
   if m.starts_at<=clock_timestamp() then exit;end if;
   if not found then
    insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
    values(m.id,candidate.id,true,candidate.member_status,candidate.team_area) returning * into mm;
    insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,candidate.id,'none');
    insert into team_attendance_private.history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
    values(m.id,candidate.id,'team_meeting_members',candidate.id::text,'ROSTER_SYNC_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
    added:=added+1;
   elsif not mm.required then
    select * into a from public.team_attendance where meeting_id=m.id and student_id=candidate.id for update;
    if m.starts_at<=clock_timestamp() then exit;end if;
    -- Upgrade only untouched optional entries. Preserve requests, reviews and check-ins.
    if not found or a.physical_status<>'pending' or a.review_status<>'not_required'
     or a.notice_at is not null or a.reviewed_at is not null or a.checked_in_at is not null
     or a.left_at is not null or a.version<>1 then skipped:=skipped+1;continue;end if;
    before_snapshot:=to_jsonb(mm)-'attempts'-'attempt_window';
    update public.team_meeting_members set required=true,member_status=candidate.member_status,team_area=candidate.team_area
     where meeting_id=m.id and student_id=candidate.id returning * into mm;
    update public.team_attendance set review_status='none',version=version+1 where id=a.id;
    insert into team_attendance_private.history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
    values(m.id,candidate.id,'team_meeting_members',candidate.id::text,'ROSTER_SYNC_REQUIRE',before_snapshot,to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
    promoted:=promoted+1;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('added',added,'promoted',promoted,'skipped',skipped);
end $$;
revoke all on function public.team_attendance_sync_future_rosters() from public,anon,authenticated;
grant execute on function public.team_attendance_sync_future_rosters() to authenticated;
commit;
