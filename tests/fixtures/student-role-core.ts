import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
/** Real released foundations plus the catalog-verified live invitation reconciliation. */
export async function coreBaseline(){const db=new PGlite();await installCoreBaseline(db);return db;}
export async function installCoreBaseline(db:Pick<PGlite,'exec'>){
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table profiles(id uuid primary key,display_name text,role text constraint profiles_role_check check(role in ('readonly','student','lead','admin','mentor')),active boolean,primary_area_id uuid,updated_at timestamptz default now(),email text,created_at timestamptz default now());
 create table areas(id uuid primary key default gen_random_uuid(),name text,active boolean default true,slug text unique default gen_random_uuid()::text);insert into areas(id,name,active) values('${id(101)}','Fabrication',true);
 grant select on areas to authenticated;
 create table team_attendance_members(student_id uuid primary key,member_status text,team_area text default '');
 insert into profiles(id,display_name,role,active) values('${id(1)}','Mentor','mentor',true),('${id(2)}','Student','student',true),('${id(3)}','Lead','lead',true),('${id(4)}','Inactive','mentor',false),('${id(5)}','Read Only','readonly',true);
 insert into team_attendance_members values('${id(2)}','prospective','');
 -- Existing Inventory consumers read the same profiles/area contract.
 create schema private;
 create function private.current_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and active$$;
 create function private.current_area() returns uuid language sql stable security definer set search_path='' as $$select primary_area_id from public.profiles where id=auth.uid() and active$$;
 grant usage on schema private to authenticated;
 alter table profiles enable row level security;
 grant select,update on profiles to authenticated;
 create policy profiles_read on profiles for select to authenticated using(id=auth.uid() or private.current_role() is not null);
 create policy profiles_write on profiles for update to authenticated using(private.current_role() in ('mentor','admin'));
 `);
 await db.exec(readFileSync('tests/fixtures/finance_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609120003_team_management_positions.sql','utf8'));
 await db.exec(`create table auth.users(id uuid primary key,email text,created_at timestamptz default clock_timestamp(),invited_at timestamptz,last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{}');insert into auth.users(id,email) select id,display_name||'@example.test' from profiles;`);
 await db.exec(readFileSync('supabase/migrations/202609120007_team_management_v2.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609160001_notification_profile_and_role_guards.sql','utf8'));
 await db.exec('alter table auth.users add column email_confirmed_at timestamptz, add column banned_until timestamptz');
 await db.exec(readFileSync('supabase/migrations/202610010002_team_invitation_display.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261007013837_lead_student_invitations.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/student-role-live-core.sql','utf8'));
}
