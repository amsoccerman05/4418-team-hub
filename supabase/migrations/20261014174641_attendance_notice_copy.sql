-- Prospective attendance notice terminology only.
-- Nine prose replacements in five existing function bodies; no behavior or grant changes.
-- No historical rows, queued provider requests, recipients, routes, or identifiers are rewritten.
begin;

CREATE OR REPLACE FUNCTION notifications_private.center_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n jsonb:=new.after_data; b jsonb:=new.before_data; k text; label text; eid uuid; uid uuid; obj uuid; m public.team_meetings;
begin
 if new.entity='team_attendance' then
  if n->>'review_status'='pending' and n->>'notice_at' is not null and (n->>'notice_at' is distinct from b->>'notice_at') then k:='request_review';
  elsif n->>'review_status' in ('excused','denied') and n->>'notice_at' is not null and n->>'review_status' is distinct from b->>'review_status' then k:=case n->>'review_status' when 'excused' then 'request_approved' else 'request_denied' end;
  else return new;end if;
  obj:=(n->>'id')::uuid;
 elsif new.entity='team_attendance_strikes' and new.action='INSERT' then k:='strike_assigned';obj:=(n->>'attendance_id')::uuid;
 else return new;end if;
 select * into m from public.team_meetings where id=new.meeting_id;
 label:=case n->>'notice_type' when 'late' then 'late-arrival' when 'early' then 'early-departure' else 'absence' end;
 eid:=notifications_private.center_event('attendance',new.id::text,k,obj,null,
 case k when 'request_review' then 'Attendance request needs review' when 'request_approved' then 'Your '||label||' request was approved' when 'request_denied' then 'Your '||label||' request was denied' else 'An attendance notice was recorded' end,coalesce(m.title,'Attendance'));
 for uid in select p.id from public.profiles p where p.active and
 ((k='request_review' and team_attendance_private.can_review_request(new.student_id,p.id)) or (k<>'request_review' and p.id=new.student_id)) loop
  insert into notifications_private.recipients(event_id,user_id) values(eid,uid) on conflict do nothing;
  insert into public.team_notifications(source,event,recipient_id,entity_type,payload,center_event_id)
  values('attendance',k,uid,'attendance',jsonb_build_object('title',(select title from notifications_private.events where id=eid),'meeting',m.title,'starts_at',m.starts_at,'meeting_id',m.id),eid) on conflict do nothing;
 end loop;
 return new;
end $function$;

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
 -- Outreach times have a separate validated, reason-audited correction path.
 -- The generic physical-status correction clears departure timestamps and must
 -- never be used to review or edit an outreach record.
 if action='attendance' and m.meeting_type='stem_outreach' then
  raise exception 'Use the verified outreach time correction. Optional outreach does not require an excuse review';
 end if;
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
  raise exception 'Automatic absence notice preview changed or is missing. Refresh and review before completing attendance';
 end if;
 if (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(p->'automatic_absence_strike_attendance_ids') v) is distinct from automatic_ids
 or jsonb_typeof(p->'automatic_absence_strike_count') is distinct from 'number'
 or (p->>'automatic_absence_strike_count')::numeric is distinct from automatic_count::numeric then
  raise exception 'Automatic absence notice preview changed or is missing. Refresh and review before completing attendance';
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
  raise exception 'An automatic absence notice already exists. Review or rescind it before assigning a replacement';
 end if;
 insert into public.team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by)
 values(a.id,a.student_id,a.meeting_id,p->>'category',(p->>'quantity')::integer,trim(p->>'explanation'),auth.uid());
 elsif action='rescind' then
 select * into s from public.team_attendance_strikes where id=(p->>'strike_id')::uuid and attendance_id=a.id for update;
 if not found or s.rescinded_at is not null then raise exception 'Active attendance notice not found'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'Rescind reason is required'; end if;
 update public.team_attendance_strikes set rescinded_by=auth.uid(),rescinded_at=now(),rescind_reason=trim(p->>'explanation') where id=s.id;
 else raise exception 'Unknown attendance action'; end if;
 return coalesce(result,'{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION team_attendance_private.edit_meeting(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if next_type is null or next_type not in ('offseason','preseason','other','stem_outreach') then raise exception 'Choose a meeting type'; end if;
 next_start:=(p->>'starts_at')::timestamptz;
 next_end:=(p->>'ends_at')::timestamptz;
 if next_start is null or next_end is null or not isfinite(next_start) or not isfinite(next_end) or next_end<=next_start then
   raise exception 'End time must be after a valid start time';
 end if;
 schedule_changed:=next_start is distinct from m.starts_at or next_end is distinct from m.ends_at;
 if m.meeting_type='stem_outreach' and jsonb_array_length(coalesce(p->'required_student_ids','[]'))>0 then raise exception 'STEM outreach is optional and has no required participants';end if;
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
         raise exception 'Recorded attendance, reviewed decisions, or attendance notices lock this participant’s requirement';
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
end $function$;

CREATE OR REPLACE FUNCTION team_attendance_private.no_outreach_strikes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.team_meetings where id=new.meeting_id and meeting_type='stem_outreach') then
  raise exception 'STEM outreach participation never receives attendance notices';
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION team_attendance_private.reconcile_absence_strike(attendance_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
   rescind_reason='Automatic absence notice rescinded after attendance or excuse correction.'
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
  'Automatic attendance notice for a required unexcused absence after attendance completion.',auth.uid(),'automatic_absence');
 return 1;
end $function$;

commit;
