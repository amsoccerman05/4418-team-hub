-- LOCAL REVIEW ONLY. Prospective; deploy updated existing worker before applying.
-- No replay/backfill, domain rewrites, or network calls. Requires production v6 Finance enqueue,
-- Team Communications, and Attendance Policy v0.3 with public.team_attendance_history TABLE.
begin;
create table notifications_private.center_epoch (singleton boolean primary key default true check(singleton),finance_history_id bigint not null);
insert into notifications_private.center_epoch select true,coalesce(max(id),0) from finance_private.history;
create table notifications_private.events (
 id uuid primary key default gen_random_uuid(), source text not null, event_key text not null,
 kind text not null, object_id uuid not null, revision integer, title text not null, message text not null,
 created_at timestamptz not null default clock_timestamp(), unique(source,event_key)
);
create table notifications_private.recipients (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references notifications_private.events(id),
 user_id uuid not null references public.profiles(id), read_at timestamptz,
 unique(event_id,user_id)
);
create index notification_recipient_user on notifications_private.recipients(user_id,event_id);
create index notification_event_recent on notifications_private.events(created_at desc,id desc);
alter table notifications_private.center_epoch enable row level security;
alter table notifications_private.events enable row level security;
alter table notifications_private.recipients enable row level security;
revoke all on notifications_private.center_epoch,notifications_private.events,notifications_private.recipients from public,anon,authenticated;
-- Keep the delivery outbox and all historical delivery rows intact.
alter table public.team_notifications add column center_event_id uuid references notifications_private.events(id);
alter table public.team_notifications drop constraint team_notification_source_identity;
alter table public.team_notifications add constraint team_notification_source_identity check(
 (source='finance' and entity_type='finance_po' and source_event_id is not null and entity_id is not null and announcement_event_id is null and announcement_id is null) or
 (source='hub' and entity_type='announcement' and source_event_id is null and entity_id is null and announcement_event_id is not null and announcement_id is not null) or
 (source='attendance' and entity_type='attendance' and center_event_id is not null and source_event_id is null and entity_id is null and announcement_event_id is null and announcement_id is null));
create unique index notification_center_delivery_once on public.team_notifications(center_event_id,recipient_id,channel) where source='attendance';
create function notifications_private.center_event(src text,key text,kind text,obj uuid,rev integer,title text,message text) returns uuid
language plpgsql security definer set search_path='' as $$
declare eid uuid;
begin
 insert into notifications_private.events(source,event_key,kind,object_id,revision,title,message) values(src,key,kind,obj,rev,title,message)
 on conflict(source,event_key) do nothing returning id into eid;
 if eid is null then select id into eid from notifications_private.events where source=src and event_key=key;end if;
 return eid;
end $$;
-- Mirrors ONLY newly enqueued delivery rows. Does not modify Finance recipient rules or emails.
create function notifications_private.center_from_delivery() returns trigger language plpgsql security definer set search_path='' as $$
declare eid uuid; a public.team_announcements; suffix text;
begin
 if new.source='finance' then
  if new.source_event_id<=(select finance_history_id from notifications_private.center_epoch) then return new;end if;
  suffix:=case new.event when 'approval_needed' then 'needs approval' when 'approval_remaining' then 'needs approval' when 'approval_recorded' then 'received an approval' when 'ready_for_school' then 'is ready for school submission' when 'changes_requested' then 'needs changes' when 'cancelled' then 'was canceled' when 'submitted_to_school' then 'was submitted to school' else 'was updated' end;
  eid:=notifications_private.center_event('finance',new.source_event_id::text||':'||new.event,new.event,new.entity_id,(new.payload->>'revision')::integer,'PO #'||(new.payload->>'po_number')||' '||suffix,coalesce(new.payload->>'vendor','Purchase order'));
 elsif new.source='hub' then
  select * into a from public.team_announcements where id=new.announcement_id;
  eid:=notifications_private.center_event('announcements',a.id::text||':'||a.version,'published',a.id,a.version,'New announcement',a.title);
 else return new;end if;
 insert into notifications_private.recipients(event_id,user_id) values(eid,new.recipient_id) on conflict do nothing;
 new.center_event_id:=eid;return new;
end $$;
create trigger notification_center_delivery before insert on public.team_notifications for each row execute function notifications_private.center_from_delivery();
-- Mirrors existing reviewer policy for recipient IDs without exposing an impersonation RPC.
create function notifications_private.attendance_reviewer(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=uid and p.active and (p.role::text='mentor' or (p.role::text in ('student','lead','mentor','admin') and exists(select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active where mp.user_id=p.id and mp.position_key='program_manager' and mp.revoked_at is null))))
$$;
create function notifications_private.center_attendance() returns trigger language plpgsql security definer set search_path='' as $$
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
 ((k='request_review' and p.id<>new.student_id and notifications_private.attendance_reviewer(p.id)) or (k<>'request_review' and p.id=new.student_id)) loop
  insert into notifications_private.recipients(event_id,user_id) values(eid,uid) on conflict do nothing;
  insert into public.team_notifications(source,event,recipient_id,entity_type,payload,center_event_id)
  values('attendance',k,uid,'attendance',jsonb_build_object('title',(select title from notifications_private.events where id=eid),'meeting',m.title,'starts_at',m.starts_at,'meeting_id',m.id),eid) on conflict do nothing;
 end loop;
 return new;
