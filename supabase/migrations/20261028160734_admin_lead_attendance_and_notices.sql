-- Reconstructed from freshly verified production definitions; no row conversion.
-- Apply only as the coordinated reviewed role release, never independently.
begin;
select pg_advisory_xact_lock(4418);
do $$ begin
 if (select md5(prosrc) from pg_proc where oid='team_attendance_private.manager()'::regprocedure) is distinct from 'a6704dec289c4ca76854cb66f49a32a0' then raise exception 'Installed team_attendance_private.manager differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='team_attendance_private.is_program_manager(uuid)'::regprocedure) is distinct from '56a5340a152aab2e8512b09b8ee92db8' then raise exception 'Installed team_attendance_private.is_program_manager differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='team_attendance_private.is_participant(uuid)'::regprocedure) is distinct from '09db5751d9a2f1480bb385911939252a' then raise exception 'Installed team_attendance_private.is_participant differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='team_attendance_private.reviewer()'::regprocedure) is distinct from 'c20d6ca431e584029d57aa9940a97ba5' then raise exception 'Installed team_attendance_private.reviewer differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='team_attendance_private.request_reviewer(uuid)'::regprocedure) is distinct from 'd09809feb8f8fed25f0076c87294a501' then raise exception 'Installed team_attendance_private.request_reviewer differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='public.team_attendance_policy_context()'::regprocedure) is distinct from 'dc6aec67427bf3bddb5783f87771c864' then raise exception 'Installed public.team_attendance_policy_context differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='team_attendance_private.edit_meeting(jsonb)'::regprocedure) is distinct from 'f0c5211f60a4782082fc9ded6765bb97' then raise exception 'Installed team_attendance_private.edit_meeting differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='notifications_private.attendance_reviewer(uuid)'::regprocedure) is distinct from '3727b746069e3e4545a5a4c6d80833b1' then raise exception 'Installed notifications_private.attendance_reviewer differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='notifications_private.center_rows()'::regprocedure) is distinct from '05cf17cfb0fe97f2ff163f370cc0b1c4' then raise exception 'Installed notifications_private.center_rows differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='team_private.announcement_audience(text, uuid, text, uuid)'::regprocedure) is distinct from '699ef34ed4eee855fb9b1e9b7a0e5ece' then raise exception 'Installed team_private.announcement_audience differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='public.team_notification_claim(integer)'::regprocedure) is distinct from '4ca716a29ff766266f3edce1eeee1665' then raise exception 'Installed public.team_notification_claim differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='public.team_dashboard_context()'::regprocedure) is distinct from '7f2e2574ab91c31c4f2b320e3662dadc' then raise exception 'Installed public.team_dashboard_context differs from reviewed definition';end if;
end $$;
CREATE OR REPLACE FUNCTION team_attendance_private.manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(team_attendance_private.role() in ('admin_lead','admin','mentor'),false)
$function$;

CREATE OR REPLACE FUNCTION team_attendance_private.is_program_manager(member_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.profiles p
 join public.team_member_positions mp on mp.user_id=p.id and mp.revoked_at is null
 join public.team_positions tp on tp.key=mp.position_key and tp.active
 where p.id=member_id and p.active and p.role::text in ('student','lead','admin_lead','mentor','admin')
 and tp.key='program_manager')
$function$;

CREATE OR REPLACE FUNCTION team_attendance_private.is_participant(member_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from public.profiles p
  where p.id=member_id and p.active
   and (p.role::text in ('student','lead','admin_lead') or
    (p.role::text in ('mentor','admin') and (
     team_attendance_private.is_program_manager(p.id) or exists(
      select 1 from public.team_member_positions mp
      join public.team_positions tp on tp.key=mp.position_key and tp.active
      where mp.user_id=p.id and mp.revoked_at is null and tp.key='operations_lead'
     )
    )))
 )
$function$;

CREATE OR REPLACE FUNCTION team_attendance_private.reviewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(team_attendance_private.role()='mentor' or (team_attendance_private.role() in ('admin_lead','admin') and public.team_has_position('program_manager')),false)
$function$;

