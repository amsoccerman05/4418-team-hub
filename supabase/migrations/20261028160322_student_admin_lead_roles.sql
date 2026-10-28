-- Reconstructed from freshly verified production definitions; no row conversion.
-- Apply only as the coordinated reviewed role release, never independently.
begin;
select pg_advisory_xact_lock(4418);
do $$ begin
 if (select md5(prosrc) from pg_proc where oid='public.team_my_positions()'::regprocedure) is distinct from '3d33cd28094ad40db090c289a755d9a6' then raise exception 'Installed public.team_my_positions differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='public.team_manage(text, jsonb)'::regprocedure) is distinct from '38271cc748f5b5d001906f65655bb16c' then raise exception 'Installed public.team_manage differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='public.team_invitation_reserve(jsonb)'::regprocedure) is distinct from 'dcfe4e2d40c870811c93047767257f71' then raise exception 'Installed public.team_invitation_reserve differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='public.team_invitation_finish(uuid, uuid)'::regprocedure) is distinct from '3a1e6e495ee2e2368ec0f79ab1207819' then raise exception 'Installed public.team_invitation_finish differs from reviewed definition';end if;
 if (select md5(prosrc) from pg_proc where oid='public.team_invitation_context()'::regprocedure) is distinct from 'd2afaa11c0c87d88dfbf4561bae5ded0' then raise exception 'Installed public.team_invitation_context differs from reviewed definition';end if;
end $$;
do $$ begin
 if pg_get_constraintdef((select oid from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_role_check')) is distinct from 'CHECK ((role = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin''::text, ''mentor''::text])))' then raise exception 'Profile role constraint differs';end if;
 if pg_get_constraintdef((select oid from pg_constraint where conrelid='team_private.invitations'::regclass and conname='invitations_role_check')) is distinct from 'CHECK ((role = ANY (ARRAY[''student''::text, ''lead''::text, ''mentor''::text, ''admin''::text, ''readonly''::text])))' then raise exception 'Invitation role constraint differs';end if;
end $$;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','admin','mentor'));
alter table team_private.invitations drop constraint invitations_role_check;
alter table team_private.invitations add constraint invitations_role_check check(role in ('student','lead','admin_lead','mentor','admin','readonly'));
CREATE OR REPLACE FUNCTION public.team_my_positions()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(array_agg(mp.position_key order by mp.position_key),'{}') from public.team_member_positions mp
 join public.team_positions pos on pos.key=mp.position_key and pos.active
 join public.profiles pr on pr.id=mp.user_id and pr.active and pr.role::text in ('student','lead','admin_lead','mentor','admin')
 where mp.user_id=auth.uid() and mp.revoked_at is null
$function$;

