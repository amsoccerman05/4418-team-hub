-- MANUAL REVIEW ONLY. Additive Planning V1; no production application in this pass.
begin;
create schema planning_private;
revoke all on schema planning_private from public,anon,authenticated;
create table public.planning_seasons (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 150),
 start_date date, end_date date, status text not null default 'draft' check(status in ('draft','active','archived')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), version integer not null default 1,
 check(end_date is null or start_date is null or end_date>=start_date)
);
create unique index planning_one_active on public.planning_seasons(status) where status='active';
create table public.planning_groups (
 id uuid primary key default gen_random_uuid(), season_id uuid not null references public.planning_seasons(id),
 name text not null check(length(trim(name)) between 1 and 150), display_order integer not null default 0,
 active boolean not null default true, version integer not null default 1, unique(id,season_id)
);
-- Functional-area boards persist across seasons. Project boards belong to one season.
create table public.planning_boards (
 id uuid primary key default gen_random_uuid(), season_id uuid references public.planning_seasons(id),
 name text not null check(length(trim(name)) between 1 and 150), description text not null default '' check(length(description)<=5000),
 kind text not null check(kind in ('project','area')), area_id uuid references public.areas(id),
 active boolean not null default true, display_order integer not null default 0,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), version integer not null default 1,
 check((kind='project' and season_id is not null) or (kind='area' and season_id is null))
);
create table public.planning_items (
 id uuid primary key default gen_random_uuid(), season_id uuid not null references public.planning_seasons(id),
 title text not null check(length(trim(title)) between 1 and 200), description text not null default '' check(length(description)<=5000),
 kind text not null check(kind in ('work','milestone')), start_date date not null, end_date date not null,
 status text not null default 'not_started' check(status in ('not_started','in_progress','blocked','done')),
 group_id uuid, board_id uuid references public.planning_boards(id), owner_id uuid references public.profiles(id), area_id uuid references public.areas(id),
 predecessor_id uuid, display_order integer not null default 0, version integer not null default 1,
 unique(id,season_id), foreign key(group_id,season_id) references public.planning_groups(id,season_id),
 foreign key(predecessor_id,season_id) references public.planning_items(id,season_id),
 check(end_date>=start_date), check(kind<>'milestone' or end_date=start_date), check(predecessor_id is distinct from id)
);
create table public.planning_tasks (
 id uuid primary key default gen_random_uuid(), board_id uuid not null references public.planning_boards(id),
 title text not null check(length(trim(title)) between 1 and 200), description text not null default '' check(length(description)<=5000),
 status text not null default 'backlog' check(status in ('backlog','todo','in_progress','blocked','done')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 owner_id uuid references public.profiles(id), area_id uuid references public.areas(id), start_date date, due_date date,
 blocked_reason text not null default '' check(length(blocked_reason)<=500),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 version integer not null default 1, check(due_date is null or start_date is null or due_date>=start_date)
);
create index planning_tasks_board on public.planning_tasks(board_id);
create index planning_tasks_owner on public.planning_tasks(owner_id);
create table public.planning_steps (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references public.planning_tasks(id),
 text text not null check(length(trim(text)) between 1 and 500), done boolean not null default false,
 display_order integer not null default 0, version integer not null default 1
);
create table public.planning_comments (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references public.planning_tasks(id),
 text text not null check(length(trim(text)) between 1 and 5000), author_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table planning_private.history (
 id bigint generated always as identity primary key, entity text not null, entity_id uuid not null,
 task_id uuid references public.planning_tasks(id), actor_id uuid not null references public.profiles(id),
 action text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default clock_timestamp()
);
-- Same trusted, active-position pattern as Hub/Finance; no base-role Lead elevation.
create function planning_private.manager() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and
 (p.role::text in ('mentor','admin') or (p.role::text in ('student','lead') and exists(
 select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=p.id and mp.revoked_at is null and tp.key in
 ('program_manager','product_technical_manager','finance_lead','software_lead','business_lead','cad_lead','fabrication_lead','strategy_lead','power_lead','communications_lead','operations_lead')))))
$$;
create function planning_private.member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active)
$$;
create function public.planning_context(selected_season uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid; manager boolean;
begin
 if not planning_private.member() then raise exception 'Active team account required' using errcode='42501';end if;
 manager:=planning_private.manager();
 select id into sid from public.planning_seasons where (selected_season is null or id=selected_season)
 and (manager or status='active') order by (status='active') desc,created_at desc limit 1;
 if selected_season is not null and sid is null then raise exception 'Season unavailable' using errcode='42501';end if;
 return jsonb_build_object('user_id',auth.uid(),'can_manage',manager,'season_id',sid,
 'seasons',(select coalesce(jsonb_agg(to_jsonb(s) order by created_at desc),'[]') from public.planning_seasons s where manager or status='active'),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name),'[]') from public.profiles where active),
 'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.areas where active),
 'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by display_order,name),'[]') from public.planning_groups g where season_id=sid),
 'items',(select coalesce(jsonb_agg(to_jsonb(i) order by display_order,start_date,title),'[]') from public.planning_items i where season_id=sid),
 'boards',(select coalesce(jsonb_agg(to_jsonb(b) order by display_order,name),'[]') from public.planning_boards b where (season_id=sid or (kind='area' and sid is not null)) and (manager or active)),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at),'[]') from public.planning_tasks t join public.planning_boards b on b.id=t.board_id where (b.season_id=sid or (b.kind='area' and sid is not null)) and (manager or b.active)));