CREATE OR REPLACE FUNCTION team_attendance_private.request_reviewer(member_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select team_attendance_private.is_lead_coach(member_id)
 or (team_attendance_private.is_program_manager(member_id) and exists(select 1 from public.profiles where id=member_id and active and role::text in ('admin_lead','mentor','admin')))
$function$;

CREATE OR REPLACE FUNCTION public.team_attendance_policy_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare boundary timestamptz;
begin
 if coalesce(team_attendance_private.role(),'') not in ('student','lead','admin_lead','mentor','admin') then raise exception 'Active Attendance account required' using errcode='42501';end if;
 -- Keep the current window through January 8, then start the 2027 season.
 boundary:=team_attendance_private.notice_window_start(now());
 return jsonb_build_object('user_id',auth.uid(),'can_participate',team_attendance_private.participant(),'can_review',team_attendance_private.reviewer(),'can_review_requests',team_attendance_private.request_reviewer(),'can_read_team',team_attendance_private.reader(),'can_manage_meetings',team_attendance_private.manager(),'strike_year_start',boundary,
 'can_review_program_manager_requests',team_attendance_private.is_lead_coach(auth.uid()) and not team_attendance_private.is_program_manager(auth.uid()),
 'mentor_review_required_for',case when team_attendance_private.reader() then (select coalesce(jsonb_agg(p.id),'[]'::jsonb) from public.profiles p where team_attendance_private.is_program_manager(p.id)) else '[]'::jsonb end,
 'people',case when team_attendance_private.reader() then (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'role',p.role,'positions',(select coalesce(jsonb_agg(tp.name),'[]') from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active where mp.user_id=p.id and mp.revoked_at is null))),'[]') from public.profiles p where p.active) else '[]'::jsonb end,
 'warnings',(select coalesce(jsonb_agg(jsonb_build_object('student_id',h.student_id,'at',h.performed_at,'actor',h.performed_by,'note',h.after_data->>'note') order by h.id desc),'[]') from public.team_attendance_history h where h.entity='attendance_policy' and h.action='WARNING_PARENT_CONTACT' and (boundary is null or h.performed_at>=boundary) and (team_attendance_private.reader() or h.student_id=auth.uid())));
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
   and role::text in ('admin_lead','mentor','admin') for share;
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

CREATE OR REPLACE FUNCTION notifications_private.attendance_reviewer(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select team_attendance_private.request_reviewer(uid)
$function$;

CREATE OR REPLACE FUNCTION notifications_private.center_rows()
 RETURNS TABLE(id uuid, source text, title text, message text, created_at timestamp with time zone, read_at timestamp with time zone, href text, action_needed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with me as materialized (select p.id,p.role::text role,finance_private.cap('finance_approver') fc,finance_private.cap('po_approver') pc,finance_private.cap('school_submitter') sc,finance_private.admin() fa,notifications_private.attendance_reviewer(p.id) reviewer from public.profiles p where p.id=auth.uid() and p.active),
 mine as (select r.id,r.read_at,e.source,e.kind,e.object_id,e.revision,e.title,e.message,e.created_at from notifications_private.recipients r join notifications_private.events e on e.id=r.event_id where r.user_id=auth.uid())
 select r.id,r.source,r.title,r.message,r.created_at,r.read_at,
 case r.source when 'finance' then 'https://finance.frc4418.org/#po/'||r.object_id when 'attendance' then '#attendance/'||case when r.kind='strike_assigned' then 'strikes' when r.kind in ('request_approved','request_denied') and team_attendance_private.is_student_program_manager(me.id) then 'my-requests' else 'notices' end else '#home-announcements' end,
 coalesce(case when r.source='finance' and po.revision=r.revision then
  case when r.kind='ready_for_school' then po.status='approved' and (me.sc or me.fa) and finance_private.revision_approved(po.id,po.revision)
  when r.kind in ('approval_needed','approval_remaining','approval_recorded') then po.status='awaiting_approval' and po.requester_id<>me.id
   and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and (ap.action='changes_requested' or ap.actor_id=me.id and ap.action='approved'))
   and ((me.fc and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and ap.slot='finance_approver' and ap.action='approved')) or (me.pc and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and ap.slot='po_approver' and ap.action='approved'))) else false end
 when r.source='attendance' and r.kind='request_review' then team_attendance_private.can_review_request(att.student_id,me.id) and att.review_status='pending' else false end,false)
 from mine r cross join me left join public.finance_purchase_orders po on r.source='finance' and po.id=r.object_id
 left join public.team_attendance att on r.source='attendance' and att.id=r.object_id
 where (r.source='finance' and finance_private.visible(po.id)) or
 (r.source='attendance' and ((r.kind='request_review' and team_attendance_private.can_review_request(att.student_id,me.id)) or (r.kind<>'request_review' and att.student_id=me.id and (me.role in ('student','lead','admin_lead') or team_attendance_private.reader())))) or
 (r.source='announcements' and public.team_announcement_visible(r.object_id))