CREATE OR REPLACE FUNCTION public.team_manage(action text, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pr public.profiles; old_member public.team_attendance_members; assignment public.team_member_positions;
 reason text:=trim(coalesce(p->>'reason','')); target uuid:=(p->>'user_id')::uuid; next_area uuid:=nullif(p->>'primary_area_id','')::uuid; before_json jsonb;
begin
 -- Share Inventory's profile guard lock, preventing concurrent last-admin removal.
 perform pg_advisory_xact_lock(4418);
 if not team_private.admin() then raise exception 'Active mentor or admin required' using errcode='42501'; end if;
 if length(reason) not between 1 and 2000 then raise exception 'Explain the change (up to 2000 characters)'; end if;
 if action='create_area' then
 if length(trim(coalesce(p->>'name',''))) not between 1 and 100 or coalesce(p->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Area name and lowercase hyphenated key required'; end if;
 if length(p->>'slug')>100 then raise exception 'Area key is too long'; end if;
 insert into public.areas(name,slug) values(trim(p->>'name'),p->>'slug') returning id into next_area;
 insert into team_private.management_history(action,actor_id,reason,after_data) select action,auth.uid(),reason,jsonb_build_object('area_id',id,'name',name,'slug',slug) from public.areas where id=next_area;
 return;
 end if;
 select * into pr from public.profiles where id=target for update;
 if not found then raise exception 'Team member not found'; end if;
 if action='member' then
 if pr.updated_at is distinct from (p->>'expected_updated_at')::timestamptz then raise exception 'Member changed. Reload before saving.'; end if;
 if length(trim(coalesce(p->>'display_name',''))) not between 1 and 150 or coalesce(p->>'role','') not in ('student','lead','admin_lead','admin','mentor','readonly') or p->>'active' is null then raise exception 'Valid name, role and active status required'; end if;
 if next_area is not null and not exists(select 1 from public.areas where id=next_area and active) then raise exception 'Choose an active area'; end if;
 if pr.active and pr.role::text in ('admin','mentor') and (not (p->>'active')::boolean or p->>'role' not in ('admin','mentor')) and not exists(select 1 from public.profiles where id<>target and active and role::text in ('admin','mentor')) then raise exception 'Keep at least one active admin or mentor'; end if;
 if target=auth.uid() and p->>'role' is distinct from pr.role::text then raise exception 'Ask another mentor to change your account role' using errcode='42501'; end if;
 if p->>'role'='admin' and pr.role::text<>'admin' and exists(select 1 from public.profiles where id=auth.uid() and role::text='mentor') then raise exception 'Choose Mentor, Admin Lead, Lead, Student or Readonly; Admin is a legacy role' using errcode='42501'; end if;
 select * into old_member from public.team_attendance_members where student_id=target for update;
 if old_member.member_status is distinct from p->>'expected_member_status' or old_member.team_area is distinct from p->>'expected_team_area' then raise exception 'Registration changed. Reload before saving.'; end if;
 if p->>'member_status' is not null and p->>'member_status' not in ('prospective','registered','inactive') then raise exception 'Invalid member status'; end if;
 before_json:=jsonb_build_object('profile',to_jsonb(pr),'membership',to_jsonb(old_member));
 update public.profiles set display_name=trim(p->>'display_name'),role=p->>'role',active=(p->>'active')::boolean,primary_area_id=next_area,updated_at=clock_timestamp() where id=target;
 -- Keep the existing Attendance roster's area label compatible. Past snapshots are untouched.
 if p->>'member_status' is not null or old_member.student_id is not null then
 insert into public.team_attendance_members(student_id,member_status,team_area) values(target,coalesce(p->>'member_status',old_member.member_status),coalesce((select name from public.areas where id=next_area),''))
 on conflict(student_id) do update set member_status=excluded.member_status,team_area=excluded.team_area;
 end if;
 insert into team_private.management_history(user_id,action,actor_id,reason,before_data,after_data)
 select target,action,auth.uid(),reason,before_json,jsonb_build_object('profile',to_jsonb(n),'membership',(select to_jsonb(m) from public.team_attendance_members m where student_id=target)) from public.profiles n where id=target;
 elsif action='assign_position' then
 if not pr.active or pr.role::text not in ('student','lead','admin_lead','admin','mentor') then raise exception 'Choose an active student or leadership account'; end if;
 if not exists(select 1 from public.team_positions where key=p->>'position_key' and active) then raise exception 'Choose an active position'; end if;
 insert into public.team_member_positions(user_id,position_key,assigned_by,assignment_reason) values(target,p->>'position_key',auth.uid(),reason) returning * into assignment;
 insert into team_private.management_history(user_id,action,actor_id,reason,after_data) values(target,action,auth.uid(),reason,to_jsonb(assignment));
 elsif action='revoke_position' then
 select * into assignment from public.team_member_positions where id=(p->>'assignment_id')::uuid and user_id=target and revoked_at is null for update;
 if not found then raise exception 'Active assignment not found. Reload.'; end if;
 update public.team_member_positions set revoked_by=auth.uid(),revoked_at=clock_timestamp(),revoke_reason=reason where id=assignment.id;
 insert into team_private.management_history(user_id,action,actor_id,reason,before_data,after_data) select target,action,auth.uid(),reason,to_jsonb(assignment),to_jsonb(n) from public.team_member_positions n where id=assignment.id;
 else raise exception 'Unknown team management action'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.team_invitation_reserve(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare caller_role text; i team_private.invitations; em text:=lower(trim(p->>'email')); area uuid:=nullif(p->>'area_id','')::uuid;
begin
 perform pg_advisory_xact_lock(4418);
 select role::text into caller_role from public.profiles where id=auth.uid() and active for share;
 if caller_role is null or caller_role not in ('admin_lead','mentor','admin') then raise exception 'Active Admin Lead, mentor or admin required' using errcode='42501';end if;
 if caller_role='admin_lead' and (p->>'role') is distinct from 'student' then raise exception 'Admin Leads can invite students only' using errcode='42501';end if;
 if coalesce(p->>'role','') not in ('student','lead','admin_lead','mentor','admin','readonly') or (nullif(p->>'member_status','') is not null and p->>'member_status' not in ('prospective','registered','inactive')) then raise exception 'Valid invitation role and registration required';end if;
 select * into i from team_private.invitations where id=(p->>'id')::uuid;
 if found then
  -- Admin Leads may only reconcile their own student requests, including after role changes.
  if caller_role='admin_lead' and (i.actor_id is distinct from auth.uid() or i.role<>'student') then raise exception 'Invitation request unavailable for this account' using errcode='42501';end if;
  -- A UUID names an immutable reviewed request, not a reusable recipient slot.
  if i.email is distinct from em or i.display_name is distinct from trim(p->>'display_name') or i.role is distinct from p->>'role' or i.area_id is distinct from area or i.member_status is distinct from nullif(p->>'member_status','') or i.reason is distinct from trim(p->>'reason') then raise exception 'Invitation details changed. Review the recorded invitation; do not resend.';end if;
  return jsonb_build_object('send',false,'id',i.id,'status',i.status);
 end if;
 -- Immutable UUID replay above reports status, never sends again.
 if caller_role='mentor' and p->>'role'='admin' then raise exception 'Only an active Admin can invite a new Admin' using errcode='42501';end if;
 if em is null or length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(coalesce(p->>'display_name',''))) not between 1 and 150 or length(trim(coalesce(p->>'reason',''))) not between 1 and 2000 then raise exception 'Valid email, name and reason required';end if;
 if area is not null and not exists(select 1 from public.areas where id=area and active) then raise exception 'Choose an active area';end if;
 if exists(select 1 from auth.users where lower(email)=em) then raise exception 'Account already exists. Manage the existing member.';end if;
 insert into team_private.invitations(id,email,display_name,role,area_id,member_status,actor_id,reason)
 values((p->>'id')::uuid,em,trim(p->>'display_name'),p->>'role',area,nullif(p->>'member_status',''),auth.uid(),trim(p->>'reason')) returning * into i;
 insert into team_private.management_history(action,actor_id,reason,after_data) values('invitation_requested',auth.uid(),i.reason,jsonb_build_object('invitation_id',i.id,'name',i.display_name));
 return jsonb_build_object('send',true,'id',i.id,'email',i.email,'display_name',i.display_name);
end $function$;

CREATE OR REPLACE FUNCTION public.team_invitation_finish(invitation_id uuid, invited_user uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 perform 1 from public.profiles where id=i.actor_id and active and (role::text in ('mentor','admin') or (role::text='admin_lead' and i.role='student')) for share;
 if not found then raise exception 'Inviting manager is no longer authorized';end if;
 -- Recheck before provisioning; already-provisioned replay returned above.
 if i.role='admin' and not exists(select 1 from public.profiles where id=i.actor_id and active and role::text='admin') then raise exception 'Only an active Admin can invite a new Admin' using errcode='42501';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.team_invitation_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('admin_lead','mentor','admin')) then raise exception 'Active Admin Lead, mentor or admin required' using errcode='42501';end if;
 return jsonb_build_object(
 'members','[]'::jsonb,'positions','[]'::jsonb,'assignments','[]'::jsonb,
 'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name),'[]') from public.areas where active),
 'history',(select coalesce(jsonb_agg(h.entry order by h.id desc),'[]') from (
  select h.id,jsonb_build_object('id',h.id,'user_id',null,'actor_id',h.actor_id,'action',h.action,'reason',h.reason,'created_at',h.created_at,'after_data',jsonb_build_object('name',i.display_name)) entry
  from team_private.management_history h join team_private.invitations i on i.actor_id=h.actor_id and i.role='student' and
   ((h.action in ('invitation_requested','invitation_review') and h.after_data->>'invitation_id'=i.id::text) or (h.action='member_invited' and h.user_id=i.user_id))
  where h.actor_id=auth.uid() order by h.id desc limit 100
 ) h),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'display_name',i.display_name,'user_id',i.user_id,'created_at',i.created_at,
 'status',case when identity_match.n=1 and identity_match.usable then 'account_active'
 when identity_match.n=1 and identity_match.awaiting_setup and i.status='pending' then 'pending'
 when i.status='processing' and i.created_at>=now()-interval '2 minutes' then 'processing' else 'review' end,
 'review_reason',case when identity_match.n=1 then 'account_not_ready'
 when exists(select 1 from auth.users other where lower(other.email)=i.email) then 'identity_unmatched' else 'invitation_incomplete' end
 ) order by i.created_at desc),'[]') from (select * from team_private.invitations where actor_id=auth.uid() and role='student') i
 left join lateral (
 select count(*) n,coalesce(bool_and(p.active and u.last_sign_in_at is null and (u.banned_until is null or u.banned_until<=now())),false) awaiting_setup,
 coalesce(bool_and(p.active and u.last_sign_in_at is not null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())),false) usable
 from auth.users u join public.profiles p on p.id=u.id
 where lower(u.email)=i.email and
 ((i.user_id is not null and u.id=i.user_id) or
 (i.user_id is null and u.raw_user_meta_data->>'team_invitation_id'=i.id::text
 and u.created_at>=i.created_at and u.invited_at>=i.created_at))
 ) identity_match on true));
