-- Extends the existing guarded editor for one upcoming occurrence only.
-- Applying this migration rewrites no meeting, roster, attendance or history.
-- Changed rosters become explicit selected/optional lists so broad roster sync
-- cannot silently restore a removed participant. No records are deleted.
begin;
create or replace function team_attendance_private.edit_meeting(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 m public.team_meetings; next_title text; next_type text;
 next_start timestamptz; next_end timestamptz; schedule_changed boolean;
 roster_supplied boolean; roster_changed boolean:=false;
 next_required uuid[]; expected_required uuid[]; current_required uuid[];
 changed_ids uuid[]; target_id uuid; target_required boolean;
 mm public.team_meeting_members; a public.team_attendance;
 candidate record; before_snapshot jsonb; array_key text; expected_version integer;
begin
 if auth.uid() is null then raise exception 'Leadership access required' using errcode='42501'; end if;
 -- Match existing Attendance management's lock order, then recheck authority.
 perform pg_advisory_xact_lock(4418,10);
 perform 1 from public.profiles where id=auth.uid() and active
   and role::text in ('lead','mentor','admin') for share;
 if not found then raise exception 'Leadership access required' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Meeting details are required'; end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in
   ('meeting_id','version','title','meeting_type','starts_at','ends_at','acknowledge_schedule_change',
    'required_student_ids','expected_required_student_ids','acknowledge_roster_change')) then
   raise exception 'Only title, type, schedule, and required participants can be edited';
 end if;
 if not (p ?& array['meeting_id','version','title','meeting_type','starts_at','ends_at']) or
   nullif(p->>'version','') is null then raise exception 'Meeting details and version are required'; end if;
 expected_version:=(p->>'version')::integer;
 if expected_version<1 then raise exception 'A valid meeting version is required'; end if;
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
 roster_supplied:=p ? 'required_student_ids';
 if not roster_supplied and (p ? 'expected_required_student_ids' or p ? 'acknowledge_roster_change') then
   raise exception 'Required participants and the original required roster must be supplied together';
 end if;
 if roster_supplied then
   foreach array_key in array array['required_student_ids','expected_required_student_ids'] loop
     if jsonb_typeof(p->array_key) is distinct from 'array' then raise exception 'Required participant lists must be arrays'; end if;
     if jsonb_array_length(p->array_key)>5000 or exists(select 1 from jsonb_array_elements(p->array_key) v where jsonb_typeof(v)<>'string') then
       raise exception 'Required participant lists must contain valid distinct participant IDs';
     end if;
     if (select count(distinct v::uuid) from jsonb_array_elements_text(p->array_key) v)<>jsonb_array_length(p->array_key) then
       raise exception 'Required participant lists must contain distinct participant IDs';
     end if;
   end loop;
   next_required:=array(select v::uuid from jsonb_array_elements_text(p->'required_student_ids') v order by v::uuid);
   expected_required:=array(select v::uuid from jsonb_array_elements_text(p->'expected_required_student_ids') v order by v::uuid);
   current_required:=array(select student_id from public.team_meeting_members where meeting_id=m.id and required order by student_id);
   roster_changed:=next_required is distinct from current_required;
 end if;
 -- An exact retry after a lost response is a read-only acknowledgement, even
 -- with the original version. A different stale draft can never overwrite.
 if next_title=m.title and next_type=m.meeting_type and not schedule_changed and not roster_changed then
   return jsonb_build_object('id',m.id,'version',m.version,'changed',false);
 end if;
 if m.version is distinct from expected_version then
   raise exception 'Meeting changed. Refresh and reload the latest meeting before saving.' using errcode='40001';
 end if;
 if roster_supplied and expected_required is distinct from current_required then
   raise exception 'Required roster changed. Refresh and reload the latest meeting before saving.' using errcode='40001';
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
 if roster_changed then
   if p->'acknowledge_roster_change' is distinct from 'true'::jsonb then
     raise exception 'Review and acknowledge the required roster change. Only this meeting changes and attendees are not notified';
   end if;
   changed_ids:=array(select v from (
     (select unnest(next_required) v except select unnest(current_required))
     union (select unnest(current_required) v except select unnest(next_required))
   ) changes order by v);
   -- Lock live participant eligibility as well as the meeting. These locks keep
   -- account/enrollment changes from racing the per-person preflight.
   perform 1 from public.profiles where id=any(changed_ids) order by id for share;
   perform 1 from public.team_attendance_members where student_id=any(changed_ids) order by student_id for share;
   perform 1 from public.team_positions where key in ('program_manager','operations_lead') order by key for share;
   perform 1 from public.team_member_positions where user_id=any(changed_ids) order by user_id,position_key for share;
   -- Validate every toggle before writing. Existing ineligible snapshot rows
   -- can stay selected but cannot be silently removed by an incomplete picker.
   foreach target_id in array changed_ids loop
     if not team_attendance_private.is_participant(target_id) or exists(
       select 1 from public.team_attendance_members where student_id=target_id and member_status='inactive'
     ) then raise exception 'A changed participant is unavailable. Refresh the roster; existing unavailable participants must stay unchanged'; end if;
     select * into mm from public.team_meeting_members where meeting_id=m.id and student_id=target_id for update;
     if found then
       select * into a from public.team_attendance where meeting_id=m.id and student_id=target_id for update;
       if not found then raise exception 'Attendance record is missing. Refresh before editing the required roster'; end if;
       if a.notice_at is not null or a.review_status='pending' or a.notice_type is not null
         or a.expected_at is not null or nullif(trim(a.notice_reason),'') is not null then
         raise exception 'An existing attendance request locks this participant’s requirement. Use the normal request review workflow';
       end if;
       if a.checked_in_at is not null or a.left_at is not null or a.physical_status<>'pending'
         or a.reviewed_at is not null or a.reviewed_by is not null or nullif(trim(a.review_reason),'') is not null or a.review_status in ('excused','denied')
         or exists(select 1 from public.team_attendance_strikes where meeting_id=m.id and student_id=target_id) then
         raise exception 'Recorded attendance, reviewed decisions, or strikes lock this participant’s requirement';
       end if;
     end if;
   end loop;
   -- Do not cross the start boundary after waiting for any eligibility/row lock.
   if clock_timestamp()>=m.starts_at or (schedule_changed and next_start<=clock_timestamp()) then
     raise exception 'This meeting has started. Required participants can only be edited before it starts';
   end if;
   foreach target_id in array changed_ids loop
     target_required:=target_id=any(next_required);
     select * into mm from public.team_meeting_members where meeting_id=m.id and student_id=target_id;
     if not found then
       select coalesce(mem.member_status,'prospective') member_status,coalesce(mem.team_area,'') team_area
       into candidate from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id where pr.id=target_id;
       insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
       values(m.id,target_id,true,candidate.member_status,candidate.team_area) returning * into mm;
       insert into public.team_attendance(meeting_id,student_id,review_status) values(m.id,target_id,'none');
       insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
       values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_EDIT_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
     else
       before_snapshot:=to_jsonb(mm)-'attempts'-'attempt_window';
       update public.team_meeting_members set required=target_required
       where meeting_id=m.id and student_id=target_id returning * into mm;
       -- Physical/request/review evidence is never rewritten. Only pristine
       -- default none/not_required flags follow the changed requirement.
       update public.team_attendance set review_status=case when target_required then 'none' else 'not_required' end,version=version+1
       where meeting_id=m.id and student_id=target_id and notice_at is null and review_status in ('none','not_required')
         and review_status is distinct from case when target_required then 'none' else 'not_required' end;
       insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
       values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_EDIT_REQUIREMENT',before_snapshot,to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
     end if;
   end loop;
 end if;
 if clock_timestamp()>=m.starts_at or (schedule_changed and next_start<=clock_timestamp()) then
   raise exception 'This meeting has started. Meeting details can only be edited before it starts';
 end if;
 update public.team_meetings set title=next_title,meeting_type=next_type,
   starts_at=next_start,ends_at=next_end,
   requirement=case when roster_changed then case when cardinality(next_required)>0 then 'selected' else 'optional' end else requirement end,
   areas=case when roster_changed then array[]::text[] else areas end,
   selected_students=case when roster_changed then next_required else selected_students end,
   check_in_open=case when schedule_changed then false else check_in_open end,
   code_hash=case when schedule_changed then null else code_hash end,
   code_expires_at=case when schedule_changed then null else code_expires_at end,
   version=version+1 where id=m.id;
 -- Existing team_audit trigger atomically records old/new values and actor;
 -- code material remains excluded. No notifications or strike writes.
 return jsonb_build_object('id',m.id,'version',m.version+1,'changed',true);
end $$;
commit;
