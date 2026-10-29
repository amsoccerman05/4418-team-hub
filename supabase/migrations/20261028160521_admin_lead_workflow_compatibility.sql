-- Admin Lead inherits ordinary Student/Lead workflow eligibility only.
-- Apply after shared student_admin_lead_roles; no account/assignment/data backfill.
-- Named positions remain required wherever Lead needs them. Mentor/Admin-only
-- powers (including Volunteer) remain unchanged. No GRANT/REVOKE or RLS changes.
begin;
select pg_advisory_xact_lock(4418);
-- Exact catalog/ACL preflight; no mutation occurs if the installed baseline or shared core differs.
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_role_check' and pg_get_constraintdef(oid) = 'CHECK ((role = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''admin''::text, ''mentor''::text])))') then raise exception 'Reviewed shared student role core required';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.team_my_positions()') and md5(prosrc)='3a7116cddaf8fadd8ab9cb4447420392' and prosecdef and proconfig=array['search_path=""']) then raise exception 'Reviewed shared position eligibility required';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('fabrication_private.manager(uuid)') and md5(pg_get_functiondef(p.oid))='de2c9d837af4320ffaa8876b5648bf5d' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=false and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed fabrication_private.manager differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('fabrication_private.writer(uuid)') and md5(pg_get_functiondef(p.oid))='cb3ae11d3e5565c0e104a0f266a4053a' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=false and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed fabrication_private.writer differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('outreach_private.can_add_contact(uuid,uuid)') and md5(pg_get_functiondef(p.oid))='a5ed88db420dd40ab0eb345876f8710a' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=true and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed outreach_private.can_add_contact differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('outreach_private.can_edit_record(text,uuid,uuid)') and md5(pg_get_functiondef(p.oid))='3b28cf2b7adccc015262e4a0dd631d89' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=true and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed outreach_private.can_edit_record differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('outreach_private.can_work_engagement(uuid,uuid)') and md5(pg_get_functiondef(p.oid))='7dce41b33e88cb22fdc7b6bcadfc97f7' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=true and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed outreach_private.can_work_engagement differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('outreach_private.context(uuid)') and md5(pg_get_functiondef(p.oid))='bb58b90e4cc730e6409ee2e4efa2798a' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' and p.prosecdef=true and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed outreach_private.context differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('outreach_private.require_participant(uuid)') and md5(pg_get_functiondef(p.oid))='ab1e8e69222e981771e5714a511f9afc' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=true and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed outreach_private.require_participant differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('outreach_private.save(text,jsonb,uuid,uuid)') and md5(pg_get_functiondef(p.oid))='171f652714ddd0c72bd6dbf4c5dc4775' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' and p.prosecdef=true and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed outreach_private.save differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_goals_private.goal_contributor(uuid)') and md5(pg_get_functiondef(p.oid))='a4da1ac801a0d83128002824cd1988ea' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=false and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed planning_goals_private.goal_contributor differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_goals_private.goal_student(uuid)') and md5(pg_get_functiondef(p.oid))='7890433f6c60415c58108faef3900987' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=false and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed planning_goals_private.goal_student differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_goals_private.goals_context(uuid)') and md5(pg_get_functiondef(p.oid))='3348eae7f22fcf4ed90970b7cae9afcb' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' and p.prosecdef=true and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed planning_goals_private.goals_context differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_private.context(uuid,boolean)') and md5(pg_get_functiondef(p.oid))='e095e66090cae2ac8c581261952d0280' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=true and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed planning_private.context differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_private.manager()') and md5(pg_get_functiondef(p.oid))='3686abd12a2d257f3b71931348b213c8' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=true and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed planning_private.manager differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_review_private.decision_workflow_valid(jsonb,jsonb,jsonb)') and md5(pg_get_functiondef(p.oid))='c75575fed2ea821816f3e837f04e15c5' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=false and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed planning_review_private.decision_workflow_valid differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_review_private.person(uuid)') and md5(pg_get_functiondef(p.oid))='8b5f1a2f459bc8eb3750a1048f676590' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=false and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed planning_review_private.person differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_review_private.writer()') and md5(pg_get_functiondef(p.oid))='feae6abf2fac5e850d19a67c2141a681' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres}' and p.prosecdef=false and p.provolatile='s' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed planning_review_private.writer differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('planning_save(text,jsonb)') and md5(pg_get_functiondef(p.oid))='c5a5557ff818c27153449a0257f7a913' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' and p.prosecdef=true and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed public.planning_save differs from reviewed baseline';end if;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('sprint_review_save(text,uuid,uuid,jsonb)') and md5(pg_get_functiondef(p.oid))='14e6b9e79fe642bb99d806bca525e857' and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' and p.prosecdef=true and p.provolatile='v' and p.proconfig is not distinct from array['search_path=""']::text[]) then raise exception 'Installed public.sprint_review_save differs from reviewed baseline';end if;
end $$;
create or replace function planning_private.manager() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and
 (p.role::text in ('mentor','admin') or (p.role::text in ('student','lead','admin_lead') and exists(
 select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=p.id and mp.revoked_at is null and tp.key in
 ('program_manager','product_technical_manager','finance_lead','software_lead','business_lead','cad_lead','fabrication_lead','strategy_lead','power_lead','communications_lead','operations_lead')))))
$$;

create or replace function public.planning_save(entity text,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare ident uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); sid uuid; bid uuid; tid uuid;
 old jsonb; result jsonb; owners uuid[]; prior_owners uuid[]:=array[]::uuid[]; manager boolean; owner uuid; ar uuid; pred uuid; b public.planning_boards; t public.planning_tasks;
