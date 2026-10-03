-- LOCAL REVIEW ONLY. Planning V1.3, after V1.2. Do not deploy during implementation.
-- Backfill once, then remove the legacy singleton column: one authoritative model.
-- No CASCADE, no Task/history/dependency deletion; existing audit JSON is untouched.
begin;
-- Freeze legacy assignment writes throughout backfill and the authority transition.
select pg_advisory_xact_lock(4418,30);
lock table public.planning_tasks in access exclusive mode;
create table public.planning_task_assignees (
 task_id uuid not null references public.planning_tasks(id),
 user_id uuid not null references public.profiles(id),
 assigned_at timestamptz not null default clock_timestamp(),
 assigned_by uuid references public.profiles(id),
 primary key(task_id,user_id)
);
create index planning_assignees_user_task on public.planning_task_assignees(user_id,task_id);
alter table public.planning_task_assignees enable row level security;
revoke all on public.planning_task_assignees from public,anon,authenticated;
-- Null assigned_by explicitly distinguishes migration provenance from user activity.
insert into public.planning_task_assignees(task_id,user_id) select id,owner_id from public.planning_tasks where owner_id is not null;
do $$begin
 if (select count(*) from public.planning_task_assignees)<>(select count(*) from public.planning_tasks where owner_id is not null)
 or exists(select 1 from public.planning_tasks t where t.owner_id is not null and not exists(select 1 from public.planning_task_assignees a where a.task_id=t.id and a.user_id=t.owner_id)) then raise exception 'Task owner backfill mismatch';end if;
end $$;
alter table public.planning_tasks drop column owner_id;
create function planning_private.task_owners(task uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'active',p.active) order by p.id),'[]')
 from public.planning_task_assignees a join public.profiles p on p.id=a.user_id where a.task_id=task
$$;
create or replace function public.planning_save(entity text,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare ident uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); sid uuid; bid uuid; tid uuid;
 old jsonb; result jsonb; owners uuid[]; prior_owners uuid[]:=array[]::uuid[]; manager boolean; owner uuid; ar uuid; pred uuid; b public.planning_boards; t public.planning_tasks;
begin
 perform pg_advisory_xact_lock(4418,30);
 if not planning_private.member() then raise exception 'Active team account required' using errcode='42501';end if;
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
 ) select jsonb_build_object('user_id',auth.uid(),'can_manage',manager,'season_id',sid,
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

-- Preserve the original context signature; My Work applies assignment filtering on the server.
create or replace function public.planning_context(selected_season uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select planning_private.context(selected_season,false)
$$;
create function public.planning_my_work_context(selected_season uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select planning_private.context(selected_season,true)
$$;
revoke all on function planning_private.task_owners(uuid),planning_private.context(uuid,boolean) from public,anon,authenticated;
revoke all on function public.planning_my_work_context(uuid) from public,anon,authenticated;
grant execute on function public.planning_my_work_context(uuid) to authenticated;
-- Existing planning_save/context grants, manager/member helpers and V1.2 dependencies unchanged.
commit;
