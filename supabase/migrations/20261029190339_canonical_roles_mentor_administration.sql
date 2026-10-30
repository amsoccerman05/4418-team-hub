-- Local proposed canonical five-role correction. Requires separate exact release approval.
-- Retire Owner Admin authority; preserve immutable historical invitation roles.
-- The sole confirmed profile conversion is guarded; no position assignment changes.
begin;
select pg_advisory_xact_lock(4418);
lock table public.profiles in share row exclusive mode;
do $guard$ declare expected jsonb;actual jsonb;begin
 for expected in select value from jsonb_array_elements($pins$[{"schema":"private","name":"guard_profile","signature":"private.guard_profile()","owner":"postgres","acl":"{postgres=X/postgres}","prosecdef":false,"proconfig":["search_path=\"\""],"definition_md5":"c173370a18f129762b8abca84077fbdf"},{"schema":"team_private","name":"admin","signature":"team_private.admin()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"c63bcf5399d6eb4e830baf8a01811c0b"},{"schema":"public","name":"team_my_positions","signature":"team_my_positions()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"904f373974e88ae1fc9b64d0f01f6cbe"},{"schema":"public","name":"team_manage","signature":"team_manage(text,jsonb)","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"0cbbd2e0e87ce4c0fee18b0a228df8c5"},{"schema":"public","name":"team_manage_v2","signature":"team_manage_v2(text,jsonb)","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"3cce1363886d7e66c4454a06b396a084"},{"schema":"public","name":"team_management_context","signature":"team_management_context()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"5528dd84fb86c2fab7262b4fc3fa77ce"},{"schema":"public","name":"team_management_context_v2","signature":"team_management_context_v2()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"cc27ef5dbc63586b8365bfc9b21e3f81"},{"schema":"public","name":"team_invitation_reserve","signature":"team_invitation_reserve(jsonb)","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"b35022dcbe4f2abdcea6b76e9bf3838b"},{"schema":"public","name":"team_invitation_finish","signature":"team_invitation_finish(uuid,uuid)","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"5821f98e9157734d9348b84157da7cce"},{"schema":"public","name":"team_invitation_context","signature":"team_invitation_context()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"fabf3ad50033fa079c973907866813ab"},{"schema":"team_attendance_private","name":"manager","signature":"team_attendance_private.manager()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"0cd48fb40e2ff0f5ab20221b460d95bb"},{"schema":"team_attendance_private","name":"is_program_manager","signature":"team_attendance_private.is_program_manager(uuid)","owner":"postgres","acl":"{postgres=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"8965f54260035e36d9efa859df0e0188"},{"schema":"team_attendance_private","name":"is_participant","signature":"team_attendance_private.is_participant(uuid)","owner":"postgres","acl":"{postgres=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"54d624c46d3b6af171863fcd78f91bba"},{"schema":"team_attendance_private","name":"reviewer","signature":"team_attendance_private.reviewer()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"8b7667e0fc63abda84e908bdbe09e646"},{"schema":"team_attendance_private","name":"request_reviewer","signature":"team_attendance_private.request_reviewer(uuid)","owner":"postgres","acl":"{postgres=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"31b47b07fb086db114b9fb5e7ee9fa5d"},{"schema":"public","name":"team_attendance_policy_context","signature":"team_attendance_policy_context()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"52d0e09921b5a49275a836d376c038f1"},{"schema":"team_attendance_private","name":"edit_meeting","signature":"team_attendance_private.edit_meeting(jsonb)","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"339b38fb1bd6300291066aa85717a02a"},{"schema":"public","name":"team_attendance_manage","signature":"team_attendance_manage(text,jsonb)","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"6083eaa7207435928a968291f9398589"},{"schema":"public","name":"team_attendance_policy_action","signature":"team_attendance_policy_action(text,jsonb)","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"59eba2e99d8132b6f91ea48f795b7f2b"},{"schema":"public","name":"team_attendance_outreach_goal","signature":"team_attendance_outreach_goal(jsonb)","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"32dc94fcdbd10cabc6461b5fac438666"},{"schema":"public","name":"team_attendance_outreach_summary","signature":"team_attendance_outreach_summary(integer)","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"cd2e3f59116e43f34a5a7112888691e5"},{"schema":"team_private","name":"announcement_audience","signature":"team_private.announcement_audience(text,uuid,text,uuid)","owner":"postgres","acl":"{postgres=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"630d77bec614b01ed483d0483747c9e0"},{"schema":"public","name":"team_notification_claim","signature":"team_notification_claim(integer)","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","prosecdef":true,"proconfig":["search_path=\"\""],"definition_md5":"4e704b05cf1fac4382800c6c7176ab84"},{"schema":"public","name":"team_dashboard_context","signature":"team_dashboard_context()","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","prosecdef":false,"proconfig":["search_path=\"\""],"definition_md5":"32d575f9711bc952a3249e180c46503c"}]$pins$::jsonb) loop
  select jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'prosecdef',p.prosecdef,'proconfig',to_jsonb(p.proconfig),'definition_md5',md5(pg_get_functiondef(p.oid))) into actual
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=expected->>'schema' and p.proname=expected->>'name' and p.oid=to_regprocedure(expected->>'signature');
  if actual is distinct from (expected-'schema'-'name'-'signature') then raise exception 'Canonical role migration baseline drift: %',expected->>'signature';end if;
 end loop;
 if pg_get_constraintdef((select oid from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_role_check')) is distinct from 'CHECK ((role = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''admin''::text, ''mentor''::text])))' then raise exception 'Canonical role migration profile constraint drift';end if;
 if not exists(select 1 from public.profiles where active and role='mentor') then raise exception 'At least one active Mentor is required';end if;
