// Only synthetic local identities and schema prerequisites. No connected database.
import {readFileSync} from 'node:fs';
export const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const migration='supabase/migrations/20261006061729_season_goals_v1.sql';
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
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
${['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql'].map(name=>readFileSync('supabase/migrations/'+name,'utf8')).join('\n')}
insert into public.planning_seasons(id,name,status,created_by) values('${id(100)}','Active synthetic season','active','${id(1)}'),('${id(101)}','Draft synthetic season','draft','${id(1)}'),('${id(102)}','Archived synthetic season','archived','${id(1)}');
insert into public.planning_boards(id,season_id,name,kind,created_by) values('${id(110)}','${id(100)}','Robot','project','${id(1)}'),('${id(111)}',null,'Functional software','area','${id(1)}'),('${id(112)}','${id(101)}','Other season','project','${id(1)}');
insert into public.planning_tasks(id,board_id,title,status,priority,created_by) values('${id(120)}','${id(110)}','Autonomous test','todo','normal','${id(1)}'),('${id(121)}','${id(111)}','Reusable alignment','todo','normal','${id(1)}'),('${id(122)}','${id(112)}','Other season task','todo','normal','${id(1)}');
insert into public.planning_task_assignees(task_id,user_id) values('${id(120)}','${id(4)}'),('${id(121)}','${id(6)}');
insert into public.planning_items(id,season_id,title,kind,start_date,end_date,status) values('${id(130)}','${id(100)}','Reliable autonomous','milestone','2027-03-01','2027-03-01','not_started'),('${id(131)}','${id(101)}','Other season milestone','milestone','2027-03-01','2027-03-01','not_started'),('${id(132)}','${id(100)}','Work item','work','2027-02-01','2027-02-02','not_started');
`;}
