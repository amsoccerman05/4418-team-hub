-- MANUAL ONLY: after Team Communications V1. No historical rows are rewritten.
begin;
alter table public.team_positions
 add column description text not null default '' check(length(description)<=1000),
 add column category text not null default 'Other Leadership' check(category in ('Coaching','Program','Functional Leads','Other Leadership')),
 add column display_order integer not null default 0 check(display_order between 0 and 9999),
 add column version integer not null default 1 check(version>0);
update public.team_positions set category=case when key in ('lead_coach_1','lead_coach_2') then 'Coaching'
 when key in ('program_manager','product_technical_manager') then 'Program'
 when key in ('finance_lead','software_lead','business_lead','cad_lead','fabrication_lead','strategy_lead','power_lead','communications_lead','operations_lead') then 'Functional Leads' else 'Other Leadership' end;
create table team_private.invitations(
 id uuid primary key, email text not null unique, display_name text not null,
 role text not null check(role in ('student','lead','mentor','admin','readonly')),
 area_id uuid references public.areas(id), member_status text check(member_status in ('prospective','registered','inactive')),
 actor_id uuid not null references public.profiles(id), reason text not null,
 created_at timestamptz not null default clock_timestamp(), user_id uuid references public.profiles(id),
 status text not null default 'processing' check(status in ('processing','pending','review')),
 error_code text
);
alter table team_private.invitations enable row level security;
revoke all on team_private.invitations from public,anon,authenticated;
-- Auth creates the profile before sending the invitation. Keep this NEW account
-- inactive until its authorized provisioning transaction completes.
create function team_private.quarantine_invited_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from auth.users u join team_private.invitations i on i.id::text=u.raw_user_meta_data->>'team_invitation_id'
 where u.id=new.id and lower(u.email)=i.email and i.status in ('processing','review')) then new.active:=false;end if;
 return new;
end $$;
create trigger team_invitation_profile_guard before insert on public.profiles for each row execute function team_private.quarantine_invited_profile();
revoke all on function team_private.quarantine_invited_profile() from public,anon,authenticated;
-- Only a narrow email/status projection is returned, never auth.users or tokens.
create function public.team_management_context_v2() returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 if not team_private.admin() then raise exception 'Active mentor or admin required' using errcode='42501';end if;
 c:=public.team_management_context();
 return c||jsonb_build_object('members',(select coalesce(jsonb_agg(m||jsonb_build_object('email',u.email) order by m->>'display_name'),'[]') from jsonb_array_elements(c->'members') m left join auth.users u on u.id=(m->>'id')::uuid),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'display_name',i.display_name,'user_id',i.user_id,'created_at',i.created_at,
 'status',case when i.status='pending' and u.last_sign_in_at is not null then 'accepted' when i.status='processing' and i.created_at<now()-interval '2 minutes' then 'review' else i.status end) order by i.created_at desc),'[]') from team_private.invitations i left join auth.users u on u.id=i.user_id));
