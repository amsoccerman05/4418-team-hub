-- Narrow production corrections: worker profile lookup and Team Management role safety.
begin;
-- The existing worker filters by id and reads only active/role. No broad profile grant.
grant select(id,active,role) on public.profiles to service_role;
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
 if length(trim(coalesce(p->>'display_name',''))) not between 1 and 150 or coalesce(p->>'role','') not in ('student','lead','admin','mentor','readonly') or p->>'active' is null then raise exception 'Valid name, role and active status required'; end if;
 if next_area is not null and not exists(select 1 from public.areas where id=next_area and active) then raise exception 'Choose an active area'; end if;
 if pr.active and pr.role::text in ('admin','mentor') and (not (p->>'active')::boolean or p->>'role' not in ('admin','mentor')) and not exists(select 1 from public.profiles where id<>target and active and role::text in ('admin','mentor')) then raise exception 'Keep at least one active admin or mentor'; end if;
 if target=auth.uid() and p->>'role' is distinct from pr.role::text then raise exception 'Ask another mentor to change your account role' using errcode='42501'; end if;
 if p->>'role'='admin' and pr.role::text<>'admin' and exists(select 1 from public.profiles where id=auth.uid() and role::text='mentor') then raise exception 'Choose Mentor, Lead, Student or Readonly; Admin is a legacy role' using errcode='42501'; end if;
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
 if not pr.active or pr.role::text not in ('student','lead','admin','mentor') then raise exception 'Choose an active student or leadership account'; end if;
 if not exists(select 1 from public.team_positions where key=p->>'position_key' and active) then raise exception 'Choose an active position'; end if;
 insert into public.team_member_positions(user_id,position_key,assigned_by,assignment_reason) values(target,p->>'position_key',auth.uid(),reason) returning * into assignment;
 insert into team_private.management_history(user_id,action,actor_id,reason,after_data) values(target,action,auth.uid(),reason,to_jsonb(assignment));
 elsif action='revoke_position' then
 select * into assignment from public.team_member_positions where id=(p->>'assignment_id')::uuid and user_id=target and revoked_at is null for update;
 if not found then raise exception 'Active assignment not found. Reload.'; end if;
 update public.team_member_positions set revoked_by=auth.uid(),revoked_at=clock_timestamp(),revoke_reason=reason where id=assignment.id;
 insert into team_private.management_history(user_id,action,actor_id,reason,before_data,after_data) select target,action,auth.uid(),reason,to_jsonb(assignment),to_jsonb(n) from public.team_member_positions n where id=assignment.id;
 else raise exception 'Unknown team management action'; end if;
end $function$
;
commit;