end $function$;

-- Separate narrow operations surface, not Team Management/financial authority.
create function team_private.operations() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role::text='admin_lead')
$$;
create function public.team_operations_context() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not team_private.operations() then raise exception 'Active Admin Lead required' using errcode='42501';end if;
 return public.team_invitation_context() || jsonb_build_object('members',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',p.id,'display_name',p.display_name,'role',p.role,'active',p.active,'updated_at',p.updated_at,
 'member_status',m.member_status,'team_area',m.team_area) order by p.display_name,p.id),'[]')
 from public.profiles p left join public.team_attendance_members m on m.student_id=p.id
 where p.role::text in ('readonly','student','lead','admin_lead')));
end $$;
create function public.team_operations_manage(p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare pr public.profiles; membership public.team_attendance_members; before_json jsonb; target uuid; reason text;
begin
 perform pg_advisory_xact_lock(4418);
 perform 1 from public.profiles where id=auth.uid() and active and role::text='admin_lead' for share;
 if not found then raise exception 'Active Admin Lead required' using errcode='42501';end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'Member details are required';end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('user_id','display_name','member_status','expected_updated_at','expected_member_status','expected_team_area','reason'))
 or not (p ?& array['user_id','display_name','member_status','expected_updated_at','expected_member_status','expected_team_area','reason']) then raise exception 'Only display name and Attendance registration may be changed';end if;
 target:=(p->>'user_id')::uuid;reason:=trim(coalesce(p->>'reason',''));
 if target is null or length(trim(coalesce(p->>'display_name',''))) not between 1 and 150 or length(reason) not between 1 and 2000 then raise exception 'A member, valid display name and reason are required';end if;
 if p->>'member_status' is not null and p->>'member_status' not in ('prospective','registered','inactive') then raise exception 'Choose a valid registration status';end if;
 select * into pr from public.profiles where id=target for update;
 if not found or pr.role::text not in ('readonly','student','lead','admin_lead') then raise exception 'Ordinary student account required' using errcode='42501';end if;
 if pr.updated_at is distinct from (p->>'expected_updated_at')::timestamptz then raise exception 'Member changed. Refresh before saving.';end if;
 select * into membership from public.team_attendance_members where student_id=target for update;
 if membership.member_status is distinct from p->>'expected_member_status' or membership.team_area is distinct from p->>'expected_team_area' then raise exception 'Registration changed. Refresh before saving.';end if;
 if membership.student_id is not null and p->>'member_status' is null then raise exception 'Choose a valid registration status';end if;
 before_json:=jsonb_build_object('profile',to_jsonb(pr),'membership',to_jsonb(membership));
 update public.profiles set display_name=trim(p->>'display_name'),updated_at=clock_timestamp() where id=target;
 if p->>'member_status' is not null then
  insert into public.team_attendance_members(student_id,member_status,team_area) values(target,p->>'member_status',coalesce((select name from public.areas where id=pr.primary_area_id),''))
  on conflict(student_id) do update set member_status=excluded.member_status,team_area=excluded.team_area;
 end if;
 insert into team_private.management_history(user_id,action,actor_id,reason,before_data,after_data)
 select target,'member_details',auth.uid(),reason,before_json,jsonb_build_object('profile',to_jsonb(n),'membership',(select to_jsonb(m) from public.team_attendance_members m where student_id=target)) from public.profiles n where id=target;
end $$;
revoke all on function team_private.operations() from public,anon,authenticated,service_role;
revoke all on function public.team_operations_context(),public.team_operations_manage(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.team_operations_context(),public.team_operations_manage(jsonb) to authenticated;
commit;
