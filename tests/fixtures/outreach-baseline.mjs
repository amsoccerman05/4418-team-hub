// Synthetic isolated databases only. Finance fixture is an unchanged copy of
// finance/main d8fd913's 202609200001_finance_budget_core.sql.
import {readFileSync} from 'node:fs';
export const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const migration='supabase/migrations/20261006045839_sponsor_outreach_v1.sql';
export function baseline(){return `
create role anon;create role authenticated;create role service_role;
create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
create table public.profiles(id uuid primary key,display_name text,role text,active boolean,primary_area_id uuid);
create table public.areas(id uuid primary key,name text,active boolean);
create table public.team_attendance_members(student_id uuid primary key,member_status text);
create table public.team_positions(key text primary key,active boolean);
create table public.team_member_positions(user_id uuid references profiles(id),position_key text references team_positions(key),revoked_at timestamptz);
insert into profiles values('${id(1)}','Synthetic Admin','admin',true,null),('${id(2)}','Synthetic Mentor','mentor',true,null),('${id(3)}','Synthetic Student','student',true,null),('${id(4)}','Synthetic Lead','lead',true,null),('${id(5)}','Synthetic Inactive','mentor',false,null),('${id(6)}','Synthetic Reader','readonly',true,null);
insert into team_positions values('business_lead',true);insert into team_member_positions values('${id(3)}','business_lead',null),('${id(4)}','business_lead',null);
${readFileSync('tests/fixtures/finance_v1.sql','utf8')}
${readFileSync('tests/fixtures/outreach_finance_budget_core.sql','utf8')}
insert into finance_seasons(id,name,status,created_by) values('${id(100)}','Synthetic 2026–27','active','${id(1)}'),('${id(101)}','Synthetic future','draft','${id(1)}'),('${id(102)}','Synthetic closed','closed','${id(1)}');
insert into finance_income(id,season_id,source,income_type,amount,status,created_by) values('${id(200)}','${id(100)}','Synthetic Business','sponsorship',500,'expected','${id(1)}'),('${id(201)}','${id(101)}','Synthetic Future','sponsorship',600,'expected','${id(1)}'),('${id(202)}','${id(100)}','Synthetic Other','sponsorship',700,'expected','${id(1)}');
alter default privileges grant all on tables to anon,authenticated,service_role;
alter default privileges grant all on sequences to anon,authenticated,service_role;
alter default privileges grant execute on functions to anon,authenticated,service_role;
`;}