end $$;
create trigger notification_center_attendance after insert on public.team_attendance_history for each row execute function notifications_private.center_attendance();
create function notifications_private.center_announcement() returns trigger language plpgsql security definer set search_path='' as $$
declare eid uuid;
begin
 if not new.active or (new.expires_at is not null and new.expires_at<=now()) then return new;end if;
 if tg_op='UPDATE' and old.active then return new;end if;
 eid:=notifications_private.center_event('announcements',new.id::text||':'||new.version,'published',new.id,new.version,'New announcement',new.title);
 insert into notifications_private.recipients(event_id,user_id) select eid,p.id from public.profiles p where team_private.announcement_audience(new.audience,new.area_id,new.position_key,p.id) on conflict do nothing;
 return new;
end $$;
create trigger notification_center_announcement after insert or update on public.team_announcements for each row execute function notifications_private.center_announcement();
-- One server projection. Current domain authorization is rechecked, never browser-supplied.
create function notifications_private.center_rows() returns table(id uuid,source text,title text,message text,created_at timestamptz,read_at timestamptz,href text,action_needed boolean)
language sql stable security definer set search_path='' as $$
 with me as materialized (select p.id,p.role::text role,finance_private.cap('finance_approver') fc,finance_private.cap('po_approver') pc,finance_private.cap('school_submitter') sc,finance_private.admin() fa,notifications_private.attendance_reviewer(p.id) reviewer from public.profiles p where p.id=auth.uid() and p.active),
 mine as (select r.id,r.read_at,e.source,e.kind,e.object_id,e.revision,e.title,e.message,e.created_at from notifications_private.recipients r join notifications_private.events e on e.id=r.event_id where r.user_id=auth.uid())
 select r.id,r.source,r.title,r.message,r.created_at,r.read_at,
 case r.source when 'finance' then 'https://finance.frc4418.org/#po/'||r.object_id when 'attendance' then '#attendance/'||case when r.kind='strike_assigned' then 'strikes' else 'notices' end else '#home-announcements' end,
 coalesce(case when r.source='finance' and po.revision=r.revision then
  case when r.kind='ready_for_school' then po.status='approved' and (me.sc or me.fa) and finance_private.revision_approved(po.id,po.revision)
  when r.kind in ('approval_needed','approval_remaining','approval_recorded') then po.status='awaiting_approval' and po.requester_id<>me.id
   and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and (ap.action='changes_requested' or ap.actor_id=me.id and ap.action='approved'))
   and ((me.fc and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and ap.slot='finance_approver' and ap.action='approved')) or (me.pc and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and ap.slot='po_approver' and ap.action='approved'))) else false end
 when r.source='attendance' and r.kind='request_review' then me.reviewer and att.student_id<>me.id and att.review_status='pending' else false end,false)
 from mine r cross join me left join public.finance_purchase_orders po on r.source='finance' and po.id=r.object_id
 left join public.team_attendance att on r.source='attendance' and att.id=r.object_id
 where (r.source='finance' and finance_private.visible(po.id)) or
 (r.source='attendance' and ((r.kind='request_review' and me.reviewer and att.student_id<>me.id) or (r.kind<>'request_review' and att.student_id=me.id and (me.role in ('student','lead') or team_attendance_private.reader())))) or
 (r.source='announcements' and public.team_announcement_visible(r.object_id))
$$;
create function public.notification_center(filter text default 'all',before_at timestamptz default null,before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'Active team account required' using errcode='42501';end if;
 if filter is null or filter not in ('all','unread','action') or (before_at is null)<>(before_id is null) then raise exception 'Invalid notification filter/cursor';end if;
 with visible as materialized(select * from notifications_private.center_rows()), page as (select * from visible where (filter='all' or filter='unread' and read_at is null or filter='action' and action_needed) and (before_at is null or (created_at,id)<(before_at,before_id)) order by created_at desc,id desc limit 31)
 select jsonb_build_object('unread',(select count(*) from visible where read_at is null),'attention',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc),'[]') from(select * from visible where action_needed order by created_at desc,id desc limit 5)a),'items',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc),'[]') from(select * from page order by created_at desc,id desc limit 30)a),'has_more',(select count(*)>30 from page)) into result;
 return result;
end $$;
create function public.notification_read(notification_id uuid default null,unread boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'Active team account required' using errcode='42501';end if;
 if notification_id is null and unread then raise exception 'Choose a notification';end if;
 update notifications_private.recipients r set read_at=case when unread then null else coalesce(r.read_at,clock_timestamp()) end
 where r.user_id=auth.uid() and (notification_id is null or r.id=notification_id)
 and exists(select 1 from notifications_private.center_rows() v where v.id=r.id);
end $$;
create function public.team_attendance_delivery_allowed(notification_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.team_notifications n join notifications_private.events e on e.id=n.center_event_id join public.profiles p on p.id=n.recipient_id and p.active join public.team_attendance a on a.id=e.object_id where n.id=notification_id and n.source='attendance' and
 ((e.kind='request_review' and notifications_private.attendance_reviewer(p.id) and a.student_id<>p.id and a.review_status='pending') or (e.kind<>'request_review' and a.student_id=p.id)))
$$;
revoke all on function notifications_private.center_event(text,text,text,uuid,integer,text,text),notifications_private.center_from_delivery(),notifications_private.attendance_reviewer(uuid),notifications_private.center_attendance(),notifications_private.center_announcement(),notifications_private.center_rows() from public,anon,authenticated;
revoke all on function public.notification_center(text,timestamptz,uuid),public.notification_read(uuid,boolean),public.team_attendance_delivery_allowed(uuid) from public,anon,authenticated;
grant execute on function public.notification_center(text,timestamptz,uuid),public.notification_read(uuid,boolean) to authenticated;
grant execute on function public.team_attendance_delivery_allowed(uuid) to service_role;
commit;