end $$;
create function public.planning_task_detail(task uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not planning_private.member() or not exists(select 1 from public.planning_tasks t join public.planning_boards b on b.id=t.board_id
 left join public.planning_seasons s on s.id=b.season_id where t.id=task and (planning_private.manager() or (b.active and (s.status='active' or b.kind='area'))))
 then raise exception 'Task unavailable' using errcode='42501';end if;
 return jsonb_build_object('steps',(select coalesce(jsonb_agg(to_jsonb(s) order by display_order,id),'[]') from public.planning_steps s where task_id=task),
 'comments',(select coalesce(jsonb_agg(to_jsonb(c) order by created_at),'[]') from public.planning_comments c where task_id=task),
 'history',(select coalesce(jsonb_agg(to_jsonb(h) order by created_at desc),'[]') from (select * from planning_private.history where task_id=task order by created_at desc limit 100) h));
end $$;
create function public.planning_save(entity text,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare ident uuid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); sid uuid; bid uuid; tid uuid;
 old jsonb; result jsonb; manager boolean; owner uuid; ar uuid; pred uuid; b public.planning_boards; t public.planning_tasks;
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
 else
  if entity='step' then select to_jsonb(s) into old from public.planning_steps s where id=ident;end if;
  tid:=coalesce((old->>'task_id')::uuid,(p->>'task_id')::uuid);
  select * into t from public.planning_tasks where id=tid;bid:=t.board_id;
 end if;
 if old is not null and entity<>'comment' and (old->>'version')::integer is distinct from (p->>'version')::integer then raise exception 'Changed by another teammate. Refresh before saving.';end if;
 if entity in ('task','step','comment') then
  select * into b from public.planning_boards where id=bid;
  if not found or not b.active then raise exception 'Active board required';end if;sid:=b.season_id;
  if not manager and entity<>'comment' and (t.id is null or t.owner_id is distinct from auth.uid()) then raise exception 'Only assigned tasks may be updated' using errcode='42501';end if;
  if not manager and entity='task' and (nullif(p->>'owner_id','')::uuid is distinct from t.owner_id or nullif(p->>'board_id','')::uuid is distinct from t.board_id or nullif(p->>'area_id','')::uuid is distinct from t.area_id) then raise exception 'Only leadership can reassign tasks' using errcode='42501';end if;
 end if;
 if entity<>'season' and sid is not null and not exists(select 1 from public.planning_seasons where id=sid and status<>'archived' and (manager or status='active')) then raise exception 'Season is unavailable or archived';end if;
 if entity='season' and old->>'status'='archived' then raise exception 'Archived seasons are read only';end if;
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
  insert into public.planning_tasks(id,board_id,title,description,status,priority,owner_id,area_id,start_date,due_date,blocked_reason,created_by)
  values(ident,bid,trim(p->>'title'),coalesce(p->>'description',''),p->>'status',p->>'priority',owner,ar,nullif(p->>'start_date','')::date,nullif(p->>'due_date','')::date,coalesce(p->>'blocked_reason',''),auth.uid())
  on conflict(id) do update set title=excluded.title,description=excluded.description,status=excluded.status,priority=excluded.priority,owner_id=excluded.owner_id,area_id=excluded.area_id,start_date=excluded.start_date,due_date=excluded.due_date,blocked_reason=excluded.blocked_reason,updated_at=clock_timestamp(),version=planning_tasks.version+1 returning to_jsonb(planning_tasks.*) into result;
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
alter table public.planning_seasons enable row level security;
revoke all on public.planning_seasons from public,anon,authenticated;
alter table public.planning_groups enable row level security;
revoke all on public.planning_groups from public,anon,authenticated;
alter table public.planning_boards enable row level security;
revoke all on public.planning_boards from public,anon,authenticated;
alter table public.planning_items enable row level security;
revoke all on public.planning_items from public,anon,authenticated;
alter table public.planning_tasks enable row level security;
revoke all on public.planning_tasks from public,anon,authenticated;
alter table public.planning_steps enable row level security;
revoke all on public.planning_steps from public,anon,authenticated;
alter table public.planning_comments enable row level security;
revoke all on public.planning_comments from public,anon,authenticated;
alter table planning_private.history enable row level security;
revoke all on planning_private.history from public,anon,authenticated;
revoke all on all functions in schema planning_private from public,anon,authenticated;
revoke all on function public.planning_context(uuid),public.planning_task_detail(uuid),public.planning_save(text,jsonb) from public,anon,authenticated;
grant execute on function public.planning_context(uuid),public.planning_task_detail(uuid),public.planning_save(text,jsonb) to authenticated;
commit;