begin
 perform pg_advisory_xact_lock(4418,30);
 if not planning_private.member() then raise exception 'Active team account required' using errcode='42501';end if;
 -- Retained assignments never grant write access after a role demotion.
 -- Keep member() unchanged so active readonly accounts retain their read access.
 if not exists(select 1 from public.profiles where id=auth.uid() and active
  and role::text in ('student','lead','admin_lead','mentor','admin')) then
  raise exception 'Active Planning writer account required' using errcode='42501';
 end if;
 manager:=planning_private.manager();
 if entity not in ('season','group','board','item','task','step','comment') then raise exception 'Unknown Planning action';end if;
 if entity in ('season','group','board','item') and not manager then raise exception 'Planning leadership required' using errcode='42501';end if;
 if entity='season' then select to_jsonb(s) into old from public.planning_seasons s where id=ident;sid:=ident;
 elsif entity='group' then select to_jsonb(g) into old from public.planning_groups g where id=ident;sid:=coalesce((old->>'season_id')::uuid,(p->>'season_id')::uuid);
 elsif entity='item' then select to_jsonb(i) into old from public.planning_items i where id=ident;sid:=coalesce((old->>'season_id')::uuid,(p->>'season_id')::uuid);
 elsif entity='board' then select to_jsonb(x) into old from public.planning_boards x where id=ident;sid:=case when old is not null then (old->>'season_id')::uuid when p->>'kind'='area' then null else (p->>'season_id')::uuid end;
 elsif entity='task' then
  select * into t from public.planning_tasks where id=ident;old:=case when found then to_jsonb(t) end;
  bid:=coalesce(t.board_id,(p->>'board_id')::uuid);tid:=ident;
  select coalesce(array_agg(user_id order by user_id),array[]::uuid[]) into prior_owners from public.planning_task_assignees where task_id=ident;
  if old is not null then old:=old||jsonb_build_object('owner_ids',prior_owners,'owners',planning_private.task_owners(ident));end if;
  -- Fail closed for an old frontend; never interpret a legacy singleton as a replacement set.
  if p ? 'owner_id' then raise exception 'Task ownership has changed. Reload Planning before saving.';end if;
  if p ? 'owner_ids' then
   if jsonb_typeof(p->'owner_ids') is distinct from 'array' then raise exception 'Owners must be a list';end if;
   if exists(select 1 from jsonb_array_elements(p->'owner_ids') x where jsonb_typeof(x)<>'string') then raise exception 'Invalid owner identity';end if;
   select coalesce(array_agg(distinct x::uuid order by x::uuid),array[]::uuid[]) into owners from jsonb_array_elements_text(p->'owner_ids') x;
   if cardinality(owners)<>jsonb_array_length(p->'owner_ids') then raise exception 'Duplicate owner';end if;
  else owners:=prior_owners;end if;
 else
  if entity='step' then select to_jsonb(s) into old from public.planning_steps s where id=ident;end if;
  tid:=coalesce((old->>'task_id')::uuid,(p->>'task_id')::uuid);
  select * into t from public.planning_tasks where id=tid;bid:=t.board_id;
 end if;
 if old is not null and entity<>'comment' and (old->>'version')::integer is distinct from (p->>'version')::integer then raise exception 'Changed by another teammate. Refresh before saving.';end if;
 if entity in ('task','step','comment') then
  select * into b from public.planning_boards where id=bid;
  if not found or not b.active then raise exception 'Active board required';end if;sid:=b.season_id;
  if not manager and entity<>'comment' and (t.id is null or not exists(select 1 from public.planning_task_assignees a where a.task_id=t.id and a.user_id=auth.uid())) then raise exception 'Only assigned tasks may be updated' using errcode='42501';end if;
  if not manager and entity='task' and (owners is distinct from prior_owners or nullif(p->>'board_id','')::uuid is distinct from t.board_id or nullif(p->>'area_id','')::uuid is distinct from t.area_id) then raise exception 'Only leadership can reassign tasks' using errcode='42501';end if;
 end if;
 if entity<>'season' and sid is not null and not exists(select 1 from public.planning_seasons where id=sid and status<>'archived' and (manager or status='active')) then raise exception 'Season is unavailable or archived';end if;
 if entity='season' and old->>'status'='archived' then raise exception 'Archived seasons are read only';end if;
 if entity='task' and exists(select 1 from unnest(owners) u where not (u=any(prior_owners)) and not exists(select 1 from public.profiles where id=u and active)) then raise exception 'Choose an active owner';end if;
 owner:=nullif(p->>'owner_id','')::uuid;ar:=nullif(p->>'area_id','')::uuid;
 if owner is not null and not exists(select 1 from public.profiles where id=owner and active) then raise exception 'Choose an active owner';end if;
 if ar is not null and not exists(select 1 from public.areas where id=ar and active) then raise exception 'Choose an active area';end if;
 if entity='season' then
  insert into public.planning_seasons(id,name,start_date,end_date,status,created_by)
  values(ident,trim(p->>'name'),nullif(p->>'start_date','')::date,nullif(p->>'end_date','')::date,coalesce(p->>'status','draft'),auth.uid())
  on conflict(id) do update set name=excluded.name,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,updated_at=clock_timestamp(),version=planning_seasons.version+1 returning to_jsonb(planning_seasons.*) into result;
 elsif entity='group' then
  if coalesce((p->>'active')::boolean,true)=false and exists(select 1 from public.planning_items where group_id=ident) then raise exception 'Move plan items before archiving this group';end if;
  insert into public.planning_groups(id,season_id,name,display_order,active) values(ident,sid,trim(p->>'name'),coalesce((p->>'display_order')::integer,0),coalesce((p->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,display_order=excluded.display_order,active=excluded.active,version=planning_groups.version+1 returning to_jsonb(planning_groups.*) into result;
 elsif entity='board' then
  if old is not null and (old->>'kind' is distinct from p->>'kind' or (old->>'season_id')::uuid is distinct from nullif(p->>'season_id','')::uuid) then raise exception 'Board type and season cannot change';end if;
  insert into public.planning_boards(id,season_id,name,description,kind,area_id,active,display_order,created_by)
  values(ident,sid,trim(p->>'name'),coalesce(p->>'description',''),p->>'kind',ar,coalesce((p->>'active')::boolean,true),coalesce((p->>'display_order')::integer,0),auth.uid())
  on conflict(id) do update set name=excluded.name,description=excluded.description,area_id=excluded.area_id,active=excluded.active,display_order=excluded.display_order,version=planning_boards.version+1 returning to_jsonb(planning_boards.*) into result;
 elsif entity='item' then
  pred:=nullif(p->>'predecessor_id','')::uuid;
  if pred is not null and exists(with recursive chain as (select id,predecessor_id from public.planning_items where id=pred union select i.id,i.predecessor_id from public.planning_items i join chain c on i.id=c.predecessor_id) select 1 from chain where id=ident) then raise exception 'Dependency would create a cycle';end if;
  if nullif(p->>'board_id','') is not null and not exists(select 1 from public.planning_boards where id=(p->>'board_id')::uuid and active and (season_id=sid or kind='area')) then raise exception 'Choose an active board in this season';end if;
  if nullif(p->>'group_id','') is not null and not exists(select 1 from public.planning_groups where id=(p->>'group_id')::uuid and season_id=sid and active) then raise exception 'Choose an active group';end if;
  insert into public.planning_items(id,season_id,title,description,kind,start_date,end_date,status,group_id,board_id,owner_id,area_id,predecessor_id,display_order)
  values(ident,sid,trim(p->>'title'),coalesce(p->>'description',''),p->>'kind',(p->>'start_date')::date,(p->>'end_date')::date,p->>'status',nullif(p->>'group_id','')::uuid,nullif(p->>'board_id','')::uuid,owner,ar,pred,coalesce((p->>'display_order')::integer,0))
  on conflict(id) do update set title=excluded.title,description=excluded.description,kind=excluded.kind,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,group_id=excluded.group_id,board_id=excluded.board_id,owner_id=excluded.owner_id,area_id=excluded.area_id,predecessor_id=excluded.predecessor_id,display_order=excluded.display_order,version=planning_items.version+1 returning to_jsonb(planning_items.*) into result;
 elsif entity='task' then
  insert into public.planning_tasks(id,board_id,title,description,status,priority,area_id,start_date,due_date,blocked_reason,created_by)
  values(ident,bid,trim(p->>'title'),coalesce(p->>'description',''),p->>'status',p->>'priority',ar,nullif(p->>'start_date','')::date,nullif(p->>'due_date','')::date,coalesce(p->>'blocked_reason',''),auth.uid())
  on conflict(id) do update set title=excluded.title,description=excluded.description,status=excluded.status,priority=excluded.priority,area_id=excluded.area_id,start_date=excluded.start_date,due_date=excluded.due_date,blocked_reason=excluded.blocked_reason,updated_at=clock_timestamp(),version=planning_tasks.version+1 returning to_jsonb(planning_tasks.*) into result;
  delete from public.planning_task_assignees where task_id=ident and not (user_id=any(owners));
  insert into public.planning_task_assignees(task_id,user_id,assigned_by)
   select ident,u,auth.uid() from unnest(owners) u where not (u=any(prior_owners));
  result:=result||jsonb_build_object('owner_ids',owners,'owners',planning_private.task_owners(ident));
 elsif entity='step' then
  insert into public.planning_steps(id,task_id,text,done,display_order) values(ident,tid,trim(p->>'text'),coalesce((p->>'done')::boolean,false),coalesce((p->>'display_order')::integer,0))
  on conflict(id) do update set text=excluded.text,done=excluded.done,display_order=excluded.display_order,version=planning_steps.version+1 returning to_jsonb(planning_steps.*) into result;
 else
  insert into public.planning_comments(id,task_id,text,author_id) values(ident,tid,trim(p->>'text'),auth.uid()) returning to_jsonb(planning_comments.*) into result;
 end if;
 insert into planning_private.history(entity,entity_id,task_id,actor_id,action,before_data,after_data)
 values(entity,ident,tid,auth.uid(),case when old is null then 'created' else 'updated' end,old,result);
 return ident;
end $$;

create or replace function planning_private.context(selected_season uuid,only_mine boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid; manager boolean;
begin
 if not planning_private.member() then raise exception 'Active team account required' using errcode='42501';end if;
 manager:=planning_private.manager();
 select id into sid from public.planning_seasons where (selected_season is null or id=selected_season)
 and (manager or status='active') order by (status='active') desc,created_at desc limit 1;
 if selected_season is not null and sid is null then raise exception 'Season unavailable' using errcode='42501';end if;
 return (with visible_tasks as (
 select t.* from public.planning_tasks t join public.planning_boards b on b.id=t.board_id
 where (b.season_id=sid or (b.kind='area' and sid is not null)) and (manager or b.active)
 and (not only_mine or (b.active and exists(select 1 from public.planning_task_assignees a where a.task_id=t.id and a.user_id=auth.uid())))
 ), assignment_sets as (
 select a.task_id,jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',p.active) order by p.id) owners,
 jsonb_agg(p.id order by p.id) owner_ids from public.planning_task_assignees a join visible_tasks t on t.id=a.task_id join public.profiles p on p.id=a.user_id group by a.task_id
 ) select jsonb_build_object('user_id',auth.uid(),'can_manage',manager,'can_write',exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','mentor','admin')),'season_id',sid,
 'seasons',(select coalesce(jsonb_agg(to_jsonb(s) order by created_at desc),'[]') from public.planning_seasons s where manager or status='active'),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),'[]') from public.profiles where active),
 'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.areas where active),
 'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by display_order,name),'[]') from public.planning_groups g where season_id=sid),
 'items',(select coalesce(jsonb_agg(to_jsonb(i) order by display_order,start_date,title),'[]') from public.planning_items i where season_id=sid),
 'boards',(select coalesce(jsonb_agg(to_jsonb(b) order by display_order,name),'[]') from public.planning_boards b where (season_id=sid or (kind='area' and sid is not null)) and (manager or active)),
 'dependencies',(select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at,d.id),'[]') from public.planning_task_dependencies d join public.planning_boards b on b.id=d.board_id where (b.season_id=sid or (b.kind='area' and sid is not null)) and (manager or b.active) and (not only_mine or exists(select 1 from visible_tasks v where v.id=d.successor_task_id))),
 'dependency_tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'board_id',t.board_id,'title',t.title,'status',t.status)),'[]') from public.planning_tasks t where only_mine and exists(select 1 from visible_tasks v where v.board_id=t.board_id)),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('owner_ids',coalesce(a.owner_ids,'[]'),'owners',coalesce(a.owners,'[]')) order by t.created_at,t.id),'[]') from visible_tasks t left join assignment_sets a on a.task_id=t.id)));
end $$;

create or replace function outreach_private.require_participant(expected_actor uuid default null) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or (expected_actor is not null and expected_actor<>actor) or not exists(
  select 1 from public.profiles where id=actor and active and role::text in ('admin','mentor','student','lead','admin_lead'))
 then raise exception 'Active outreach account required' using errcode='42501';end if;
 return actor;
end $$;

create or replace function outreach_private.can_work_engagement(eng uuid,actor uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from outreach_private.engagements e join outreach_private.organizations o on o.id=e.organization_id
 join public.finance_seasons s on s.id=e.season_id join public.profiles p on p.id=actor
 where e.id=eng and o.active and s.status<>'closed' and p.active and p.role::text in ('admin','mentor','student','lead','admin_lead')
 and (p.role::text in ('admin','mentor') or e.created_by=actor or e.owner_id=actor))
$$;

create or replace function outreach_private.can_add_contact(org uuid,actor uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from outreach_private.organizations o join public.profiles p on p.id=actor
 where o.id=org and o.active and p.active and p.role::text in ('admin','mentor','student','lead','admin_lead')
 and (p.role::text in ('admin','mentor') or o.created_by=actor or exists(select 1 from outreach_private.engagements e
 where e.organization_id=org and outreach_private.can_work_engagement(e.id,actor))))
$$;

create or replace function outreach_private.can_edit_record(entity text,ident uuid,actor uuid) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=actor and active and role::text in ('admin','mentor','student','lead','admin_lead')) then return false;end if;
 if entity='organization' then return exists(select 1 from outreach_private.organizations o where o.id=ident and
  (outreach_private.manager(actor) or (o.active and o.created_by=actor)));
 elsif entity='contact' then return exists(select 1 from outreach_private.contacts c where c.id=ident and
  (outreach_private.manager(actor) or c.created_by=actor) and outreach_private.can_add_contact(c.organization_id,actor));
 elsif entity='engagement' then return outreach_private.can_work_engagement(ident,actor);
 elsif entity='conversation' then return exists(select 1 from outreach_private.conversations c where c.id=ident and
  (outreach_private.manager(actor) or c.created_by=actor) and outreach_private.can_work_engagement(c.engagement_id,actor));
 elsif entity='pledge' then return outreach_private.manager(actor) and exists(select 1 from outreach_private.pledges p where p.id=ident and outreach_private.can_work_engagement(p.engagement_id,actor));
 elsif entity='recognition' then return outreach_private.manager(actor) and exists(select 1 from outreach_private.recognition r where r.id=ident and outreach_private.can_work_engagement(r.engagement_id,actor));
 end if;
 return false;