end $$;
create function public.team_manage_v2(action text,p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare pos public.team_positions; ar public.areas; pr public.profiles; reason text:=trim(coalesce(p->>'reason','')); before_json jsonb;
begin
 perform pg_advisory_xact_lock(4418);
 if not team_private.admin() then raise exception 'Active mentor or admin required' using errcode='42501';end if;
 if length(reason) not between 1 and 2000 then raise exception 'Explain the change (up to 2000 characters)';end if;
 if action in ('member','assign_position','revoke_position','create_area') then
  perform public.team_manage(action,p);return;
 elsif action='member_state' then
  select * into pr from public.profiles where id=(p->>'user_id')::uuid for update;
  if not found or pr.updated_at is distinct from (p->>'expected_updated_at')::timestamptz then raise exception 'Member changed. Reload before saving.';end if;
  if p->>'active' is null then raise exception 'Active state required';end if;
  if pr.active and pr.role::text in ('mentor','admin') and not (p->>'active')::boolean and not exists(select 1 from public.profiles where id<>pr.id and active and role::text in ('mentor','admin')) then raise exception 'Keep at least one active admin or mentor';end if;
  update public.profiles set active=(p->>'active')::boolean,updated_at=clock_timestamp() where id=pr.id;
  insert into team_private.management_history(user_id,action,actor_id,reason,before_data,after_data)
  select pr.id,case when n.active then 'member_reactivated' else 'member_deactivated' end,auth.uid(),reason,to_jsonb(pr),to_jsonb(n) from public.profiles n where n.id=pr.id;
 elsif action='position_save' then
  if coalesce((p->>'create')::boolean,false) then
   insert into public.team_positions(key,name,description,category,display_order,active) values(p->>'key',trim(p->>'name'),coalesce(p->>'description',''),p->>'category',(p->>'display_order')::integer,true) returning * into pos;
  else
   select * into pos from public.team_positions where key=p->>'key' for update;
   if not found or pos.version is distinct from (p->>'version')::integer then raise exception 'Position changed. Reload before saving.';end if;
   before_json:=to_jsonb(pos);
   update public.team_positions set name=trim(p->>'name'),description=coalesce(p->>'description',''),category=p->>'category',display_order=(p->>'display_order')::integer,active=(p->>'active')::boolean,version=version+1 where key=pos.key returning * into pos;
  end if;
  insert into team_private.management_history(action,actor_id,reason,before_data,after_data) values(case when before_json is null then 'position_created' else 'position_updated' end,auth.uid(),reason,before_json,to_jsonb(pos));
 elsif action='area_save' then
  select * into ar from public.areas where id=(p->>'id')::uuid for update;
  if not found or ar.name is distinct from p->>'expected_name' or ar.active is distinct from (p->>'expected_active')::boolean then raise exception 'Area changed. Reload before saving.';end if;
  if length(trim(coalesce(p->>'name',''))) not between 1 and 100 or p->>'active' is null then raise exception 'Area name and active state required';end if;
  -- Stable IDs/slugs and historical snapshots stay intact. Sync only current roster labels whose profile ID links to this area.
  update public.areas set name=trim(p->>'name'),active=(p->>'active')::boolean where id=ar.id;
  if ar.name<>trim(p->>'name') then update public.team_attendance_members m set team_area=trim(p->>'name') from public.profiles roster_profile where roster_profile.id=m.student_id and roster_profile.primary_area_id=ar.id and m.team_area=ar.name;end if;
  insert into team_private.management_history(action,actor_id,reason,before_data,after_data)
  select case when ar.active and not n.active then 'area_archived' when not ar.active and n.active then 'area_reactivated' else 'area_renamed' end,auth.uid(),reason,to_jsonb(ar),to_jsonb(n) from public.areas n where n.id=ar.id;
 else raise exception 'Unsupported action. Deletion and area merging are not available.';end if;
end $$;
-- Durable reservation prevents repeated HTTP requests from issuing another email.
create function public.team_invitation_reserve(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare i team_private.invitations; em text:=lower(trim(p->>'email')); area uuid:=nullif(p->>'area_id','')::uuid;
begin
 perform pg_advisory_xact_lock(4418);
 if not team_private.admin() then raise exception 'Active mentor or admin required' using errcode='42501';end if;
 select * into i from team_private.invitations where id=(p->>'id')::uuid;
 if found then return jsonb_build_object('send',false,'id',i.id,'status',i.status);end if;
 if em is null or length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(coalesce(p->>'display_name',''))) not between 1 and 150 or length(trim(coalesce(p->>'reason',''))) not between 1 and 2000 then raise exception 'Valid email, name and reason required';end if;
 if area is not null and not exists(select 1 from public.areas where id=area and active) then raise exception 'Choose an active area';end if;
 if exists(select 1 from auth.users where lower(email)=em) then raise exception 'Account already exists. Manage the existing member.';end if;
 insert into team_private.invitations(id,email,display_name,role,area_id,member_status,actor_id,reason)
 values((p->>'id')::uuid,em,trim(p->>'display_name'),p->>'role',area,nullif(p->>'member_status',''),auth.uid(),trim(p->>'reason')) returning * into i;
 insert into team_private.management_history(action,actor_id,reason,after_data) values('invitation_requested',auth.uid(),i.reason,jsonb_build_object('invitation_id',i.id,'name',i.display_name));
 return jsonb_build_object('send',true,'id',i.id,'email',i.email,'display_name',i.display_name);
end $$;
-- Service-only completion: recheck the authorizing manager and bind to a NEW Auth invite.
create function public.team_invitation_finish(invitation_id uuid,invited_user uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare i team_private.invitations; pr public.profiles; membership public.team_attendance_members; invited_area text;
begin
 perform pg_advisory_xact_lock(4418);
 select * into i from team_private.invitations where id=invitation_id for update;
 if not found then raise exception 'Invitation unavailable';end if;
 if i.status='pending' or (i.status='review' and invited_user is null) then return;end if;
 if invited_user is null then
  update team_private.invitations set status='review',error_code='invite_incomplete' where id=i.id;
  insert into team_private.management_history(action,actor_id,reason,after_data) values('invitation_review',i.actor_id,i.reason,jsonb_build_object('invitation_id',i.id,'name',i.display_name));return;
 end if;
 if not exists(select 1 from public.profiles where id=i.actor_id and active and role::text in ('mentor','admin')) then raise exception 'Inviting manager is no longer authorized';end if;
 if not exists(select 1 from auth.users u where u.id=invited_user and lower(u.email)=i.email and u.created_at>=i.created_at and u.invited_at>=i.created_at and u.raw_user_meta_data->>'team_invitation_id'=i.id::text) then raise exception 'Invitation identity mismatch';end if;
 if i.area_id is not null and not exists(select 1 from public.areas where id=i.area_id and active) then raise exception 'Invited area is no longer active';end if;
 select * into pr from public.profiles where id=invited_user for update;
 if not found or pr.role::text<>'readonly' then raise exception 'New profile requires review';end if;
 update public.profiles set display_name=i.display_name,role=i.role,primary_area_id=i.area_id,active=true,updated_at=clock_timestamp() where id=invited_user;
 if i.member_status is not null then
  invited_area:=coalesce((select name from public.areas where id=i.area_id),'');
  -- Reconciliation may encounter an already-provisioned registration. Reuse only
  -- matching data; never overwrite an unrelated registration during an invite.
  insert into public.team_attendance_members(student_id,member_status,team_area)
  values(invited_user,i.member_status,invited_area) on conflict(student_id) do nothing;
  select * into membership from public.team_attendance_members where student_id=invited_user for update;
  if membership.member_status is distinct from i.member_status or membership.team_area is distinct from invited_area then
   raise exception 'Existing registration differs from invitation. Review membership before completing.';
  end if;
 end if;
 update team_private.invitations set user_id=invited_user,status='pending' where id=i.id;
 insert into team_private.management_history(user_id,action,actor_id,reason,before_data,after_data)
 select invited_user,'member_invited',i.actor_id,i.reason,to_jsonb(pr),to_jsonb(n) from public.profiles n where n.id=invited_user;
end $$;
revoke all on function public.team_management_context_v2(),public.team_manage_v2(text,jsonb),public.team_invitation_reserve(jsonb),public.team_invitation_finish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.team_management_context_v2(),public.team_manage_v2(text,jsonb),public.team_invitation_reserve(jsonb) to authenticated;
grant execute on function public.team_invitation_finish(uuid,uuid) to service_role;
commit;
