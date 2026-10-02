-- MANUAL REVIEW ONLY. Apply after Planning V1, in one transaction.
-- Existing Tasks begin with no dependencies; no record backfill or status changes.
begin;
alter table public.planning_tasks add constraint planning_task_board_identity unique(id,board_id);
create table public.planning_task_dependencies (
 id uuid primary key default gen_random_uuid(),
 board_id uuid not null references public.planning_boards(id),
 predecessor_task_id uuid not null, successor_task_id uuid not null,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(predecessor_task_id,successor_task_id),
 check(predecessor_task_id<>successor_task_id),
 foreign key(predecessor_task_id,board_id) references public.planning_tasks(id,board_id),
 foreign key(successor_task_id,board_id) references public.planning_tasks(id,board_id)
);
create index planning_dependencies_board on public.planning_task_dependencies(board_id);
create index planning_dependencies_successor on public.planning_task_dependencies(successor_task_id);
alter table public.planning_task_dependencies enable row level security;
revoke all on public.planning_task_dependencies from public,anon,authenticated;
-- RPC-only reads use exactly the existing Board visibility predicate.
create or replace function public.planning_context(selected_season uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 'dependencies',(select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at,d.id),'[]') from public.planning_task_dependencies d join public.planning_boards b on b.id=d.board_id where (b.season_id=sid or (b.kind='area' and sid is not null)) and (manager or b.active)),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at),'[]') from public.planning_tasks t join public.planning_boards b on b.id=t.board_id where (b.season_id=sid or (b.kind='area' and sid is not null)) and (manager or b.active)));
end $$;

create function public.planning_dependency_save(action text,predecessor uuid default null,successor uuid default null,dependency_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.planning_tasks; z public.planning_tasks; b public.planning_boards;
 d public.planning_task_dependencies; snapshot jsonb;
begin
 -- Same serialization boundary as every existing Planning mutation.
 perform pg_advisory_xact_lock(4418,30);
 if not planning_private.member() or not planning_private.manager() then raise exception 'Planning leadership required' using errcode='42501';end if;
 if action='remove' then
  select * into d from public.planning_task_dependencies where id=dependency_id for update;
  if not found then raise exception 'Dependency changed. Refresh before removing.';end if;
  predecessor:=d.predecessor_task_id;successor:=d.successor_task_id;
 elsif action<>'add' or action is null then raise exception 'Unknown dependency action';end if;
 select * into a from public.planning_tasks where id=predecessor;
 if not found then raise exception 'Predecessor task unavailable';end if;
 select * into z from public.planning_tasks where id=successor;
 if not found then raise exception 'Successor task unavailable';end if;
 if a.id=z.id then raise exception 'A task cannot depend on itself';end if;
 if a.board_id<>z.board_id then raise exception 'Dependencies must stay within one Board';end if;
 select * into b from public.planning_boards where id=z.board_id;
 if not b.active or (b.kind='project' and not exists(select 1 from public.planning_seasons where id=b.season_id and status<>'archived')) then raise exception 'Board is archived or unavailable';end if;
 if action='add' then
  if exists(select 1 from public.planning_task_dependencies where predecessor_task_id=a.id and successor_task_id=z.id) then raise exception 'Dependency already exists';end if;
  if exists(with recursive reachable(id) as (
    select successor_task_id from public.planning_task_dependencies where predecessor_task_id=z.id
    union select e.successor_task_id from public.planning_task_dependencies e join reachable r on e.predecessor_task_id=r.id
   ) select 1 from reachable where id=a.id) then raise exception 'Dependency would create a cycle';end if;
  insert into public.planning_task_dependencies(board_id,predecessor_task_id,successor_task_id,created_by)
  values(z.board_id,a.id,z.id,auth.uid()) returning * into d;
 else
  delete from public.planning_task_dependencies where id=d.id;
 end if;
 snapshot:=to_jsonb(d)||jsonb_build_object('predecessor_title',a.title,'successor_title',z.title);
 insert into planning_private.history(entity,entity_id,task_id,actor_id,action,before_data,after_data)
 values('dependency',d.id,z.id,auth.uid(),case when action='add' then 'added' else 'removed' end,
 case when action='remove' then snapshot end,case when action='add' then snapshot end);
 return d.id;
end $$;
revoke all on function public.planning_dependency_save(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.planning_dependency_save(text,uuid,uuid,uuid) to authenticated;
-- planning_context keeps its existing execute grants; existing mutation is untouched.
commit;