end $$;

create or replace function outreach_private.context(selected_season uuid default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; sid uuid; can_finance boolean; manager boolean;
begin
 actor:=outreach_private.require_participant();manager:=outreach_private.manager(actor);
 select id into sid from public.finance_seasons where selected_season is null or id=selected_season
 order by (status='active') desc,created_at desc,id limit 1;
 if selected_season is not null and sid is null then raise exception 'Season unavailable' using errcode='22023';end if;
 can_finance:=manager and coalesce(finance_private.can_manage_budget(),false);
 return jsonb_build_object('contract_version',2,'user_id',actor,'can_manage',manager,'can_link_finance',can_finance,'financials_redacted',not manager,'season_id',sid,
 'can_create_prospect',exists(select 1 from public.finance_seasons where id=sid and status<>'closed'),
 'seasons',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'starts_on',outreach_private.safe_date(s.starts_on),'ends_on',outreach_private.safe_date(s.ends_on)) order by s.created_at desc,s.id),'[]') from public.finance_seasons s),
 'owners',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,'Team member')) order by display_name,id),'[]') from public.profiles where active and role::text in ('admin','mentor','student','lead','admin_lead')),
 'organizations',(select coalesce(jsonb_agg((to_jsonb(o)-'notes')||jsonb_build_object('notes',case when manager then o.notes else null end,'notes_redacted',not manager,
  'can_edit',outreach_private.can_edit_record('organization',o.id,actor),'can_add_contact',outreach_private.can_add_contact(o.id,actor),
  'can_create_engagement',o.active and (manager or o.created_by=actor) and exists(select 1 from public.finance_seasons where id=sid and status<>'closed') and not exists(select 1 from outreach_private.engagements e where e.organization_id=o.id and e.season_id=sid)) order by o.name,o.id),'[]') from outreach_private.organizations o),
 'contacts',(select coalesce(jsonb_agg((to_jsonb(c)-'notes')||jsonb_build_object('notes',case when manager then c.notes else null end,'notes_redacted',not manager,
  'can_edit',outreach_private.can_edit_record('contact',c.id,actor)) order by c.name,c.id),'[]') from outreach_private.contacts c),
 'engagements',(select coalesce(jsonb_agg((to_jsonb(e)-'notes')||jsonb_build_object('notes',case when manager then e.notes else null end,'notes_redacted',not manager,
  'can_edit',outreach_private.can_work_engagement(e.id,actor),'can_log',outreach_private.can_work_engagement(e.id,actor),'can_assign',manager and outreach_private.can_work_engagement(e.id,actor)) order by e.created_at,e.id),'[]') from outreach_private.engagements e where e.season_id=sid),
 'conversations',(select coalesce(jsonb_agg((to_jsonb(c)-'summary')||jsonb_build_object('summary',case when manager or c.created_by=actor then c.summary else null end,
  'summary_redacted',not(manager or c.created_by=actor),'author_name',coalesce(p.display_name,'Team member'),'can_edit',false) order by c.occurred_on desc,c.created_at desc,c.id),'[]') from outreach_private.conversations c join outreach_private.engagements e on e.id=c.engagement_id join public.profiles p on p.id=c.created_by where e.season_id=sid),
 'pledges',case when manager then (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]') from outreach_private.pledges p join outreach_private.engagements e on e.id=p.engagement_id where e.season_id=sid) else '[]'::jsonb end,
 'recognition',case when manager then (select coalesce(jsonb_agg(to_jsonb(r) order by r.due_on,r.id),'[]') from outreach_private.recognition r join outreach_private.engagements e on e.id=r.engagement_id where e.season_id=sid) else '[]'::jsonb end,
 'income',case when can_finance then (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'season_id',i.season_id,'source',i.source,'income_type',i.income_type,'amount',i.amount,'status',i.status,'expected_on',outreach_private.safe_date(i.expected_on),'received_on',outreach_private.safe_date(i.received_on),'reference',i.reference) order by i.created_at desc,i.id),'[]') from public.finance_income i where i.season_id=sid) else '[]'::jsonb end,
 'income_links',case when can_finance then (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at,l.id),'[]') from outreach_private.income_links l join outreach_private.pledges p on p.id=l.pledge_id join outreach_private.engagements e on e.id=p.engagement_id where e.season_id=sid) else '[]'::jsonb end);