end $guard$;
CREATE OR REPLACE FUNCTION private.guard_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.id<>old.id or new.email<>old.email or new.created_at<>old.created_at then raise exception 'Profile identity is immutable';end if;
 if old.role in ('mentor') and old.active and (not new.active or new.role not in ('mentor')) then
  perform pg_advisory_xact_lock(4418);
  if not exists(select 1 from public.profiles where id<>old.id and active and role in ('mentor')) then raise exception 'Keep at least one active Mentor';end if;
 end if;
 new.updated_at:=clock_timestamp();return new;
end $function$;

CREATE OR REPLACE FUNCTION team_private.admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('mentor'))
$function$;

CREATE OR REPLACE FUNCTION public.team_my_positions()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(array_agg(mp.position_key order by mp.position_key),'{}') from public.team_member_positions mp
 join public.team_positions pos on pos.key=mp.position_key and pos.active
 join public.profiles pr on pr.id=mp.user_id and pr.active and pr.role::text in ('student','lead','admin_lead','mentor')
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
 if not team_private.admin() then raise exception 'Active Mentor required' using errcode='42501'; end if;
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
 if length(trim(coalesce(p->>'display_name',''))) not between 1 and 150 or coalesce(p->>'role','') not in ('student','lead','admin_lead','mentor','readonly') or p->>'active' is null then raise exception 'Valid name, role and active status required'; end if;
 if next_area is not null and not exists(select 1 from public.areas where id=next_area and active) then raise exception 'Choose an active area'; end if;
 if pr.active and pr.role::text in ('mentor') and (not (p->>'active')::boolean or p->>'role' not in ('mentor')) and not exists(select 1 from public.profiles where id<>target and active and role::text in ('mentor')) then raise exception 'Keep at least one active Mentor'; end if;
 if target=auth.uid() and p->>'role' is distinct from pr.role::text then raise exception 'Ask another mentor to change your account role' using errcode='42501'; end if;

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
 if not pr.active or pr.role::text not in ('student','lead','admin_lead','mentor') then raise exception 'Choose an active student or leadership account'; end if;
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

