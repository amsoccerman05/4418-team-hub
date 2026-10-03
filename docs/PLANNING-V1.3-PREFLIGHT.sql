-- SEPARATE READ-ONLY COMPATIBILITY REVIEW. Not executed during implementation.
begin read only;
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where (table_schema='public' and table_name in
 ('planning_tasks','planning_boards','planning_task_dependencies','profiles','team_positions','team_member_positions'))
 or (table_schema='planning_private' and table_name='history') order by table_schema,table_name,ordinal_position;
select c.conrelid::regclass as relation,c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid in ('public.planning_tasks'::regclass,'public.planning_boards'::regclass,'public.planning_task_dependencies'::regclass,'planning_private.history'::regclass) order by 1,2;
select schemaname,tablename,indexname,indexdef from pg_indexes where tablename in ('planning_tasks','planning_task_dependencies') order by 1,2,3;
select p.oid::regprocedure as signature,pg_get_function_result(p.oid) as result,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('planning_save','planning_context','planning_task_detail','planning_dependency_save'))
 or (n.nspname='planning_private' and p.proname in ('manager','member')) order by 1;
select c.oid::regclass as relation,c.relrowsecurity,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and ((n.nspname='public' and c.relname like 'planning_%') or n.nspname='planning_private') order by 1;
select * from pg_policies where schemaname='planning_private' or tablename like 'planning_%';
select tgrelid::regclass as relation,tgname,pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal and
 (tgrelid='planning_private.history'::regclass or tgrelid='public.planning_tasks'::regclass);
select to_regclass('public.planning_task_assignees') as conflicting_assignee_table,
 to_regprocedure('planning_private.task_owners(uuid)') as conflicting_owners_helper,
 to_regprocedure('planning_private.context(uuid,boolean)') as conflicting_context_helper,
 to_regprocedure('public.planning_my_work_context(uuid)') as conflicting_my_work;
select count(*) total_tasks,count(*) filter(where t.owner_id is null) unassigned_tasks,
 count(*) filter(where t.owner_id is not null) expected_assignee_rows,count(distinct t.owner_id) distinct_assigned_members,
 count(*) filter(where t.owner_id is not null and p.id is null) invalid_owner_references,
 count(*) filter(where t.owner_id is not null and not p.active) inactive_existing_owners
from public.planning_tasks t left join public.profiles p on p.id=t.owner_id;
select count(*) tasks,count(distinct id) distinct_task_ids from public.planning_tasks;
select kind,count(*) boards,count(*) filter(where kind='project' and season_id is null or kind='area' and season_id is not null) invalid_season_bindings
from public.planning_boards group by kind;
select 'dependencies' as relation,count(*) from public.planning_task_dependencies union all
select 'comments',count(*) from public.planning_comments union all select 'steps',count(*) from public.planning_steps union all
select 'history',count(*) from planning_private.history;

-- Textual references supplement catalog dependencies: PL/pgSQL bodies and whole-row
-- JSON projections may not register a column-level pg_depend edge.
select p.oid::regprocedure as signature,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prokind in ('f','p') and n.nspname not in ('pg_catalog','information_schema')
and (p.prosrc ilike '%owner_id%' or p.prosrc ilike '%planning_tasks%');
select pg_describe_object(d.classid,d.objid,d.objsubid) as dependent,d.deptype
from pg_depend d where d.refobjid='public.planning_tasks'::regclass
and d.refobjsubid=(select attnum from pg_attribute where attrelid='public.planning_tasks'::regclass and attname='owner_id');
select schemaname,viewname,definition from pg_views where definition ilike '%planning_%'
union all select schemaname,matviewname,definition from pg_matviews where definition ilike '%planning_%';
select * from pg_policies where coalesce(qual,'') ilike '%planning_%' or coalesce(with_check,'') ilike '%planning_%';
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;
rollback;