end $$;

create or replace function outreach_private.save(entity text,p jsonb,request_id uuid,expected_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; ident uuid; table_name text; previous jsonb; after_value jsonb; result jsonb; receipt outreach_private.requests; input_payload jsonb:=p; manager boolean;
 org uuid; eng uuid; sid uuid; owner uuid; contact uuid; pledge uuid; current_version integer;
begin
 actor:=outreach_private.require_participant(expected_actor);manager:=outreach_private.manager(actor);
 if not manager and entity in ('pledge','recognition') then raise exception 'Mentor oversight required' using errcode='42501';end if;
 if expected_actor is null or request_id is null or p is null or jsonb_typeof(p)<>'object' then raise exception 'Actor, request and object payload required' using errcode='22023';end if;
 table_name:=case entity when 'prospect' then 'organizations' when 'organization' then 'organizations' when 'contact' then 'contacts' when 'engagement' then 'engagements' when 'conversation' then 'conversations' when 'pledge' then 'pledges' when 'recognition' then 'recognition' end;
 if table_name is null then raise exception 'Unknown Outreach entity' using errcode='22023';end if;
 ident:=nullif(p->>'id','')::uuid;current_version:=(p->>'version')::integer;
 if ident is null or current_version is null or current_version<0 then raise exception 'Record ID and version required' using errcode='22023';end if;
 -- Small-team V1: one short transaction lock avoids cross-entity races. No I/O
 -- or notification dispatch is performed while holding it.
 perform pg_advisory_xact_lock(4418,80);
 actor:=outreach_private.require_participant(expected_actor);manager:=outreach_private.manager(actor);
 if not manager and entity in ('pledge','recognition') then raise exception 'Mentor oversight required' using errcode='42501';end if;
 select * into receipt from outreach_private.requests r where r.actor_id=actor and r.request_id=save.request_id;
 if found then
  if receipt.operation='canceled' then raise exception 'Request was canceled before application' using errcode='22023';end if;
  if receipt.operation<>entity or receipt.payload<>input_payload then raise exception 'Request ID already used for different data' using errcode='22023';end if;
  perform outreach_private.require_receipt(receipt,actor);
  return receipt.result;
 end if;
 execute format('select to_jsonb(t) from outreach_private.%I t where id=$1 for update',table_name) into previous using ident;
 actor:=outreach_private.require_participant(expected_actor);manager:=outreach_private.manager(actor);
 if not manager and entity in ('pledge','recognition') then raise exception 'Mentor oversight required' using errcode='42501';end if;
 if (previous is null and current_version<>0) or (previous is not null and current_version<>(previous->>'version')::integer) then
  raise exception 'Changed by another teammate. Refresh before saving.' using errcode='40001';end if;
 if entity='prospect' and previous is not null then raise exception 'Prospect identity already exists' using errcode='40001';end if;
 if previous is not null and entity='conversation' then raise exception 'Conversation entries are append-only; add a correction note' using errcode='22023';end if;
 if previous is not null then
  if (entity='contact' and previous->>'organization_id' is distinct from p->>'organization_id') or
     (entity='engagement' and (previous->>'organization_id' is distinct from p->>'organization_id' or previous->>'season_id' is distinct from p->>'season_id')) or
     (entity in ('pledge','recognition') and previous->>'engagement_id' is distinct from p->>'engagement_id') then
   raise exception 'Organization, engagement and season links cannot be moved' using errcode='22023';end if;
 end if;
 if entity='prospect' then org:=ident;sid:=(p->>'season_id')::uuid;eng:=nullif(p->>'engagement_id','')::uuid;
  if eng is null then raise exception 'New engagement ID required' using errcode='22023';end if;
 elsif entity='contact' then org:=(p->>'organization_id')::uuid;
 elsif entity='engagement' then org:=(p->>'organization_id')::uuid;sid:=(p->>'season_id')::uuid;
 elsif entity in ('conversation','pledge','recognition') then
  eng:=(p->>'engagement_id')::uuid;
  select e.organization_id,e.season_id into org,sid from outreach_private.engagements e where e.id=eng for update;
  if not found then raise exception 'Engagement unavailable' using errcode='22023';end if;
 end if;
 if entity not in ('organization','prospect') then
  perform 1 from outreach_private.organizations where id=org and active for share;
  if not found then raise exception 'Active organization required' using errcode='22023';end if;
 end if;
 if entity in ('prospect','engagement','conversation','pledge','recognition') then
  perform 1 from public.finance_seasons where id=sid and status<>'closed' for share;
  if not found then raise exception 'Open Finance season required' using errcode='22023';end if;
 end if;
 if entity in ('prospect','engagement','recognition') then
  owner:=nullif(p->>'owner_id','')::uuid;
  if entity='prospect' or (entity='engagement' and not manager and previous is null) then
   if owner is not null and owner<>actor then raise exception 'Only mentors can assign outreach' using errcode='42501';end if;owner:=actor;
  elsif entity='engagement' and not manager then
   if p ? 'owner_id' and owner is distinct from (previous->>'owner_id')::uuid then raise exception 'Only mentors can assign outreach' using errcode='42501';end if;owner:=(previous->>'owner_id')::uuid;
  end if;
  -- Preserving an old assignment does not grant that owner current eligibility.
  -- A still-active creator can edit without a mentor-only cleanup dependency.
  if owner is not null and (entity<>'engagement' or previous is null or owner is distinct from (previous->>'owner_id')::uuid) then
   perform 1 from public.profiles where id=owner and active and role::text in ('admin','mentor','student','lead','admin_lead') for share;
   if not found then raise exception 'Choose an active eligible owner' using errcode='22023';end if;
  end if;
 end if;
 if entity='conversation' then
  contact:=nullif(p->>'contact_id','')::uuid;
  if contact is not null then
   perform 1 from outreach_private.contacts where id=contact and organization_id=org and active for share;
   if not found then raise exception 'Choose an active contact from this organization' using errcode='22023';end if;
  end if;
 elsif entity='recognition' then
  pledge:=nullif(p->>'pledge_id','')::uuid;
  if pledge is not null then
   perform 1 from outreach_private.pledges where id=pledge and engagement_id=eng for share;
   if not found then raise exception 'Choose a pledge from this engagement' using errcode='22023';end if;
  end if;
 elsif entity='pledge' and previous is not null and previous->>'kind' is distinct from p->>'kind' and exists(select 1 from outreach_private.income_links where pledge_id=ident) then
  raise exception 'A Finance-linked pledge must remain cash' using errcode='22023';
 end if;
 -- Recheck live authority after every potentially blocking relationship lock.
 actor:=outreach_private.require_participant(expected_actor);manager:=outreach_private.manager(actor);
 if not manager and entity in ('pledge','recognition') then raise exception 'Mentor oversight required' using errcode='42501';end if;
 if p ? 'created_by' and nullif(p->>'created_by','')::uuid is distinct from coalesce((previous->>'created_by')::uuid,actor) then
  raise exception 'Record authorship cannot be changed' using errcode='42501';end if;
 if entity='conversation' and ((p ? 'author_id' and nullif(p->>'author_id','')::uuid is distinct from actor) or (p ? 'sender_id' and nullif(p->>'sender_id','')::uuid is distinct from actor)) then
  raise exception 'Conversation author is the current account' using errcode='42501';end if;
 if not manager then
  if entity='engagement' and owner is distinct from (case when previous is null then actor else (previous->>'owner_id')::uuid end) then
   raise exception 'Only mentors can assign outreach' using errcode='42501';end if;
  if previous is not null and not outreach_private.can_edit_record(entity,ident,actor) then raise exception 'This record is not owned or assigned to you' using errcode='42501';end if;
  if entity='contact' and not outreach_private.can_add_contact(org,actor) then raise exception 'This sponsor is not owned or assigned to you' using errcode='42501';end if;
  if entity='engagement' and previous is null and not exists(select 1 from outreach_private.organizations where id=org and created_by=actor) then
   raise exception 'Only mentors can assign an existing sponsor prospect' using errcode='42501';end if;
  if entity='conversation' and not outreach_private.can_work_engagement(eng,actor) then raise exception 'This prospect is not owned or assigned to you' using errcode='42501';end if;
  if entity='engagement' and p->>'stage'='committed' and previous->>'stage' is distinct from 'committed' then raise exception 'Only mentors can mark a commitment' using errcode='42501';end if;
  if entity in ('organization','contact') and p ? 'active' and (p->>'active')::boolean is distinct from coalesce((previous->>'active')::boolean,true) then raise exception 'Only mentors can archive contacts or sponsors' using errcode='42501';end if;
  -- A redacted field is never a write: preserve the stored mentor notes/flags.
  p:=jsonb_set(p,'{notes}',coalesce(previous->'notes','""'::jsonb));
  if entity in ('organization','contact') then p:=jsonb_set(p,'{active}',coalesce(previous->'active','true'::jsonb));end if;
 end if;
 if entity='prospect' then
  insert into outreach_private.organizations(id,kind,name,website,notes,created_by)
  values(ident,p->>'kind',trim(p->>'name'),trim(coalesce(p->>'website','')),'',actor);
  insert into outreach_private.engagements(id,organization_id,season_id,stage,owner_id,next_follow_up_on,notes,created_by)
  values(eng,ident,sid,'prospect',actor,nullif(p->>'next_follow_up_on','')::date,'',actor);
  insert into outreach_private.history(entity,entity_id,actor_id,request_id,action,before_data,after_data)
  select 'engagement',eng,actor,save.request_id,'created',null,to_jsonb(e) from outreach_private.engagements e where e.id=eng;
  result:=jsonb_build_object('id',ident,'version',1);
 elsif entity='organization' then
  insert into outreach_private.organizations(id,kind,name,website,notes,active,created_by)
  values(ident,p->>'kind',trim(p->>'name'),trim(coalesce(p->>'website','')),coalesce(p->>'notes',''),coalesce((p->>'active')::boolean,true),actor)
  on conflict(id) do update set kind=excluded.kind,name=excluded.name,website=excluded.website,notes=excluded.notes,active=excluded.active,version=organizations.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 elsif entity='contact' then
  insert into outreach_private.contacts(id,organization_id,name,title,email,phone,notes,active,created_by)
  values(ident,org,trim(p->>'name'),coalesce(p->>'title',''),trim(coalesce(p->>'email','')),coalesce(p->>'phone',''),coalesce(p->>'notes',''),coalesce((p->>'active')::boolean,true),actor)
  on conflict(id) do update set name=excluded.name,title=excluded.title,email=excluded.email,phone=excluded.phone,notes=excluded.notes,active=excluded.active,version=contacts.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 elsif entity='engagement' then
  insert into outreach_private.engagements(id,organization_id,season_id,stage,owner_id,next_follow_up_on,notes,created_by)
  values(ident,org,sid,p->>'stage',owner,nullif(p->>'next_follow_up_on','')::date,coalesce(p->>'notes',''),actor)
  on conflict(id) do update set stage=excluded.stage,owner_id=excluded.owner_id,next_follow_up_on=excluded.next_follow_up_on,notes=excluded.notes,version=engagements.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 elsif entity='conversation' then
  insert into outreach_private.conversations(id,engagement_id,contact_id,occurred_on,channel,summary,created_by)
  values(ident,eng,contact,(p->>'occurred_on')::date,p->>'channel',trim(p->>'summary'),actor)
  returning jsonb_build_object('id',id,'version',version) into result;
 elsif entity='pledge' then
  insert into outreach_private.pledges(id,engagement_id,kind,amount,description,promised_on,expected_on,status,created_by)
  values(ident,eng,p->>'kind',nullif(p->>'amount','')::numeric,trim(p->>'description'),(p->>'promised_on')::date,nullif(p->>'expected_on','')::date,p->>'status',actor)
  on conflict(id) do update set kind=excluded.kind,amount=excluded.amount,description=excluded.description,promised_on=excluded.promised_on,expected_on=excluded.expected_on,status=excluded.status,version=pledges.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 else
  insert into outreach_private.recognition(id,engagement_id,pledge_id,owner_id,kind,description,due_on,status,fulfilled_on,fulfillment_note,created_by)
  values(ident,eng,pledge,owner,p->>'kind',trim(p->>'description'),nullif(p->>'due_on','')::date,p->>'status',nullif(p->>'fulfilled_on','')::date,coalesce(p->>'fulfillment_note',''),actor)
  on conflict(id) do update set pledge_id=excluded.pledge_id,owner_id=excluded.owner_id,kind=excluded.kind,description=excluded.description,due_on=excluded.due_on,status=excluded.status,fulfilled_on=excluded.fulfilled_on,fulfillment_note=excluded.fulfillment_note,version=recognition.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 end if;
 execute format('select to_jsonb(t) from outreach_private.%I t where id=$1',table_name) into after_value using ident;
 insert into outreach_private.history(entity,entity_id,actor_id,request_id,action,before_data,after_data)
 values(entity,ident,actor,save.request_id,case when previous is null then 'created' else 'updated' end,previous,after_value);
 -- Preserve the exact request body separately from server-authored after_data.
 insert into outreach_private.requests(actor_id,request_id,operation,payload,result)
 values(actor,save.request_id,entity,input_payload,result);
 return result;
exception when others then
 -- CHECK/NOT NULL diagnostics can echo the proposed row, including restored
 -- private mentor notes. Sanitize at this directly executable private boundary,
 -- not just the public wrapper. Rethrowing preserves rollback and SQLSTATE.
 raise exception using errcode=sqlstate,
  message=case when sqlstate in ('42501','40001','22023') then sqlerrm else 'Outreach change rejected. Check the fields and refresh before retrying.' end,
  detail='',hint='';
end $$;

create or replace function planning_goals_private.goal_student(person uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where id=person and active and role::text in ('student','lead','admin_lead'))
$$;

create or replace function planning_goals_private.goal_contributor(person uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where id=person and active and role::text in ('student','lead','admin_lead','mentor','admin'))
$$;

create or replace function planning_goals_private.goals_context(selected_season uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid; season public.planning_seasons; manager boolean; writable boolean;
begin
 if not planning_private.member() then raise exception 'Active team account required' using errcode='42501';end if;
 manager:=planning_private.manager();
 select * into season from public.planning_seasons where (selected_season is null or id=selected_season)
 and (manager or status='active') order by (status='active') desc,created_at desc limit 1;
 sid:=season.id;
 if selected_season is not null and sid is null then raise exception 'Season unavailable' using errcode='42501';end if;
 writable:=sid is not null and season.status<>'archived' and (manager or season.status='active');
 return jsonb_build_object('user_id',auth.uid(),'season_id',sid,
 'season',case when sid is null then null else jsonb_build_object('id',sid,'name',season.name,'status',season.status) end,
 'capabilities',jsonb_build_object('can_create',writable and (manager or planning_goals_private.goal_student(auth.uid())),'can_manage',manager,'can_reassign',writable and manager),
 'eligible_owners',(select coalesce(jsonb_agg(planning_goals_private.goal_person(p.id) order by p.display_name,p.id),'[]') from public.profiles p where p.active and p.role::text in ('student','lead','admin_lead') and (manager or p.id=auth.uid())),
 'members',(select coalesce(jsonb_agg(planning_goals_private.goal_person(p.id) order by p.display_name,p.id),'[]') from public.profiles p where p.active and p.role::text in ('student','lead','admin_lead','mentor','admin')),
 'goals',(select coalesce(jsonb_agg(planning_goals_private.goal_snapshot(g.id)||jsonb_build_object(
  'owner',planning_goals_private.goal_person(g.owner_id),
  'supporters',(select coalesce(jsonb_agg(planning_goals_private.goal_person(s.user_id) order by s.user_id),'[]') from public.planning_goal_supporters s where goal_id=g.id),
  'capabilities',jsonb_build_object('can_edit',writable and (manager or (g.owner_id=auth.uid() and planning_goals_private.goal_student(auth.uid()))),
   'can_reassign',writable and manager,
   'can_update',writable and (manager or (g.owner_id=auth.uid() and planning_goals_private.goal_student(auth.uid())) or (planning_goals_private.goal_contributor(auth.uid()) and exists(select 1 from public.planning_goal_supporters where goal_id=g.id and user_id=auth.uid())))),
  'measurement_locked',exists(select 1 from public.planning_goal_updates where goal_id=g.id),
  'updates',(select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('author',planning_goals_private.goal_person(u.author_id)) order by u.goal_version desc),'[]') from public.planning_goal_updates u where goal_id=g.id)
 ) order by g.created_at,g.id),'[]') from public.planning_goals g where g.season_id=sid),
 'tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,
  'board_id',case when (b.season_id=sid or b.kind='area') and (manager or b.active) then t.board_id else null end,
  'title',case when (b.season_id=sid or b.kind='area') and (manager or b.active) then t.title else 'Unavailable task' end,
  'status',case when (b.season_id=sid or b.kind='area') and (manager or b.active) then t.status else 'unavailable' end,
  'owner_ids',case when (b.season_id=sid or b.kind='area') and (manager or b.active) then (select coalesce(jsonb_agg(a.user_id order by a.user_id),'[]') from public.planning_task_assignees a where a.task_id=t.id) else '[]'::jsonb end,
  'available',b.active and (b.season_id=sid or b.kind='area')) order by t.title,t.id),'[]')
  from public.planning_tasks t join public.planning_boards b on b.id=t.board_id
  where sid is not null and ((b.active and (b.season_id=sid or b.kind='area')) or exists(select 1 from public.planning_goal_task_links l join public.planning_goals g on g.id=l.goal_id where l.task_id=t.id and g.season_id=sid))),
 'milestones',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,
  'title',case when i.start_date between date '0001-01-01' and date '9999-12-31' and i.end_date between date '0001-01-01' and date '9999-12-31' then i.title else 'Unavailable milestone' end,
  'start_date',case when i.start_date between date '0001-01-01' and date '9999-12-31' and i.end_date between date '0001-01-01' and date '9999-12-31' then i.start_date else null end,
  'status',case when i.start_date between date '0001-01-01' and date '9999-12-31' and i.end_date between date '0001-01-01' and date '9999-12-31' then i.status else 'unavailable' end,
  'available',i.kind='milestone' and i.start_date between date '0001-01-01' and date '9999-12-31' and i.end_date between date '0001-01-01' and date '9999-12-31') order by i.start_date,i.id),'[]') from public.planning_items i where i.season_id=sid and (i.kind='milestone' or exists(select 1 from public.planning_goal_milestone_links l where l.milestone_id=i.id))));