CREATE OR REPLACE FUNCTION public.team_manage_v2(action text, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pos public.team_positions; ar public.areas; pr public.profiles; reason text:=trim(coalesce(p->>'reason','')); before_json jsonb;
begin
 perform pg_advisory_xact_lock(4418);
 if not team_private.admin() then raise exception 'Active Mentor required' using errcode='42501';end if;
 if length(reason) not between 1 and 2000 then raise exception 'Explain the change (up to 2000 characters)';end if;
 if action in ('member','assign_position','revoke_position','create_area') then
  perform public.team_manage(action,p);return;
 elsif action='member_state' then
  select * into pr from public.profiles where id=(p->>'user_id')::uuid for update;
  if not found or pr.updated_at is distinct from (p->>'expected_updated_at')::timestamptz then raise exception 'Member changed. Reload before saving.';end if;
  if p->>'active' is null then raise exception 'Active state required';end if;
  if pr.active and pr.role::text in ('mentor') and not (p->>'active')::boolean and not exists(select 1 from public.profiles where id<>pr.id and active and role::text in ('mentor')) then raise exception 'Keep at least one active Mentor';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.team_management_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not team_private.admin() then raise exception 'Active Mentor required' using errcode='42501'; end if;
 return jsonb_build_object(
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'role',p.role,'active',p.active,'primary_area_id',p.primary_area_id,'updated_at',p.updated_at,'member_status',m.member_status,'team_area',m.team_area) order by p.display_name),'[]') from public.profiles p left join public.team_attendance_members m on m.student_id=p.id),
 'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name),'[]') from public.areas),
 'positions',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]') from public.team_positions p),
 'assignments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.assigned_at desc),'[]') from public.team_member_positions p),
 'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id desc),'[]') from (select * from team_private.management_history order by id desc limit 100) h));
end $function$;

CREATE OR REPLACE FUNCTION public.team_management_context_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;
begin
 if not team_private.admin() then raise exception 'Active Mentor required' using errcode='42501';end if;
 c:=public.team_management_context();
 return c||jsonb_build_object('members',(select coalesce(jsonb_agg(m||jsonb_build_object('email',u.email) order by m->>'display_name'),'[]') from jsonb_array_elements(c->'members') m left join auth.users u on u.id=(m->>'id')::uuid),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'display_name',i.display_name,'user_id',i.user_id,'created_at',i.created_at,
 'status',case when identity_match.n=1 and identity_match.usable then 'account_active'
 when identity_match.n=1 and identity_match.awaiting_setup and i.status='pending' then 'pending'
 when i.status='processing' and i.created_at>=now()-interval '2 minutes' then 'processing' else 'review' end,
 'review_reason',case when identity_match.n=1 then 'account_not_ready'
 when exists(select 1 from auth.users other where lower(other.email)=i.email) then 'identity_unmatched' else 'invitation_incomplete' end
 ) order by i.created_at desc),'[]') from team_private.invitations i
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
 if caller_role is null or caller_role not in ('admin_lead','mentor') then raise exception 'Active Admin Lead or Mentor required' using errcode='42501';end if;
 if caller_role='admin_lead' and (p->>'role') is distinct from 'student' then raise exception 'Admin Leads can invite students only' using errcode='42501';end if;
 select * into i from team_private.invitations where id=(p->>'id')::uuid;
 if found then
  -- Admin Leads may only reconcile their own student requests, including after role changes.
  if caller_role='admin_lead' and (i.actor_id is distinct from auth.uid() or i.role<>'student') then raise exception 'Invitation request unavailable for this account' using errcode='42501';end if;
  -- A UUID names an immutable reviewed request, not a reusable recipient slot.
  if i.email is distinct from em or i.display_name is distinct from trim(p->>'display_name') or i.role is distinct from p->>'role' or i.area_id is distinct from area or i.member_status is distinct from nullif(p->>'member_status','') or i.reason is distinct from trim(p->>'reason') then raise exception 'Invitation details changed. Review the recorded invitation; do not resend.';end if;
  if i.role='admin' and i.status<>'pending' then raise exception 'Retired Admin invitation requires Mentor review; do not resend' using errcode='42501';end if;
  return jsonb_build_object('send',false,'id',i.id,'status',i.status);
 end if;
 -- Immutable UUID replay above reports status, never sends again.
 if p->>'role'='admin' then raise exception 'Owner Admin is retired; choose Admin Lead' using errcode='42501';end if;
 if coalesce(p->>'role','') not in ('student','lead','admin_lead','mentor','readonly') or (nullif(p->>'member_status','') is not null and p->>'member_status' not in ('prospective','registered','inactive')) then raise exception 'Valid invitation role and registration required';end if;

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
 perform 1 from public.profiles where id=i.actor_id and active and (role::text='mentor' or (role::text='admin_lead' and i.role='student')) for share;
 if not found then raise exception 'Inviting manager is no longer authorized';end if;
 -- Recheck before provisioning; already-provisioned replay returned above.
 if i.role='admin' then raise exception 'Retired Admin invitation requires Mentor review; do not resend' using errcode='42501';end if;
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
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('admin_lead','mentor')) then raise exception 'Active Admin Lead or Mentor required' using errcode='42501';end if;
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

