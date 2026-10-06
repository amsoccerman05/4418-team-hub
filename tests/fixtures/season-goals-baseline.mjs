// Only synthetic local identities and schema prerequisites. No connected database.
import {readFileSync} from 'node:fs';
export const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const migration='supabase/migrations/20261006061729_season_goals_v1.sql';
// Record all pre-existing Planning definitions and permissions. Goals must not make
// an old private object reachable merely because it inherited permissive defaults.
export const planningBoundarySnapshot=`select jsonb_build_object(
 'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',nspowner,'acl',nspacl) order by nspname) from pg_namespace where nspname in ('public','planning_private')),
 'relations',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='planning_private' or (n.nspname='public' and c.relname like 'planning_%' and c.relname not like 'planning_goal%')),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'owner',p.proowner,'acl',p.proacl,'definition',pg_get_functiondef(p.oid)) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='planning_private' or (n.nspname='public' and p.proname like 'planning_%' and p.proname not like 'planning_goal%')),
 'default_privileges',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d)
) as snapshot`;
// All grants to non-owners, including PUBLIC and unexpected inherited defaults.
// A client receives schema USAGE plus EXECUTE on guarded entry points only.
export const goalBoundaryGrants=`
select 'schema '||n.nspname as object,coalesce(r.rolname,'PUBLIC') as role,x.privilege_type as privilege,x.is_grantable as grantable
from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x left join pg_roles r on r.oid=x.grantee
where n.nspname='planning_goals_private' and x.grantee<>n.nspowner
union all
select n.nspname||'.'||p.proname,coalesce(r.rolname,'PUBLIC'),x.privilege_type,x.is_grantable
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee
where (n.nspname='planning_goals_private' or (n.nspname='public' and p.proname like 'planning_goal%')) and x.grantee<>p.proowner
union all
select n.nspname||'.'||c.relname,coalesce(r.rolname,'PUBLIC'),x.privilege_type,x.is_grantable
from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::\"char\" else 'r'::\"char\" end,c.relowner))) x left join pg_roles r on r.oid=x.grantee
where c.relkind in ('r','S') and (n.nspname='planning_goals_private' or (n.nspname='public' and c.relname like 'planning_goal%')) and x.grantee<>c.relowner
order by object,role,privilege`;
export const expectedGoalBoundaryGrants=[
 'planning_goals_private.goal_operation','planning_goals_private.goal_save','planning_goals_private.goal_update','planning_goals_private.goals_context',
 'public.planning_goal_operation_cancel','public.planning_goal_operation_status','public.planning_goal_save','public.planning_goal_update','public.planning_goals_context',
 'schema planning_goals_private',
].map(object=>({object,role:'authenticated',privilege:object.startsWith('schema ')?'USAGE':'EXECUTE',grantable:false}));
export const goal=(overrides={})=>({operation_id:id(900),id:id(300),expected_version:0,season_id:id(100),title:'Improve autonomous reliability',description:'Synthetic local goal',category:'engineering',owner_id:id(3),baseline:2,target:8,unit:'successful runs out of 10',direction:'increase',deadline:'2027-04-01',fundraising_measure:null,supporter_ids:[id(6)],task_ids:[id(120)],milestone_ids:[id(130)],next_milestone_id:id(130),...overrides});
export const update=(overrides={})=>({operation_id:id(901),id:id(400),goal_id:id(300),expected_version:1,kind:'measurement',measured_value:4,status:'on_track',evidence:'Four successful autonomous runs in ten trials.',evidence_url:'https://example.org/synthetic-evidence',next_step:'Repeat the drill after the alignment fix.',observed_on:'2026-10-01',...overrides});
export function baseline(){return `
create role anon;create role authenticated;create role service_role;
create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
create table public.areas(id uuid primary key,name text,active boolean);
create table public.team_positions(key text primary key,active boolean);
create table public.team_member_positions(user_id uuid references public.profiles(id),position_key text references public.team_positions(key),revoked_at timestamptz);
insert into public.profiles values
('${id(1)}','Mentor','mentor',true),('${id(2)}','Position leader','student',true),('${id(3)}','Student owner','student',true),('${id(4)}','Base lead','lead',true),('${id(5)}','Inactive mentor','mentor',false),('${id(6)}','Student supporter','student',true),('${id(7)}','Read only member','readonly',true),('${id(8)}','Admin','admin',true);
insert into public.areas values('${id(10)}','Software',true);
insert into public.team_positions values('software_lead',true);
insert into public.team_member_positions values('${id(2)}','software_lead',null);
-- Global defaults deliberately cover old/new private schemas and identity
-- sequences as well as public objects, matching a permissive Supabase baseline.
alter default privileges grant all on tables to anon,authenticated,service_role;
alter default privileges grant all on sequences to anon,authenticated,service_role;
alter default privileges grant execute on functions to anon,authenticated,service_role;
${['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql'].map(name=>readFileSync('supabase/migrations/'+name,'utf8')).join('\n')}
insert into public.planning_seasons(id,name,status,created_by) values('${id(100)}','Active synthetic season','active','${id(1)}'),('${id(101)}','Draft synthetic season','draft','${id(1)}'),('${id(102)}','Archived synthetic season','archived','${id(1)}');
insert into public.planning_boards(id,season_id,name,kind,created_by) values('${id(110)}','${id(100)}','Robot','project','${id(1)}'),('${id(111)}',null,'Functional software','area','${id(1)}'),('${id(112)}','${id(101)}','Other season','project','${id(1)}');
insert into public.planning_tasks(id,board_id,title,status,priority,created_by) values('${id(120)}','${id(110)}','Autonomous test','todo','normal','${id(1)}'),('${id(121)}','${id(111)}','Reusable alignment','todo','normal','${id(1)}'),('${id(122)}','${id(112)}','Other season task','todo','normal','${id(1)}');
insert into public.planning_task_assignees(task_id,user_id) values('${id(120)}','${id(4)}'),('${id(121)}','${id(6)}');
insert into public.planning_items(id,season_id,title,kind,start_date,end_date,status) values('${id(130)}','${id(100)}','Reliable autonomous','milestone','2027-03-01','2027-03-01','not_started'),('${id(131)}','${id(101)}','Other season milestone','milestone','2027-03-01','2027-03-01','not_started'),('${id(132)}','${id(100)}','Work item','work','2027-02-01','2027-02-02','not_started');
`;}
