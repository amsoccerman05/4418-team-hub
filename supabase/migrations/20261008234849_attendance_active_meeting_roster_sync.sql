-- Extend leadership roster sync through the scheduled end of an open/draft meeting.
-- Existing RPC names remain compatible with already deployed clients.
-- No backfill runs here; leadership must explicitly invoke either sync RPC.
-- Closed/finalized/ended meetings, student RLS, check-in windows/codes, late
-- classification, reviewer authority, audit schema and existing records are unchanged.
begin;

create or replace function public.team_attendance_sync_future_rosters() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; candidate record; mm public.team_meeting_members;
 a public.team_attendance; before_snapshot jsonb; added integer:=0; promoted integer:=0; skipped integer:=0;
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(4418,10);
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 for m in select * from public.team_meetings where ends_at>clock_timestamp()
 and status in ('draft','open') and requirement in ('active','registered') order by starts_at,id for update loop
  -- Recheck the end boundary after waiting for the meeting lock.
  if m.ends_at<=clock_timestamp() or m.status not in ('draft','open') then continue;end if;
  for candidate in select p.id,coalesce(r.member_status,'prospective') member_status,coalesce(r.team_area,'') team_area
   from public.profiles p left join public.team_attendance_members r on r.student_id=p.id
   where team_attendance_private.is_participant(p.id) and coalesce(r.member_status,'prospective')<>'inactive'
   and (m.requirement='active' or r.member_status='registered') order by p.id loop
   select * into mm from public.team_meeting_members where meeting_id=m.id and student_id=candidate.id for update;
   if m.ends_at<=clock_timestamp() then exit;end if;
   if not team_attendance_private.is_participant(candidate.id) then continue;end if;
   if not found then
    insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
    values(m.id,candidate.id,true,candidate.member_status,candidate.team_area) returning * into mm;
    insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,candidate.id,'none');
    insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
    values(m.id,candidate.id,'team_meeting_members',candidate.id::text,'ROSTER_SYNC_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
    added:=added+1;
   elsif not mm.required then
    select * into a from public.team_attendance where meeting_id=m.id and student_id=candidate.id for update;
    if m.ends_at<=clock_timestamp() then exit;end if;
    if not team_attendance_private.is_participant(candidate.id) then continue;end if;
    -- Upgrade only untouched optional entries. Preserve requests, reviews and check-ins.
    if not found or a.physical_status<>'pending' or a.review_status<>'not_required'
     or a.notice_at is not null or a.reviewed_at is not null or a.checked_in_at is not null
     or a.left_at is not null or a.version<>1 then skipped:=skipped+1;continue;end if;
    before_snapshot:=to_jsonb(mm)-'attempts'-'attempt_window';
    update public.team_meeting_members set required=true,member_status=candidate.member_status,team_area=candidate.team_area
     where meeting_id=m.id and student_id=candidate.id returning * into mm;
    update public.team_attendance set review_status='none',version=version+1 where id=a.id;
    insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
    values(m.id,candidate.id,'team_meeting_members',candidate.id::text,'ROSTER_SYNC_REQUIRE',before_snapshot,to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
    promoted:=promoted+1;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('added',added,'promoted',promoted,'skipped',skipped);
end $$;

-- Explicitly scoped alternative for a roster repair. Never infer a
-- series or synchronize other participants. The caller supplies the verified
-- meeting IDs; all targets are validated before any snapshot is changed.
create or replace function team_attendance_private.sync_participant_rosters(student_id uuid, meeting_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target_id uuid:=$1; targets uuid[]:=$2; m public.team_meetings;
 candidate record; mm public.team_meeting_members; a public.team_attendance;
 before_snapshot jsonb; added integer:=0; promoted integer:=0; skipped integer:=0;
begin
 if target_id is null or targets is null or cardinality(targets) not between 1 and 52
  or array_position(targets,null) is not null
  or (select count(distinct v) from unnest(targets) v)<>cardinality(targets) then
  raise exception 'One participant and 1 to 52 distinct meeting IDs are required';
 end if;
 perform pg_advisory_xact_lock(4418,10);
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
 if not team_attendance_private.is_participant(target_id) then raise exception 'Active Attendance participant required' using errcode='42501';end if;
 select p.id,coalesce(r.member_status,'prospective') member_status,coalesce(r.team_area,'') team_area
 into candidate from public.profiles p left join public.team_attendance_members r on r.student_id=p.id where p.id=target_id;
 if candidate.member_status='inactive' then raise exception 'Attendance membership is inactive';end if;
 if (select count(*) from public.team_meetings where id=any(targets))<>cardinality(targets) then raise exception 'Meeting not found';end if;
 -- Lock and preflight the whole explicit list before writing anything.
 for m in select * from public.team_meetings where id=any(targets) order by id for update loop
  if m.ends_at<=clock_timestamp() or m.status not in ('draft','open') or m.requirement not in ('active','registered') then
   raise exception 'Only future or in-progress draft/open active or registered meetings can be synchronized';
  end if;
  if m.requirement='registered' and candidate.member_status<>'registered' then
   raise exception 'Registered Attendance membership is required for every selected registered meeting';
  end if;
 end loop;
 for m in select * from public.team_meetings where id=any(targets) order by id loop
  select * into mm from public.team_meeting_members x where x.meeting_id=m.id and x.student_id=target_id for update;
  if m.ends_at<=clock_timestamp() then raise exception 'A selected meeting has ended';end if;
  if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
  if not team_attendance_private.is_participant(target_id) then raise exception 'Active Attendance participant required' using errcode='42501';end if;
  if not found then
   insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
   values(m.id,target_id,true,candidate.member_status,candidate.team_area) returning * into mm;
   insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,target_id,'none');
   insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
   values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_SYNC_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
   added:=added+1;
  elsif not mm.required then
   select * into a from public.team_attendance x where x.meeting_id=m.id and x.student_id=target_id for update;
   if m.ends_at<=clock_timestamp() then raise exception 'A selected meeting has ended';end if;
   if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501';end if;
   if not team_attendance_private.is_participant(target_id) then raise exception 'Active Attendance participant required' using errcode='42501';end if;
   -- Identical preservation rule to the existing no-argument sync.
   if not found or a.physical_status<>'pending' or a.review_status<>'not_required'
    or a.notice_at is not null or a.reviewed_at is not null or a.checked_in_at is not null
    or a.left_at is not null or a.version<>1 then skipped:=skipped+1;continue;end if;
   before_snapshot:=to_jsonb(mm)-'attempts'-'attempt_window';
   update public.team_meeting_members x set required=true,member_status=candidate.member_status,team_area=candidate.team_area
    where x.meeting_id=m.id and x.student_id=target_id returning * into mm;
   update public.team_attendance set review_status='none',version=version+1 where id=a.id;
   insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
   values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_SYNC_REQUIRE',before_snapshot,to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
   promoted:=promoted+1;
  end if;
 end loop;
 return jsonb_build_object('student_id',target_id,'meeting_ids',to_jsonb(targets),'added',added,'promoted',promoted,'skipped',skipped);
end $$;

revoke all on function team_attendance_private.sync_participant_rosters(uuid,uuid[]) from public,anon,authenticated;

revoke all on function public.team_attendance_sync_future_rosters() from public,anon,authenticated;
grant execute on function public.team_attendance_sync_future_rosters() to authenticated;
commit;