CREATE OR REPLACE FUNCTION team_attendance_private.manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(team_attendance_private.role() in ('admin_lead','mentor'),false)
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
 where p.id=member_id and p.active and p.role::text in ('student','lead','admin_lead','mentor')
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
    (p.role::text in ('mentor') and (
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
 select team_attendance_private.request_reviewer(auth.uid())
$function$;

CREATE OR REPLACE FUNCTION team_attendance_private.request_reviewer(member_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select team_attendance_private.is_lead_coach(member_id)
 or (team_attendance_private.is_program_manager(member_id) and exists(select 1 from public.profiles where id=member_id and active and role::text in ('admin_lead','mentor')))
$function$;

CREATE OR REPLACE FUNCTION public.team_attendance_policy_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare boundary timestamptz;
begin
 if coalesce(team_attendance_private.role(),'') not in ('student','lead','admin_lead','mentor') then raise exception 'Active Attendance account required' using errcode='42501';end if;
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
   and role::text in ('admin_lead','mentor') for share;
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
 if action in ('strike','rescind') and not team_attendance_private.reviewer() then raise exception 'Assigned Lead Coach or eligible Program Manager required' using errcode='42501';end if;
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
 if not team_attendance_private.reviewer() then raise exception 'Assigned Lead Coach or eligible Program Manager required' using errcode='42501';end if;
 if not found or s.rescinded_at is not null then raise exception 'Active attendance notice not found'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'Rescind reason is required'; end if;
 update public.team_attendance_strikes set rescinded_by=auth.uid(),rescinded_at=now(),rescind_reason=trim(p->>'explanation') where id=s.id;
 else raise exception 'Unknown attendance action'; end if;
 return coalesce(result,'{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.team_attendance_policy_action(action text, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=nullif(p->>'student_id','')::uuid; note text:=trim(coalesce(p->>'note',''));
begin
 perform pg_advisory_xact_lock(4418,10);
 if not team_attendance_private.reviewer() then raise exception 'Assigned Lead Coach or eligible Program Manager required' using errcode='42501';end if;
 if length(note)>2000 then raise exception 'Note must be at most 2000 characters';end if;
 if action='warning_parent_contact' then
  if uid=auth.uid() or not team_attendance_private.is_participant(uid) then raise exception 'Choose another active Attendance participant';end if;
  insert into public.team_attendance_history(student_id,entity,entity_id,action,after_data,performed_by)
  values(uid,'attendance_policy',uid::text,'WARNING_PARENT_CONTACT',jsonb_build_object('note',note),auth.uid());
 else raise exception 'Unknown policy action';end if;
end $function$;

CREATE OR REPLACE FUNCTION public.team_attendance_outreach_goal(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old team_attendance_private.outreach_goal;next team_attendance_private.outreach_goal;
begin
 if auth.uid() is null or not coalesce(team_attendance_private.role() in ('mentor'),false) then raise exception 'Mentor required' using errcode='42501';end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('version','target_hours')) then raise exception 'Only the hours target can be changed; outreach years remain May 1 through April 30';end if;
 select * into old from team_attendance_private.outreach_goal where id for update;
 if not coalesce(team_attendance_private.role() in ('mentor'),false) then raise exception 'Mentor required' using errcode='42501';end if;
 if (p->>'version')::integer is distinct from old.version then raise exception 'Outreach goal changed. Refresh and try again.';end if;
 update team_attendance_private.outreach_goal set target_hours=(p->>'target_hours')::numeric,version=version+1
 where id returning * into next;
 insert into public.team_attendance_history(entity,entity_id,action,before_data,after_data,performed_by)
 values('stem_outreach_goal','team','UPDATE',to_jsonb(old),to_jsonb(next),auth.uid());
 return to_jsonb(next)-'id';
end $function$;

CREATE OR REPLACE FUNCTION public.team_attendance_outreach_summary(period_start_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare goal team_attendance_private.outreach_goal;viewer uuid:=auth.uid();all_members boolean;
 today date:=(clock_timestamp() at time zone 'America/Denver')::date;current_year integer;chosen_year integer;
 from_at timestamptz;until_at timestamptz;totals jsonb;years jsonb;oldest_year integer;
begin
 if viewer is null or not (team_attendance_private.participant() or team_attendance_private.reader()) then
  raise exception 'Active Attendance access required' using errcode='42501';end if;
 all_members:=team_attendance_private.reader();
 select * into goal from team_attendance_private.outreach_goal where id;
 current_year:=extract(year from today)::integer;
 if today<make_date(current_year,5,1) then current_year:=current_year-1;end if;
 chosen_year:=coalesce(period_start_year,current_year);
 if chosen_year<1 or chosen_year>current_year then raise exception 'Choose the current outreach year or a prior year';end if;
 from_at:=make_date(chosen_year,5,1)::timestamp at time zone 'America/Denver';
 until_at:=make_date(chosen_year+1,5,1)::timestamp at time zone 'America/Denver';
 with eligible as (
  select a.student_id,a.checked_in_at,a.left_at,m.starts_at
  from public.team_attendance a join public.team_meetings m on m.id=a.meeting_id
  where m.meeting_type='stem_outreach' and (all_members or a.student_id=viewer)
 ), intervals as (
  select student_id,range_agg(tstzrange(greatest(checked_in_at,from_at),least(left_at,until_at),'[)')) as periods
  from eligible where checked_in_at is not null and left_at is not null
   and isfinite(checked_in_at) and isfinite(left_at) and left_at>checked_in_at
   and left_at>from_at and checked_in_at<until_at group by student_id
 ), hours as (
  select student_id,round((sum(extract(epoch from(upper(r)-lower(r))))/3600)::numeric,2) as hours
  from intervals cross join lateral unnest(periods) r group by student_id
 ), missing as (
  select student_id,count(*) as missing_checkouts from eligible
  where checked_in_at is not null and left_at is null and checked_in_at>=from_at and checked_in_at<until_at group by student_id
 ) select coalesce(jsonb_agg(jsonb_build_object('student_id',p.id,'display_name',p.display_name,
  'hours',coalesce(h.hours,0),'missing_checkouts',coalesce(m.missing_checkouts,0)) order by p.display_name),'[]') into totals
 from public.profiles p left join hours h on h.student_id=p.id left join missing m on m.student_id=p.id
 where (all_members or p.id=viewer) and (team_attendance_private.is_participant(p.id)
  or (all_members and exists(select 1 from eligible e where e.student_id=p.id and e.checked_in_at is not null)));
 select least(current_year,min(extract(year from d)::integer-case when extract(month from d)<5 then 1 else 0 end)) into oldest_year
 from (select (a.checked_in_at at time zone 'America/Denver')::date d from public.team_attendance a
  join public.team_meetings m on m.id=a.meeting_id where m.meeting_type='stem_outreach'
   and a.checked_in_at is not null and isfinite(a.checked_in_at) and (all_members or a.student_id=viewer)) dates;
 select jsonb_agg(y order by y desc) into years from generate_series(least(chosen_year,coalesce(oldest_year,current_year)),current_year) y;
 return jsonb_build_object('goal',to_jsonb(goal)-'id','members',totals,
  'can_configure',team_attendance_private.role() in ('mentor'),'available_years',years,
  'period',jsonb_build_object('start_year',chosen_year,'current_start_year',current_year,
   'start_date',make_date(chosen_year,5,1),'end_date',make_date(chosen_year+1,5,1)-1,'time_zone','America/Denver'));
end $function$;

CREATE OR REPLACE FUNCTION team_private.announcement_audience(kind text, area uuid, pos text, uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.profiles p where p.id=uid and p.active and
 case kind when 'all' then true when 'registered' then p.role::text in ('student','lead','admin_lead') and exists(select 1 from public.team_attendance_members m where m.student_id=p.id and m.member_status='registered')
 when 'leadership' then p.role::text in ('mentor') when 'area' then p.primary_area_id=area
 when 'position' then exists(select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=p.id and mp.position_key=pos and mp.revoked_at is null and p.role::text in ('student','lead','admin_lead','mentor')) else false end)
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
 and not exists(select 1 from public.profiles p where p.id=n.recipient_id and p.active and (p.role::text in ('student','lead','admin_lead','mentor') or (n.source='hub' and p.role::text='readonly')));
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
declare pr public.profiles; leadership boolean; personal jsonb; next_meeting jsonb; orders jsonb; actions jsonb; attention jsonb; robot jsonb; stock jsonb; coach_self jsonb;
begin
 select * into pr from public.profiles where id=auth.uid() and active;
 if not found then raise exception 'Active team account required' using errcode='42501';end if;
 -- Reuse the authenticated public projection; preserve SECURITY INVOKER and private helper ACLs.
 coach_self:=coalesce(public.finance_context()->'coach_self_approvals','[]'::jsonb);
 leadership:=pr.role::text in ('lead','admin_lead','mentor');
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
 select jsonb_build_object('approvals',count(*) filter(where p.status='awaiting_approval' and (p.requester_id<>pr.id or exists(select 1 from jsonb_array_elements(coach_self) c where c->>'po_id'=p.id::text and c->>'allowed'='true'))
 and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and (a.action='changes_requested' or a.actor_id=pr.id))
 and ((finance_private.cap('finance_approver') and p.requester_id<>pr.id and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.slot='finance_approver' and a.action='approved'))
 or (finance_private.cap('po_approver') and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.slot='po_approver' and a.action='approved')))),
 'school',count(*) filter(where p.status='approved' and (finance_private.cap('school_submitter') or pr.role::text in ('mentor'))
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
 return jsonb_build_object('name',pr.display_name,'role',pr.role,'admin',pr.role::text in ('mentor'),'personal',personal,'next_meeting',next_meeting,'orders',orders,'finance',actions,'attention',attention,'robot',robot,'inventory',stock,
 'announcements',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'severity',severity,'created_at',created_at,'expires_at',expires_at,'image_path',image_path,'audience',audience) order by case severity when 'urgent' then 0 when 'important' then 1 else 2 end,created_at desc),'[]') from public.team_announcements where active and (expires_at is null or expires_at>now())));
