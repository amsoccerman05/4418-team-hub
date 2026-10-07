-- Additive, manual rollout: no existing meeting/attendance/roster/strike rewrite.
-- All edits are restricted to meetings that have not started. Schedule changes
-- also require no physical attendance or reviewed decisions.
begin;
create function team_attendance_private.edit_meeting(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 m public.team_meetings; next_title text; next_type text;
 next_start timestamptz; next_end timestamptz; schedule_changed boolean;
begin
 if auth.uid() is null then raise exception 'Leadership access required' using errcode='42501'; end if;
 -- Match existing Attendance management's lock order, then recheck authority.
 perform pg_advisory_xact_lock(4418,10);
 perform 1 from public.profiles where id=auth.uid() and active
   and role::text in ('lead','mentor','admin') for share;
 if not found then raise exception 'Leadership access required' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Meeting details are required'; end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in
   ('meeting_id','version','title','meeting_type','starts_at','ends_at','acknowledge_schedule_change')) then
   raise exception 'Only title, type, and schedule can be edited. Required rosters and attendance records stay unchanged';
 end if;
 if not (p ?& array['meeting_id','version','title','meeting_type','starts_at','ends_at']) or
   nullif(p->>'version','') is null then raise exception 'Meeting details and version are required'; end if;
 select * into m from public.team_meetings where id=(p->>'meeting_id')::uuid for update;
 if not found then raise exception 'Meeting not found'; end if;
 next_title:=trim(coalesce(p->>'title',''));
 next_type:=p->>'meeting_type';
 if length(next_title) not between 1 and 150 then raise exception 'Enter a title of 1–150 characters'; end if;
 if next_type is null or next_type not in ('offseason','preseason','other') then raise exception 'Choose a meeting type'; end if;
 next_start:=(p->>'starts_at')::timestamptz;
 next_end:=(p->>'ends_at')::timestamptz;
 if next_start is null or next_end is null or not isfinite(next_start) or not isfinite(next_end) or next_end<=next_start then
   raise exception 'End time must be after a valid start time';
 end if;
 schedule_changed:=next_start is distinct from m.starts_at or next_end is distinct from m.ends_at;
 -- An exact retry after a lost response is a read-only acknowledgement, even
 -- with the original version. A different stale draft can never overwrite.
 if next_title=m.title and next_type=m.meeting_type and not schedule_changed then
   return jsonb_build_object('id',m.id,'version',m.version,'changed',false);
 end if;
 if m.version is distinct from (p->>'version')::integer then
   raise exception 'Meeting changed. Refresh and reload the latest meeting before saving.' using errcode='40001';
 end if;
 if m.status='finalized' or clock_timestamp()>=m.starts_at then
   raise exception 'This meeting has started or attendance is complete. Meeting details can only be edited before it starts';
 end if;
 if schedule_changed then
   if next_start<=clock_timestamp() then raise exception 'A rescheduled meeting must start in the future'; end if;
   if exists(select 1 from public.team_attendance where meeting_id=m.id and
     (checked_in_at is not null or left_at is not null or physical_status<>'pending' or
      reviewed_at is not null or review_status in ('excused','denied')))
     or exists(select 1 from public.team_attendance_strikes where meeting_id=m.id) then
     raise exception 'Recorded attendance or reviewed decisions lock this schedule; title and type can still be edited';
   end if;
   if p->'acknowledge_schedule_change' is distinct from 'true'::jsonb then
     raise exception 'Review and acknowledge the schedule change. Existing request times stay unchanged and attendees are not notified';
   end if;
 end if;
 update public.team_meetings set title=next_title,meeting_type=next_type,
   starts_at=next_start,ends_at=next_end,
   check_in_open=case when schedule_changed then false else check_in_open end,
   code_hash=case when schedule_changed then null else code_hash end,
   code_expires_at=case when schedule_changed then null else code_expires_at end,
   version=version+1 where id=m.id;
 -- Existing team_audit trigger atomically records old/new values and actor;
 -- code material remains excluded. No attendance or notification writes.
 return jsonb_build_object('id',m.id,'version',m.version+1,'changed',true);
end $$;
revoke all on function team_attendance_private.edit_meeting(jsonb) from public,anon,authenticated;
grant execute on function team_attendance_private.edit_meeting(jsonb) to authenticated;
create function public.team_attendance_edit_meeting(p jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select team_attendance_private.edit_meeting(p)
$$;
revoke all on function public.team_attendance_edit_meeting(jsonb) from public,anon,authenticated;
grant execute on function public.team_attendance_edit_meeting(jsonb) to authenticated;
commit;
