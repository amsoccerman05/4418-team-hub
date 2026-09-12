-- MANUAL ONLY: after dashboard announcements and Finance notifications.
-- Deploy the updated existing notification worker BEFORE enabling announcement email.
begin;
insert into public.team_positions(key,name) values
 ('program_manager','Program Manager'),('product_technical_manager','Product/Technical Manager'),
 ('software_lead','Software Lead'),('business_lead','Business Lead'),('cad_lead','CAD Lead'),
 ('fabrication_lead','Fabrication Lead'),('strategy_lead','Strategy Lead'),('power_lead','Power Lead'),
 ('communications_lead','Communications Lead'),('operations_lead','Operations Lead') on conflict(key) do nothing;
-- New positions are identity only. No Finance/global role authorization changes.
alter table public.team_announcements add column audience text not null default 'all',
 add column position_key text references public.team_positions(key),add column image_path text;
update public.team_announcements set audience='area' where area_id is not null;
alter table public.team_announcements add constraint team_announcement_audience check(
 (audience in ('all','registered','leadership') and area_id is null and position_key is null) or
 (audience='area' and area_id is not null and position_key is null) or
 (audience='position' and position_key is not null and area_id is null)),
 add constraint team_announcement_image_path check(image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$');
-- Private generic audience predicate; no public user-id impersonation interface.
create function team_private.announcement_audience(kind text,area uuid,pos text,uid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=uid and p.active and
 case kind when 'all' then true when 'registered' then p.role::text in ('student','lead') and exists(select 1 from public.team_attendance_members m where m.student_id=p.id and m.member_status='registered')
 when 'leadership' then p.role::text in ('mentor','admin') when 'area' then p.primary_area_id=area
 when 'position' then exists(select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=p.id and mp.position_key=pos and mp.revoked_at is null and p.role::text in ('student','lead','mentor','admin')) else false end)
$$;
create function public.team_announcement_visible(announcement_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select team_private.admin() or exists(select 1 from public.team_announcements a where a.id=announcement_id and a.active and (a.expires_at is null or a.expires_at>now())
 and team_private.announcement_audience(a.audience,a.area_id,a.position_key,auth.uid()))
$$;
drop policy announcement_read on public.team_announcements;
create policy announcement_read on public.team_announcements for select to authenticated using(public.team_announcement_visible(id));
-- Private, authenticated images: no public bucket URLs, email links to Hub instead.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-announcement-media','team-announcement-media',false,6291456,array['image/jpeg','image/png','image/webp']);
create policy team_announcement_media_read on storage.objects for select to authenticated using(bucket_id='team-announcement-media' and
 (team_private.admin() or exists(select 1 from public.team_announcements a where a.image_path=name and public.team_announcement_visible(a.id))));
create policy team_announcement_media_upload on storage.objects for insert to authenticated with check(bucket_id='team-announcement-media' and team_private.admin()
 and name ~ ('^'||auth.uid()::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'));
-- Objects are immutable; replacement uses a new path. Never delete a referenced image.
create policy team_announcement_media_delete on storage.objects for delete to authenticated using(bucket_id='team-announcement-media' and team_private.admin()
 and not exists(select 1 from public.team_announcements a where a.image_path=name));
create table team_private.announcement_email_events(
 id uuid primary key,announcement_id uuid not null references public.team_announcements(id),actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),audience text not null,area_id uuid,position_key text
);
alter table team_private.announcement_email_events enable row level security;
revoke all on team_private.announcement_email_events from public,anon,authenticated;
-- Preserve Finance FKs. Hub has its own durable event and entity references.
alter table public.team_notifications alter column source_event_id drop not null,alter column entity_id drop not null,
 add column announcement_event_id uuid references team_private.announcement_email_events(id),
 add column announcement_id uuid references public.team_announcements(id),
 add constraint team_notification_source_identity check(
 (source='finance' and entity_type='finance_po' and source_event_id is not null and entity_id is not null and announcement_event_id is null and announcement_id is null) or
 (source='hub' and entity_type='announcement' and source_event_id is null and entity_id is null and announcement_event_id is not null and announcement_id is not null));
create unique index team_announcement_delivery_once on public.team_notifications(announcement_event_id,recipient_id,channel) where source='hub';
create function team_private.enqueue_announcement(a public.team_announcements,event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if event_id is null then raise exception 'Email request ID required';end if;
 if not a.active or (a.expires_at is not null and a.expires_at<=now()) then raise exception 'Only active, unexpired announcements can be emailed';end if;
 insert into team_private.announcement_email_events(id,announcement_id,actor_id,audience,area_id,position_key)
 values(event_id,a.id,auth.uid(),a.audience,a.area_id,a.position_key) on conflict(id) do nothing;
 if not found then
 if not exists(select 1 from team_private.announcement_email_events e where e.id=event_id and e.announcement_id=a.id and e.actor_id=auth.uid()) then raise exception 'Email request ID already used';end if;
 return;end if;
 insert into public.team_notifications(source,event,recipient_id,entity_type,payload,announcement_id,announcement_event_id)
 select 'hub','announcement_published',p.id,'announcement',jsonb_build_object('title',a.title,'body',a.body,'severity',a.severity,'has_image',a.image_path is not null),a.id,event_id
 from public.profiles p where team_private.announcement_audience(a.audience,a.area_id,a.position_key,p.id) on conflict do nothing;
end $$;
create or replace function public.team_announcement_save(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare aid uuid:=nullif(p->>'id','')::uuid; target uuid:=nullif(p->>'area_id','')::uuid; pos text:=nullif(p->>'position_key','');
 kind text:=coalesce(p->>'audience',case when target is null then 'all' else 'area' end); img text:=nullif(p->>'image_path',''); a public.team_announcements;
 event_id uuid:=nullif(p->>'email_request_id','')::uuid; send_email boolean:=coalesce((p->>'send_email')::boolean,false);
begin
 if not team_private.admin() then raise exception 'Active mentor or admin required' using errcode='42501';end if;
 if send_email then
 if event_id is null then raise exception 'Email request ID required';end if;
 -- Serialize retries of a create-with-email request before inserting its announcement.
 perform pg_advisory_xact_lock(hashtextextended(event_id::text,4418));
 select a0.* into a from team_private.announcement_email_events e join public.team_announcements a0 on a0.id=e.announcement_id where e.id=event_id and e.actor_id=auth.uid();
 if found then if aid is not null and aid<>a.id then raise exception 'Email request ID already used';end if;return a.id;end if;
 if aid is not null then raise exception 'Use Send update email for an existing announcement';end if;
 end if;
 if coalesce((p->>'active')::boolean,true) and kind='area' and not exists(select 1 from public.areas where id=target and active) then raise exception 'Choose an active area';end if;
 if coalesce((p->>'active')::boolean,true) and kind='position' and not exists(select 1 from public.team_positions where key=pos and active) then raise exception 'Choose an active position';end if;
 if img is not null then
 if img !~ ('^'||auth.uid()::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then raise exception 'Attach an image uploaded by your account';end if;
 if not exists(select 1 from storage.objects where bucket_id='team-announcement-media' and name=img) then raise exception 'Upload the image before saving';end if;
 end if;
 if aid is null then
 insert into public.team_announcements(title,body,severity,audience,area_id,position_key,image_path,active,expires_at,created_by)
 values(trim(p->>'title'),trim(p->>'body'),p->>'severity',kind,target,pos,img,coalesce((p->>'active')::boolean,true),nullif(p->>'expires_at','')::timestamptz,auth.uid()) returning * into a;
 else
 update public.team_announcements set title=trim(p->>'title'),body=trim(p->>'body'),severity=p->>'severity',audience=kind,area_id=target,position_key=pos,image_path=img,
 active=coalesce((p->>'active')::boolean,true),expires_at=nullif(p->>'expires_at','')::timestamptz,version=version+1,updated_at=clock_timestamp()
 where id=aid and version=(p->>'version')::integer returning * into a;
 if not found then raise exception 'Announcement changed. Refresh before saving.';end if;
 end if;
 if send_email then perform team_private.enqueue_announcement(a,event_id);end if;
 return a.id;
end $$;
create function public.team_announcement_send_update(announcement_id uuid,expected_version integer,request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.team_announcements;
begin
 if not team_private.admin() then raise exception 'Active mentor or admin required' using errcode='42501';end if;
 select * into a from public.team_announcements where id=announcement_id for update;
 if not found then raise exception 'Announcement not found';end if;
 if exists(select 1 from team_private.announcement_email_events e where e.id=request_id and e.announcement_id=a.id and e.actor_id=auth.uid()) then return;end if;
 if a.version is distinct from expected_version then raise exception 'Announcement changed. Refresh before sending';end if;
 perform team_private.enqueue_announcement(a,request_id);
end $$;
-- Recheck both original audience and current visibility before dispatch. Revoked
-- positions/inactive membership never receive an old queued announcement email.
create function public.team_announcement_delivery_allowed(notification_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.team_notifications n join team_private.announcement_email_events e on e.id=n.announcement_event_id
 join public.team_announcements a on a.id=n.announcement_id where n.id=notification_id and n.source='hub' and a.active and (a.expires_at is null or a.expires_at>now())
 and team_private.announcement_audience(e.audience,e.area_id,e.position_key,n.recipient_id)
 and team_private.announcement_audience(a.audience,a.area_id,a.position_key,n.recipient_id))
$$;
create or replace function public.team_notification_claim(batch_size integer default 3) returns setof public.team_notifications
language plpgsql security definer set search_path='' as $$
begin
 -- Never retry an uncertain send outside Resend's 24-hour idempotency window.
 update public.team_notifications set status='review',last_error='Retry window or attempt limit reached',lease_token=null,lease_until=null
 where channel='email' and status in ('pending','sending') and (lease_until is null or lease_until<now())
 and (attempts>=5 or first_attempt_at<now()-interval '23 hours');
 update public.team_notifications n set status='skipped',last_error='Recipient no longer active',lease_token=null,lease_until=null
 where n.channel='email' and n.status in ('pending','sending') and (n.lease_until is null or n.lease_until<now())
 and not exists(select 1 from public.profiles p where p.id=n.recipient_id and p.active and (p.role::text in ('student','lead','admin','mentor') or (n.source='hub' and p.role::text='readonly')));
 return query with candidates as (
 select id from public.team_notifications where channel='email' and
 ((status='pending' and next_attempt_at<=now()) or (status='sending' and lease_until<now()))
 order by created_at,id for update skip locked limit greatest(1,least(coalesce(batch_size,3),3))
 ) update public.team_notifications n set status='sending',attempts=attempts+1,
 first_attempt_at=coalesce(first_attempt_at,now()),lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid()
 from candidates c where n.id=c.id returning n.*;
end $$;
create or replace function public.team_dashboard_context() returns jsonb language plpgsql security invoker set search_path='' as $$
declare pr public.profiles; leadership boolean; personal jsonb; next_meeting jsonb; orders jsonb; actions jsonb; attention jsonb; robot jsonb; stock jsonb;
begin
 select * into pr from public.profiles where id=auth.uid() and active;
 if not found then raise exception 'Active team account required' using errcode='42501';end if;
 leadership:=pr.role::text in ('lead','mentor','admin');
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
 if leadership then
 select jsonb_build_object('open_meetings',(select count(*) from public.team_meetings where status='open' and check_in_open and code_expires_at>now() and ends_at>now()),
 'requests',(select count(*) from public.team_attendance where review_status='pending'),
 'strike_actions',(select count(*) from (select student_id from public.team_attendance_strikes where rescinded_at is null group by student_id having sum(quantity)>=3) s)) into attention;
 select jsonb_build_object('event',e.name,'open',count(i.id) filter(where i.status<>'RESOLVED'),
 'blocking',count(i.id) filter(where i.status<>'RESOLVED' and i.severity in ('HIGH','ROBOT DOWN')),
 'readiness',case when bool_or(i.status<>'RESOLVED' and i.severity='ROBOT DOWN') then 'NOT READY' when bool_or(i.status<>'RESOLVED' and i.severity='HIGH') then 'NEEDS ATTENTION' else 'READY' end) into robot
 from public.pit_events e left join public.pit_issues i on i.event_id=e.id where e.status='active' group by e.id,e.name;
 select jsonb_build_object('out',count(*) filter(where qty=0),'low',count(*) filter(where qty>0 and qty<=minimum_quantity)) into stock
 from (select minimum_quantity,quantity as qty from public.inventory_items) counts;
 end if;
 return jsonb_build_object('name',pr.display_name,'role',pr.role,'admin',pr.role::text in ('mentor','admin'),'personal',personal,'next_meeting',next_meeting,'orders',orders,'finance',actions,'attention',attention,'robot',robot,'inventory',stock,
 'announcements',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'severity',severity,'created_at',created_at,'expires_at',expires_at,'image_path',image_path,'audience',audience) order by case severity when 'urgent' then 0 when 'important' then 1 else 2 end,created_at desc),'[]') from public.team_announcements where active and (expires_at is null or expires_at>now())));
end $$;
revoke all on function team_private.announcement_audience(text,uuid,text,uuid),team_private.enqueue_announcement(public.team_announcements,uuid) from public,anon,authenticated;
revoke all on function public.team_announcement_visible(uuid),public.team_announcement_send_update(uuid,integer,uuid),public.team_announcement_delivery_allowed(uuid) from public,anon,authenticated;
grant execute on function public.team_announcement_visible(uuid),public.team_announcement_send_update(uuid,integer,uuid) to authenticated;
grant execute on function public.team_announcement_delivery_allowed(uuid) to service_role;
commit;
