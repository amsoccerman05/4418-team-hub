-- Synthetic identities only. Shared by PGlite and native PostgreSQL checks.

create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
create table public.areas(id uuid primary key,name text,active boolean);
create table public.team_positions(key text primary key,active boolean);
create table public.team_member_positions(user_id uuid references profiles(id),position_key text references team_positions(key),revoked_at timestamptz);
insert into profiles values
('00000000-0000-0000-0000-000000000001','Mentor','mentor',true),('00000000-0000-0000-0000-000000000002','Student leadership','student',true),
('00000000-0000-0000-0000-000000000003','Project lead','student',true),('00000000-0000-0000-0000-000000000004','Student supporter','lead',true),
('00000000-0000-0000-0000-000000000005','Other student','student',true),('00000000-0000-0000-0000-000000000006','Read only','readonly',true),
('00000000-0000-0000-0000-000000000007','Inactive mentor','mentor',false),('00000000-0000-0000-0000-000000000008','Administrator','admin',true),
('00000000-0000-0000-0000-000000000009',null,'student',true),('00000000-0000-0000-0000-000000000010','Inactive student','student',false);
insert into areas values('00000000-0000-0000-0000-000000000090','Cross-functional support',true);
insert into team_positions values('program_manager',true),('cad_lead',true),('unclassified_new_position',true);
insert into team_member_positions values('00000000-0000-0000-0000-000000000002','program_manager',null),('00000000-0000-0000-0000-000000000005','unclassified_new_position',null);
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