end $$;

create or replace function planning_review_private.writer() returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','admin_lead','mentor','admin'))
$$;

create or replace function planning_review_private.person(ident uuid) returns jsonb language sql stable set search_path='' as $$
 select case when ident is null then null else coalesce((select jsonb_build_object('id',id,'name',planning_review_private.label(display_name,'Unnamed teammate'),
 'active',coalesce(active,false),'is_student',coalesce(role::text in ('student','lead','admin_lead'),false),
 'can_write',coalesce(active and role::text in ('student','lead','admin_lead','mentor','admin'),false)) from public.profiles where id=ident),
 jsonb_build_object('id',ident,'name','Unavailable teammate','active',false,'is_student',false,'can_write',false)) end
$$;

create or replace function public.sprint_review_save(action text,request_id uuid,expected_actor uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ident uuid; old jsonb; result jsonb; prior planning_review_private.requests; previous_version integer;
 r public.planning_sprint_reviews; u public.planning_sprint_review_updates; a public.planning_project_review_assignments;
 workflow jsonb; member_ids uuid[]; student_ids uuid[]; person_id uuid; task_id uuid; carried_id uuid; item jsonb; field text;
begin
 perform pg_advisory_xact_lock(4418,30);
 perform planning_review_private.actor(expected_actor);
 if request_id is null or p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>64000 then raise exception using errcode='SR422',message='Invalid request';end if;
 perform planning_review_private.authorize(action,p);
 select * into prior from planning_review_private.requests q where q.actor_id=expected_actor and q.request_id=sprint_review_save.request_id;
 if found then
  if prior.status='applied' and (prior.action is distinct from action or prior.payload is distinct from p) then raise exception using errcode='SR412',message='Request conflict';end if;
  return planning_review_private.receipt(request_id,expected_actor);
 end if;
 if action='review' then
  perform planning_review_private.keys(p,array['id','version','season_id','title','review_date','chair_id','agenda']);
  ident:=planning_review_private.uid(p->'id');select * into r from public.planning_sprint_reviews where id=ident;
  if r.id is not null then old:=to_jsonb(r);previous_version:=r.version;if r.season_id is distinct from planning_review_private.uid(p->'season_id') then raise exception using errcode='SR403',message='Stable season required';end if;end if;
 elsif action='assignment' then
  perform planning_review_private.keys(p,array['board_id','version','lead_id','supporter_ids']);
  ident:=planning_review_private.uid(p->'board_id');select * into a from public.planning_project_review_assignments where board_id=ident;
  if a.board_id is not null then old:=planning_review_private.assignment_json(ident);previous_version:=a.version;end if;
 else
  perform planning_review_private.keys(p-'decision_workflow',array['id','version','review_id','board_id','progress','blockers','evidence','tradeoffs','decisions_needed','decision_references','reported_decision','decision_rationale','reported_by_student_ids','next_test','linked_task_id','carry_from_update_id','unresolved']);
  ident:=planning_review_private.uid(p->'id');select * into u from public.planning_sprint_review_updates where id=ident;
  if u.id is not null then old:=to_jsonb(u);previous_version:=u.version;
   if u.review_id is distinct from planning_review_private.uid(p->'review_id') or u.board_id is distinct from planning_review_private.uid(p->'board_id') then raise exception using errcode='SR403',message='Stable update scope required';end if;
  elsif exists(select 1 from public.planning_sprint_review_updates x where x.review_id=planning_review_private.uid(p->'review_id') and x.board_id=planning_review_private.uid(p->'board_id')) then raise exception using errcode='SR409',message='Update already exists';end if;
 end if;
 if ident is null then raise exception using errcode='SR422',message='Identity required';end if;
 if previous_version is null then
  if p->'version' is distinct from 'null'::jsonb then raise exception using errcode='SR409',message='New version required';end if;
 elsif jsonb_typeof(p->'version') is distinct from 'number' or (p->>'version') !~'^[1-9][0-9]{0,9}$' or (p->>'version')::bigint is distinct from previous_version then raise exception using errcode='SR409',message='Stale version';end if;
 if action='review' then
  perform planning_review_private.text_field(p,'title',200,true);perform planning_review_private.text_field(p,'review_date',10,true);
  if (p->>'review_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (p->>'review_date')::date not between date '0001-01-01' and date '9999-12-31' then raise exception using errcode='SR422',message='Finite calendar date required';end if;
  -- A date correction must preserve the order of existing carry-forward links.
  -- Otherwise later writes could create a cycle by first reversing meeting dates.
  if r.id is not null and exists(
   select 1 from public.planning_sprint_review_updates child
   join public.planning_sprint_review_updates source on source.id=child.carry_from_update_id
   join public.planning_sprint_reviews cr on cr.id=child.review_id
   join public.planning_sprint_reviews sr on sr.id=source.review_id
   where (cr.id=r.id or sr.id=r.id) and
   (case when sr.id=r.id then (p->>'review_date')::date else sr.review_date end,sr.created_at,sr.id)>=
   (case when cr.id=r.id then (p->>'review_date')::date else cr.review_date end,cr.created_at,cr.id)
  ) then raise exception using errcode='SR422',message='Keep carry-forward meeting order';end if;
  person_id:=planning_review_private.uid(p->'chair_id');
  if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead','admin_lead','mentor','admin')) and person_id is distinct from r.chair_id then raise exception using errcode='SR422',message='Choose an active chair';end if;
  if jsonb_typeof(p->'agenda') is distinct from 'array' or jsonb_array_length(p->'agenda')>30 then raise exception using errcode='SR422',message='Invalid agenda';end if;
  for item in select value from jsonb_array_elements(p->'agenda') loop
   perform planning_review_private.keys(item,array['title','presenter_id','duration_minutes']);perform planning_review_private.text_field(item,'title',200,true);
   if jsonb_typeof(item->'duration_minutes') is distinct from 'number' or (item->>'duration_minutes') !~'^[1-9][0-9]{0,2}$' or (item->>'duration_minutes')::integer>240 then raise exception using errcode='SR422',message='Invalid agenda duration';end if;
   person_id:=planning_review_private.uid(item->'presenter_id');
   if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead','admin_lead','mentor','admin'))
   and not exists(select 1 from jsonb_array_elements(coalesce(r.agenda,'[]')) x where x->>'presenter_id'=person_id::text) then raise exception using errcode='SR422',message='Choose an active presenter';end if;
  end loop;
  insert into public.planning_sprint_reviews(id,season_id,title,review_date,chair_id,agenda,recorded_by)
  values(ident,planning_review_private.uid(p->'season_id'),planning_review_private.clean(p->>'title'),(p->>'review_date')::date,planning_review_private.uid(p->'chair_id'),p->'agenda',auth.uid())
  on conflict(id) do update set title=excluded.title,review_date=excluded.review_date,chair_id=excluded.chair_id,agenda=excluded.agenda,version=planning_sprint_reviews.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp()
  returning to_jsonb(planning_sprint_reviews.*) into result;
 elsif action='assignment' then
  person_id:=planning_review_private.uid(p->'lead_id');member_ids:=planning_review_private.ids(p->'supporter_ids');
  if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead','admin_lead')) and person_id is distinct from a.lead_id then raise exception using errcode='SR422',message='Choose an active student lead';end if;
  if person_id=any(member_ids) then raise exception using errcode='SR422',message='Lead already participates';end if;
  if exists(select 1 from unnest(member_ids) x where not exists(select 1 from public.profiles y where y.id=x and y.active and y.role::text in ('student','lead','admin_lead','mentor','admin'))
   and not exists(select 1 from public.planning_project_review_supporters z where z.board_id=ident and z.user_id=x)) then raise exception using errcode='SR422',message='Choose active supporters';end if;
  insert into public.planning_project_review_assignments(board_id,lead_id,recorded_by) values(ident,person_id,auth.uid())
  on conflict(board_id) do update set lead_id=excluded.lead_id,version=planning_project_review_assignments.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp();
  delete from public.planning_project_review_supporters where board_id=ident and not(user_id=any(member_ids));
  insert into public.planning_project_review_supporters(board_id,user_id) select ident,x from unnest(member_ids) x on conflict do nothing;
  result:=planning_review_private.assignment_json(ident);
 else
  foreach field in array array['progress','blockers','tradeoffs','decisions_needed','reported_decision','decision_rationale','next_test'] loop perform planning_review_private.text_field(p,field,5000);end loop;
  perform planning_review_private.references_valid(p->'evidence');perform planning_review_private.references_valid(p->'decision_references');
  student_ids:=planning_review_private.ids(p->'reported_by_student_ids');
  if exists(select 1 from unnest(student_ids) x where not exists(select 1 from public.profiles y where y.id=x and y.active and y.role::text in ('student','lead','admin_lead')) and not(x=any(coalesce(u.reported_by_student_ids,'{}')))) then raise exception using errcode='SR422',message='Choose reported student participants';end if;
  -- Omitted field is a legacy client: preserve the existing workflow. JSON null explicitly clears it.
  workflow:=case when p ? 'decision_workflow' then nullif(p->'decision_workflow','null'::jsonb) else u.decision_workflow end;
  perform planning_review_private.decision_workflow_valid(workflow,u.decision_workflow,p);
  task_id:=planning_review_private.uid(p->'linked_task_id');carried_id:=planning_review_private.uid(p->'carry_from_update_id');
  select * into r from public.planning_sprint_reviews where id=planning_review_private.uid(p->'review_id');
  if task_id is not null and task_id is distinct from u.linked_task_id and not exists(select 1 from public.planning_tasks t join public.planning_boards b on b.id=t.board_id
   where t.id=task_id and b.active and (b.season_id=r.season_id or b.kind='area') and planning_review_private.board_visible(b.id)) then raise exception using errcode='SR422',message='Choose visible Planning work';end if;
  if carried_id is not null and not exists(select 1 from public.planning_sprint_review_updates x join public.planning_sprint_reviews y on y.id=x.review_id
   where x.id=carried_id and x.board_id=planning_review_private.uid(p->'board_id') and y.season_id=r.season_id and (y.review_date,y.created_at,y.id)<(r.review_date,r.created_at,r.id)) then raise exception using errcode='SR422',message='Choose an earlier update for this project';end if;
  if jsonb_typeof(p->'unresolved') is distinct from 'boolean' then raise exception using errcode='SR422',message='Invalid unresolved flag';end if;
  insert into public.planning_sprint_review_updates(id,review_id,board_id,progress,blockers,evidence,tradeoffs,decisions_needed,decision_references,reported_decision,decision_rationale,reported_by_student_ids,next_test,linked_task_id,carry_from_update_id,unresolved,decision_workflow,recorded_by)
  values(ident,r.id,planning_review_private.uid(p->'board_id'),p->>'progress',p->>'blockers',p->'evidence',p->>'tradeoffs',p->>'decisions_needed',p->'decision_references',p->>'reported_decision',p->>'decision_rationale',student_ids,p->>'next_test',task_id,carried_id,(p->>'unresolved')::boolean,workflow,auth.uid())
  on conflict(id) do update set progress=excluded.progress,blockers=excluded.blockers,evidence=excluded.evidence,tradeoffs=excluded.tradeoffs,decisions_needed=excluded.decisions_needed,decision_references=excluded.decision_references,reported_decision=excluded.reported_decision,decision_rationale=excluded.decision_rationale,reported_by_student_ids=excluded.reported_by_student_ids,next_test=excluded.next_test,linked_task_id=excluded.linked_task_id,carry_from_update_id=excluded.carry_from_update_id,unresolved=excluded.unresolved,decision_workflow=excluded.decision_workflow,version=planning_sprint_review_updates.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp()
  returning to_jsonb(planning_sprint_review_updates.*) into result;
 end if;
 insert into planning_review_private.history(action,entity_id,actor_id,request_id,before_data,after_data) values(action,ident,auth.uid(),request_id,old,result);
 insert into planning_review_private.requests(actor_id,request_id,action,payload,status,entity_id,version) values(auth.uid(),request_id,action,p,'applied',ident,(result->>'version')::integer);
 return planning_review_private.receipt(request_id,expected_actor);
exception when others then raise exception using errcode=case when sqlstate like 'SR%' then sqlstate else 'SR422' end,message=planning_review_private.error_message(case when sqlstate like 'SR%' then sqlstate else 'SR422' end),detail='',hint='';
end $$;

create or replace function fabrication_private.writer(actor uuid) returns boolean language sql stable set search_path='' as $$select exists(select 1 from public.profiles where id=actor and active and role::text in ('student','lead','admin_lead','mentor','admin'))$$;

create or replace function fabrication_private.manager(actor uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=actor and p.active and
 (p.role::text in ('mentor','admin') or (p.role::text in ('student','lead','admin_lead') and exists(
 select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=p.id and mp.revoked_at is null and tp.key in
 ('program_manager','product_technical_manager','finance_lead','software_lead','business_lead','cad_lead','fabrication_lead','strategy_lead','power_lead','communications_lead','operations_lead')))))
$$;

create or replace function planning_review_private.decision_workflow_valid(v jsonb,previous_workflow jsonb,p jsonb)
returns void language plpgsql set search_path='' as $$
declare item jsonb; field text; owner_id uuid; option_id uuid; chosen_id uuid; option_ids uuid[]:='{}';
 study jsonb; criterion jsonb; assessment jsonb; criterion_id uuid; criterion_ids uuid[]:='{}'; assessment_pairs text[]:='{}'; pair text;
begin
 if v is null then return;end if;
 perform planning_review_private.keys(v-'trade_study',array['schema_version','status','owner_id','target_date','decided_on','requirements','options','chosen_option_id','reopen_criteria']);
 if v->'schema_version' is distinct from '1'::jsonb or jsonb_typeof(v->'status') is distinct from 'string'
 or v->>'status' not in ('comparing','recorded','reopened') then raise exception using errcode='SR422',message='Invalid decision workflow';end if;
 owner_id:=planning_review_private.uid(v->'owner_id');
 if owner_id is not null and not exists(select 1 from public.profiles x where x.id=owner_id and x.active and x.role::text in ('student','lead','admin_lead'))
 and owner_id is distinct from planning_review_private.uid(coalesce(previous_workflow->'owner_id','null'::jsonb))
 then raise exception using errcode='SR422',message='Choose an active student decision owner';end if;
 foreach field in array array['target_date','decided_on'] loop
  if v->field is distinct from 'null'::jsonb then
   perform planning_review_private.text_field(v,field,10,true);
   if (v->>field)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (v->>field)::date not between date '0001-01-01' and date '9999-12-31'
   then raise exception using errcode='SR422',message='Finite decision calendar date required';end if;
  end if;
 end loop;
 perform planning_review_private.references_valid(v->'requirements');
 perform planning_review_private.text_field(v,'reopen_criteria',2000);
 if jsonb_typeof(v->'options') is distinct from 'array' or jsonb_array_length(v->'options') not between 1 and 6
 then raise exception using errcode='SR422',message='Choose one to six decision options';end if;
 for item in select value from jsonb_array_elements(v->'options') loop
  perform planning_review_private.keys(item-'swot',array['id','label','description','weight','space','cost','reliability','time','evidence']);
  option_id:=planning_review_private.uid(item->'id');
  if option_id is null or option_id=any(option_ids) then raise exception using errcode='SR422',message='Unique decision option identity required';end if;
  option_ids:=array_append(option_ids,option_id);
  perform planning_review_private.text_field(item,'label',200,true);
  perform planning_review_private.text_field(item,'description',2000);
  foreach field in array array['weight','space','cost','reliability','time'] loop perform planning_review_private.text_field(item,field,1000);end loop;
  perform planning_review_private.references_valid(item->'evidence');
  if item ? 'swot' and item->'swot'<>'null'::jsonb then
   perform planning_review_private.keys(item->'swot',array['strengths','weaknesses','opportunities','threats']);
   foreach field in array array['strengths','weaknesses','opportunities','threats'] loop perform planning_review_private.text_field(item->'swot',field,2000);end loop;
  end if;
 end loop;
 -- Team-defined raw engineering measurements. No computed score or rank is persisted.
 -- Match the browser's finite IEEE-754 number representation, including ordered scale
 -- endpoints after rounding. Unrepresentable overflow/underflow raises a sanitized SR422.
 if v ? 'trade_study' and v->'trade_study'<>'null'::jsonb then
  study:=v->'trade_study';
  perform planning_review_private.keys(study,array['criteria','assessments']);
  if jsonb_typeof(study->'criteria') is distinct from 'array' or jsonb_array_length(study->'criteria')>8
  or jsonb_typeof(study->'assessments') is distinct from 'array' or jsonb_array_length(study->'assessments')>48
  then raise exception using errcode='SR422',message='Invalid trade study size';end if;
  for criterion in select value from jsonb_array_elements(study->'criteria') loop
   perform planning_review_private.keys(criterion,array['id','label','unit','weight','scale_min','scale_max','direction','must_have','minimum','maximum']);
   criterion_id:=planning_review_private.uid(criterion->'id');
   if criterion_id is null or criterion_id=any(criterion_ids) then raise exception using errcode='SR422',message='Unique criterion identity required';end if;
   criterion_ids:=array_append(criterion_ids,criterion_id);
   perform planning_review_private.text_field(criterion,'label',200,true);
   perform planning_review_private.text_field(criterion,'unit',50,true);
   if jsonb_typeof(criterion->'weight') is distinct from 'number' or (criterion->>'weight')::double precision not between 0 and 1000
   then raise exception using errcode='SR422',message='Invalid criterion weight';end if;
   foreach field in array array['scale_min','scale_max','minimum','maximum'] loop
    if field in ('scale_min','scale_max') or criterion->field<>'null'::jsonb then
     if jsonb_typeof(criterion->field) is distinct from 'number' or (criterion->>field)::double precision not between -1000000000000 and 1000000000000
     then raise exception using errcode='SR422',message='Invalid measurement bound';end if;
    end if;
   end loop;
   if (criterion->>'scale_min')::double precision>=(criterion->>'scale_max')::double precision
   or jsonb_typeof(criterion->'direction') is distinct from 'string' or criterion->>'direction' not in ('higher','lower')
   or jsonb_typeof(criterion->'must_have') is distinct from 'boolean'
   then raise exception using errcode='SR422',message='Invalid normalization definition';end if;
   if (criterion->>'must_have')::boolean then
    if criterion->'minimum'='null'::jsonb and criterion->'maximum'='null'::jsonb
    then raise exception using errcode='SR422',message='A hard constraint requires a minimum or maximum';end if;
   elsif criterion->'minimum'<>'null'::jsonb or criterion->'maximum'<>'null'::jsonb
   then raise exception using errcode='SR422',message='Unmarked hard constraint';end if;
   if criterion->'minimum'<>'null'::jsonb and criterion->'maximum'<>'null'::jsonb and (criterion->>'minimum')::double precision>(criterion->>'maximum')::double precision
   then raise exception using errcode='SR422',message='Invalid hard constraint bounds';end if;
  end loop;
  for assessment in select value from jsonb_array_elements(study->'assessments') loop
   perform planning_review_private.keys(assessment,array['option_id','criterion_id','value','reason','evidence']);
   option_id:=planning_review_private.uid(assessment->'option_id');criterion_id:=planning_review_private.uid(assessment->'criterion_id');
   if option_id is null or criterion_id is null
   or not exists(select 1 from jsonb_array_elements(v->'options') x where x->>'id'=assessment->>'option_id')
   or not exists(select 1 from jsonb_array_elements(study->'criteria') x where x->>'id'=assessment->>'criterion_id')
   then raise exception using errcode='SR422',message='Assessment must reference this comparison';end if;
   pair:=option_id::text||':'||criterion_id::text;
   if pair=any(assessment_pairs) then raise exception using errcode='SR422',message='Duplicate option criterion assessment';end if;
   assessment_pairs:=array_append(assessment_pairs,pair);
   if assessment->'value'<>'null'::jsonb and (jsonb_typeof(assessment->'value') is distinct from 'number' or (assessment->>'value')::double precision not between -1000000000000 and 1000000000000)
   then raise exception using errcode='SR422',message='Invalid raw measurement';end if;
   perform planning_review_private.text_field(assessment,'reason',2000);
   perform planning_review_private.references_valid(assessment->'evidence');
  end loop;
 end if;
 chosen_id:=planning_review_private.uid(v->'chosen_option_id');
 if chosen_id is not null and not exists(select 1 from jsonb_array_elements(v->'options') x where x->>'id'=v->>'chosen_option_id')
 then raise exception using errcode='SR422',message='Chosen option must be in the comparison';end if;
 if v->>'status'='recorded' then
  if owner_id is null or v->'decided_on'='null'::jsonb or chosen_id is null or jsonb_array_length(p->'reported_by_student_ids')=0
  then raise exception using errcode='SR422',message='Complete the reported student decision';end if;
  perform planning_review_private.text_field(p,'reported_decision',5000,true);
  perform planning_review_private.text_field(p,'decision_rationale',5000,true);
  perform planning_review_private.text_field(v,'reopen_criteria',2000,true);
 end if;
end $$;
commit;
