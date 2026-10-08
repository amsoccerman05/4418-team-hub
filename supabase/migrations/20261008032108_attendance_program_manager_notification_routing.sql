-- Apply after Attendance Program Manager mentor review and Notification Center.
-- Local preparation only; prospective routing changes, no existing data rewrite.
begin;
-- Keep request notification routing aligned with requester-specific review authorization.
-- Existing recipients and deliveries are retained; current permission is rechecked
-- when presenting or delivering older pending requests. No replay or backfill.
create or replace function notifications_private.center_attendance() returns trigger language plpgsql security definer set search_path='' as $$
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
 case k when 'request_review' then 'Attendance request needs review' when 'request_approved' then 'Your '||label||' request was approved' when 'request_denied' then 'Your '||label||' request was denied' else 'An attendance strike was recorded' end,coalesce(m.title,'Attendance'));
 for uid in select p.id from public.profiles p where p.active and
 ((k='request_review' and team_attendance_private.can_review_request(new.student_id,p.id)) or (k<>'request_review' and p.id=new.student_id)) loop
  insert into notifications_private.recipients(event_id,user_id) values(eid,uid) on conflict do nothing;
  insert into public.team_notifications(source,event,recipient_id,entity_type,payload,center_event_id)
  values('attendance',k,uid,'attendance',jsonb_build_object('title',(select title from notifications_private.events where id=eid),'meeting',m.title,'starts_at',m.starts_at,'meeting_id',m.id),eid) on conflict do nothing;
 end loop;
 return new;
end $$;

create or replace function notifications_private.center_rows() returns table(id uuid,source text,title text,message text,created_at timestamptz,read_at timestamptz,href text,action_needed boolean)
language sql stable security definer set search_path='' as $$
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
 (r.source='attendance' and ((r.kind='request_review' and team_attendance_private.can_review_request(att.student_id,me.id)) or (r.kind<>'request_review' and att.student_id=me.id and (me.role in ('student','lead') or team_attendance_private.reader())))) or
 (r.source='announcements' and public.team_announcement_visible(r.object_id))
$$;

create or replace function public.team_attendance_delivery_allowed(notification_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.team_notifications n join notifications_private.events e on e.id=n.center_event_id join public.profiles p on p.id=n.recipient_id and p.active join public.team_attendance a on a.id=e.object_id where n.id=notification_id and n.source='attendance' and
 ((e.kind='request_review' and team_attendance_private.can_review_request(a.student_id,p.id) and a.review_status='pending') or (e.kind<>'request_review' and a.student_id=p.id)))
$$;

commit;
