import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export async function noticesBaseline(fullFinance=false, installedDb?:PGlite){
 const db=installedDb??new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table profiles(id uuid primary key,display_name text,role text constraint profiles_role_check check(role in ('readonly','student','lead','admin','mentor')),active boolean,primary_area_id uuid,updated_at timestamptz default now(),email text,created_at timestamptz default now());
 create table areas(id uuid primary key default gen_random_uuid(),name text,active boolean default true,slug text unique default gen_random_uuid()::text);
 insert into areas(id,name) values('${id(101)}','Fabrication'),('${id(102)}','Electrical');
 insert into profiles(id,display_name,role,active,primary_area_id) values('${id(1)}','Mentor','mentor',true,'${id(101)}'),('${id(2)}','Student','student',true,'${id(101)}'),('${id(3)}','Other student','student',true,'${id(102)}'),('${id(4)}','Inactive','mentor',false,null),('${id(5)}','Lead','lead',true,'${id(101)}'),('${id(6)}','Reader','readonly',true,null),('${id(7)}','Admin','admin',true,null),('${id(8)}','Ordinary mentor','mentor',true,null),('${id(9)}','Second coach','mentor',true,null);
 grant select on profiles,areas to authenticated;
 alter table profiles enable row level security;create policy profile_read on profiles for select to authenticated using(id=auth.uid());
 ${fullFinance?'':`create table pit_events(id uuid primary key,name text,status text);create table pit_issues(id uuid primary key,event_id uuid,severity text,status text);`}
 create table inventory_items(id uuid primary key,quantity numeric,minimum_quantity numeric);create table inventory_balances(inventory_item_id uuid,quantity numeric);
 grant select on inventory_items,inventory_balances to authenticated;${fullFinance?'':`grant select on pit_events,pit_issues to authenticated;`}
 ${fullFinance?'':`insert into pit_events values('${id(301)}','Competition','active');insert into pit_issues values('${id(302)}','${id(301)}','ROBOT DOWN','DEFERRED');`}
 insert into inventory_items values('${id(401)}',0,2),('${id(402)}',3,5);insert into inventory_balances values('${id(401)}',0),('${id(402)}',3);
 `);
 if(fullFinance)await db.exec(readFileSync('tests/fixtures/finance-candidate/pit_operations.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609100001_team_attendance.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/finance_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609120003_team_management_positions.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609120005_hub_dashboard_announcements.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/finance_notifications.sql','utf8'));
 // Storage service enforces bucket size/MIME; local tables exercise actual RLS policies.
 await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
 await db.exec(readFileSync('supabase/migrations/202609120006_team_communications.sql','utf8'));

 await db.exec(`select set_config('test.uid','${id(1)}',false);
 insert into team_meetings(id,title,meeting_type,starts_at,ends_at,requirement,status,created_by) values('${id(201)}','Past','preseason',now()-interval '2 days',now()-interval '1 day','registered','finalized','${id(1)}'),('${id(202)}','Next build','other',now()+interval '1 day',now()+interval '1 day 3 hours','registered','draft','${id(1)}');
 insert into team_meeting_members(meeting_id,student_id,required,member_status,team_area) values('${id(201)}','${id(2)}',true,'registered','Fabrication'),('${id(202)}','${id(2)}',true,'registered','Fabrication'),('${id(201)}','${id(3)}',true,'registered','Electrical');
 insert into team_attendance(id,meeting_id,student_id,physical_status,review_status) values('${id(211)}','${id(201)}','${id(2)}','late','none'),('${id(212)}','${id(202)}','${id(2)}','pending','pending'),('${id(213)}','${id(201)}','${id(3)}','absent','pending');
 insert into team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by) values('${id(213)}','${id(3)}','${id(201)}','Other',5,'Internal discipline','${id(1)}');
 insert into finance_purchase_orders(id,requester_id,area_id,sheet_url,vendor,amount,purpose,status,revision) values('${id(501)}','${id(2)}','${id(101)}','https://docs.google.com/spreadsheets/d/fixture','My vendor',25,'Parts','awaiting_approval',1),('${id(502)}','${id(3)}','${id(102)}','https://docs.google.com/spreadsheets/d/fixture','Private vendor',99,'Parts','awaiting_approval',1);
 insert into finance_po_revisions(po_id,revision,metadata,submitted_by) values('${id(501)}',1,'{}','${id(2)}'),('${id(502)}',1,'{}','${id(3)}');`);
 await db.exec(readFileSync('supabase/migrations/202609120001_attendance_requests_recurrence.sql','utf8'));
 // Match the legacy production audit table: ten columns, a required profile actor,
 // and no database-session attribution trigger. Do not relax its constraints.
 await db.exec(`reset role;drop view team_attendance_history;alter table team_attendance_private.history set schema public;alter table public.history rename to team_attendance_history;drop trigger team_history_actor on public.team_attendance_history;alter table public.team_attendance_history drop column actor_auth_uid,drop column actor_database_session,drop column actor_database_role,alter column performed_by set not null;grant select on team_attendance_history to authenticated;create policy attendance_history_read on team_attendance_history for select to authenticated using(team_attendance_private.manager() or student_id=auth.uid());`);
 await db.exec(readFileSync('tests/fixtures/attendance-production-functions.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609300001_attendance_policy_v03.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/finance_notification_coverage.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610050001_notification_center.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261008032037_attendance_program_manager_mentor_review.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261008032108_attendance_program_manager_notification_routing.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261008051847_attendance_program_manager_participation.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261008063138_attendance_coach_request_review.sql','utf8'));

 await db.exec(`create schema private;create function private.current_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and active$$;create table auth.users(id uuid primary key,email text,created_at timestamptz default clock_timestamp(),invited_at timestamptz,last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,banned_until timestamptz);insert into auth.users(id,email) select id,display_name||'@example.test' from profiles;`);
 for(const file of ['202609120007_team_management_v2.sql','202609160001_notification_profile_and_role_guards.sql','202610010002_team_invitation_display.sql','20261007013837_lead_student_invitations.sql','20261007033053_attendance_meeting_editing.sql','20261015071925_frc_2027_kickoff_reset.sql']){
  await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 }
 await db.exec(readFileSync('tests/fixtures/student-role-live-core.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/student-role-live-attendance.sql','utf8'));
 if(fullFinance)for(const file of ["202609200001_finance_budget_core.sql", "202609200002_finance_workbook.sql", "20261005235435_finance_repair_po_links.sql", "20261007011342_allow_all_active_student_purchase_requests.sql", "20261018051306_finance_notification_delivery_authorization.sql", "20261027204114_finance_po_received.sql", "20261028033326_finance_po_actionability.sql"])await db.exec(readFileSync('tests/fixtures/finance-candidate/'+file,'utf8'));
 return db;

}