$function$;

CREATE OR REPLACE FUNCTION team_private.announcement_audience(kind text, area uuid, pos text, uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.profiles p where p.id=uid and p.active and
 case kind when 'all' then true when 'registered' then p.role::text in ('student','lead','admin_lead') and exists(select 1 from public.team_attendance_members m where m.student_id=p.id and m.member_status='registered')
 when 'leadership' then p.role::text in ('mentor','admin') when 'area' then p.primary_area_id=area
 when 'position' then exists(select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=p.id and mp.position_key=pos and mp.revoked_at is null and p.role::text in ('student','lead','admin_lead','mentor','admin')) else false end)
$function$;

CREATE OR REPLACE FUNCTION public.team_notification_claim(batch_size integer DEFAULT 3)
 RETURNS SETOF team_notifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 -- Never retry an uncertain send outside Resend's 24-hour idempotency window.
 update public.team_notifications set status='review',last_error='Retry window or attempt limit reached',lease_token=null,lease_until=null
 where channel='email' and status in ('pending','sending') and (lease_until is null or lease_until<now())
 and (attempts>=5 or first_attempt_at<now()-interval '23 hours');
 update public.team_notifications n set status='skipped',last_error='Recipient no longer active',lease_token=null,lease_until=null
 where n.channel='email' and n.status in ('pending','sending') and (n.lease_until is null or n.lease_until<now())
 and not exists(select 1 from public.profiles p where p.id=n.recipient_id and p.active and (p.role::text in ('student','lead','admin_lead','admin','mentor') or (n.source='hub' and p.role::text='readonly')));
 return query with candidates as (
 select id from public.team_notifications where channel='email' and
 ((status='pending' and next_attempt_at<=now()) or (status='sending' and lease_until<now()))
 order by created_at,id for update skip locked limit greatest(1,least(coalesce(batch_size,3),3))
 ) update public.team_notifications n set status='sending',attempts=attempts+1,
 first_attempt_at=coalesce(first_attempt_at,now()),lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid()
 from candidates c where n.id=c.id returning n.*;
end $function$;

