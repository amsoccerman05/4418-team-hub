-- Read-only production catalog inspection. No migration or writes.
select jsonb_build_object(
 'database_version',current_setting('server_version'),
 'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name,'nullable',is_nullable) order by table_name,ordinal_position) from information_schema.columns where table_schema='public' and table_name in ('profiles','areas','team_positions','team_member_positions')),
 'keys',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'type',c.contype,'definition',pg_get_constraintdef(c.oid))) from pg_constraint c where c.conrelid in ('public.profiles'::regclass,'public.areas'::regclass,'public.team_positions'::regclass,'public.team_member_positions'::regclass)),
 'auth_uid',(select jsonb_build_object('args',pg_get_function_identity_arguments(oid),'result',pg_get_function_result(oid)) from pg_proc where oid=to_regprocedure('auth.uid()')),
 'positions',(select jsonb_agg(jsonb_build_object('key',key,'active',active) order by key) from public.team_positions),
 'planning_conflicts',(select coalesce(jsonb_agg(n.nspname||'.'||c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='planning_private' or (n.nspname='public' and c.relname like 'planning_%')),
 'planning_function_conflicts',(select coalesce(jsonb_agg(n.nspname||'.'||p.proname),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='planning_private' or (n.nspname='public' and p.proname like 'planning_%')),
 'planning_schema_exists',exists(select 1 from pg_namespace where nspname='planning_private'),
 'default_privileges',(select coalesce(jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',n.nspname,'type',defaclobjtype,'acl',defaclacl::text)),'[]') from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname in ('public','planning_private') or d.defaclnamespace=0),
 'client_roles',(select jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassrls',rolbypassrls)) from pg_roles where rolname in ('anon','authenticated','service_role')),
 'profile_read_policies',(select coalesce(jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'qual',qual)),'[]') from pg_policies where schemaname='public' and tablename in ('profiles','areas'))
) as preflight;