end $function$;
-- This digest binds the user-confirmed sole legacy account and reviewed version.
-- Synthetic tests substitute only this literal with their explicitly synthetic guard.
do $transition$ declare target public.profiles;unchanged jsonb;other_profiles jsonb;assignments jsonb;begin
 if (select count(*) from public.profiles where role='admin')<>1 then raise exception 'Expected exactly one confirmed legacy Admin account';end if;
 select * into target from public.profiles where role='admin' for update;
 if not target.active or encode(sha256(convert_to(target.id::text||'|'||to_char(target.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),'UTF8')),'hex')<>'097758133e058fdb16f766315902a75c7576517f6a91021bb1667362398ece48' then raise exception 'Confirmed legacy account or version changed';end if;
 unchanged:=to_jsonb(target)-array['role','updated_at'];
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into other_profiles from public.profiles p where id<>target.id;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into assignments from public.team_member_positions p;
 update public.profiles set role='admin_lead' where id=target.id;
 if (select to_jsonb(p)-array['role','updated_at'] from public.profiles p where id=target.id) is distinct from unchanged
 or (select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.profiles p where id<>target.id) is distinct from other_profiles
 or (select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.team_member_positions p) is distinct from assignments then raise exception 'Canonical transition changed unrelated data';end if;
end $transition$;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('readonly','student','lead','admin_lead','mentor'));
-- Historical invitations retain their original recorded role. New reserve/finish
-- paths above forbid creating/provisioning the retired role; no audit rewrite.
commit;