CREATE OR REPLACE FUNCTION public.team_dashboard_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare pr public.profiles; leadership boolean; personal jsonb; next_meeting jsonb; orders jsonb; actions jsonb; attention jsonb; robot jsonb; stock jsonb;
begin
 select * into pr from public.profiles where id=auth.uid() and active;
 if not found then raise exception 'Active team account required' using errcode='42501';end if;
 leadership:=pr.role::text in ('lead','admin_lead','mentor','admin');
 select jsonb_build_object('percent',case when count(*)=0 then null else round(100.0*count(*) filter(where a.physical_status in ('present','late','left_early'))/count(*)) end,
 'strikes',(select coalesce(sum(quantity),0) from public.team_attendance_strikes where student_id=pr.id and rescinded_at is null),
 'pending',(select count(*) from public.team_attendance where student_id=pr.id and review_status='pending')) into personal
 from public.team_attendance a join public.team_meetings m on m.id=a.meeting_id
 join public.team_meeting_members mm on mm.meeting_id=a.meeting_id and mm.student_id=a.student_id
 where a.student_id=pr.id and m.status='finalized' and mm.required and a.review_status not in ('excused','not_required');
 select jsonb_build_object('id',m.id,'title',m.title,'type',m.meeting_type,'starts_at',m.starts_at,'ends_at',m.ends_at,'required',true,
 'code_expires_at',m.code_expires_at,'check_in_open',m.status='open' and m.check_in_open and m.code_expires_at>now(),'physical_status',a.physical_status) into next_meeting
 from public.team_meetings m join public.team_meeting_members mm on mm.meeting_id=m.id and mm.student_id=pr.id and mm.required
 left join public.team_attendance a on a.meeting_id=m.id and a.student_id=pr.id
 where m.ends_at>now() and m.status in ('draft','open','closed') order by m.starts_at limit 1;
 select coalesce(jsonb_agg(x order by x.updated_at desc),'[]') into orders from (
 select p.id,p.po_number,p.vendor,p.amount,p.status,p.updated_at,
 (select count(distinct slot) from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.action='approved'
 and p.status in ('awaiting_approval','approved','submitted_to_school') and not exists(select 1 from public.finance_po_approvals c where c.po_id=p.id and c.revision=p.revision and c.action='changes_requested')) as approvals
 from public.finance_purchase_orders p where p.requester_id=pr.id order by p.updated_at desc limit 5) x;
 select jsonb_build_object('approvals',count(*) filter(where p.status='awaiting_approval' and p.requester_id<>pr.id
 and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and (a.action='changes_requested' or a.actor_id=pr.id))
 and ((finance_private.cap('finance_approver') and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.slot='finance_approver' and a.action='approved'))
 or (finance_private.cap('po_approver') and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.slot='po_approver' and a.action='approved')))),
 'school',count(*) filter(where p.status='approved' and (finance_private.cap('school_submitter') or pr.role::text in ('mentor','admin'))
 and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.action='changes_requested')
 and (select count(distinct a.slot)=2 and count(distinct a.actor_id)=2 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.action='approved')),
 'allowed',leadership or finance_private.cap('finance_approver') or finance_private.cap('po_approver') or finance_private.cap('school_submitter')) into actions from public.finance_purchase_orders p;
 if team_attendance_private.reader() then
 select jsonb_build_object('open_meetings',(select count(*) from public.team_meetings where status='open' and check_in_open and code_expires_at>now() and ends_at>now()),
 'requests',(select count(*) from public.team_attendance where review_status='pending'),
 'strike_actions',(select count(*) from (select student_id from public.team_attendance_strikes where rescinded_at is null group by student_id having sum(quantity)>=3) s)) into attention;
 end if;
 if leadership then
 select jsonb_build_object('event',e.name,'open',count(i.id) filter(where i.status<>'RESOLVED'),
 'blocking',count(i.id) filter(where i.status<>'RESOLVED' and i.severity in ('HIGH','ROBOT DOWN')),
 'readiness',case when bool_or(i.status<>'RESOLVED' and i.severity='ROBOT DOWN') then 'NOT READY' when bool_or(i.status<>'RESOLVED' and i.severity='HIGH') then 'NEEDS ATTENTION' else 'READY' end) into robot
 from public.pit_events e left join public.pit_issues i on i.event_id=e.id where e.status='active' group by e.id,e.name;
 select jsonb_build_object('out',count(*) filter(where qty=0),'low',count(*) filter(where qty>0 and qty<=minimum_quantity)) into stock
 from (select minimum_quantity,quantity as qty from public.inventory_items) counts;
 end if;
 return jsonb_build_object('name',pr.display_name,'role',pr.role,'admin',pr.role::text in ('mentor','admin'),'personal',personal,'next_meeting',next_meeting,'orders',orders,'finance',actions,'attention',attention,'robot',robot,'inventory',stock,
 'announcements',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'severity',severity,'created_at',created_at,'expires_at',expires_at,'image_path',image_path,'audience',audience) order by case severity when 'urgent' then 0 when 'important' then 1 else 2 end,created_at desc),'[]') from public.team_announcements where active and (expires_at is null or expires_at>now())));
end $function$;

commit;
