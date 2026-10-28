import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;let mid:string;
const id=(n:number)=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);}
async function manage(action:string,p:any){return (await db.query<any>('select team_attendance_manage($1,$2::jsonb) r',[action,JSON.stringify(p)])).rows[0].r;}
async function row(n=3){return (await db.query<any>('select * from team_attendance where meeting_id=$1 and student_id=$2',[mid,id(n)])).rows[0];}
async function request(n:number,kind='absent'){await as(n);const a=await row(n);return db.query('select team_attendance_request($1::jsonb)',[JSON.stringify({meeting_id:mid,version:a.version,notice_type:kind,reason:'Policy request',expected_at:kind==='absent'?null:new Date(Date.now()+49*3600000).toISOString(),student_id:id(5)})]);}
test.beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;grant usage on schema auth to authenticated;
 create table profiles(id uuid primary key,display_name text,role text,active boolean);insert into profiles values('${id(1)}','Mentor','mentor',true),('${id(2)}','Lead','lead',true),('${id(3)}','Student','student',true),('${id(4)}','Program Manager','student',true),('${id(5)}','Other','student',true),('${id(6)}','Admin','admin',true);
 create table team_positions(key text primary key,name text,active boolean);insert into team_positions values('program_manager','Program Manager',true),('software_lead','Software Lead',true);
 create table team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);insert into team_member_positions values('${id(4)}','program_manager',null),('${id(2)}','software_lead',null);
 create function public.team_has_position(key text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.team_member_positions mp join public.team_positions p on p.key=mp.position_key and p.active join public.profiles u on u.id=mp.user_id and u.active and u.role in ('student','lead','mentor','admin') where mp.user_id=auth.uid() and mp.position_key=$1 and mp.revoked_at is null) $$;
 select set_config('test.uid','${id(1)}',false);`);
 for(const file of ['202609100001_team_attendance.sql','202609120001_attendance_requests_recurrence.sql','202609120008_attendance_roster_sync.sql'])
  await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 // Production has the legacy public audit table: a required profile actor,
 // no actor_auth_uid/database-session fields and no actor-attribution trigger.
 // Convert this isolated fixture only; the migration never changes audit schema.
 await db.exec(`drop view team_attendance_history;alter table team_attendance_private.history set schema public;alter table public.history rename to team_attendance_history;
 drop trigger team_history_actor on public.team_attendance_history;
 alter table public.team_attendance_history drop column actor_auth_uid,drop column actor_database_session,drop column actor_database_role,alter column performed_by set not null;
 grant select on team_attendance_history to authenticated;
 create policy attendance_history_read on team_attendance_history for select to authenticated using(team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));`);
 await db.exec(readFileSync('tests/fixtures/attendance-production-functions.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609300001_attendance_policy_v03.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261008032037_attendance_program_manager_mentor_review.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261008051847_attendance_program_manager_participation.sql','utf8'));
 await db.exec(`reset role;
 insert into profiles values('${id(7)}','Mentor PM','mentor',true),('${id(8)}','Admin PM','admin',true),('${id(9)}','Reader PM','readonly',true),('${id(10)}','Inactive mentor PM','mentor',false),('${id(11)}','Lead PM','lead',true),('${id(12)}','Revoked mentor PM','mentor',true),('${id(13)}','Inactive student','student',false);
 insert into team_member_positions values('${id(7)}','program_manager',null),('${id(8)}','program_manager',null),('${id(9)}','program_manager',null),('${id(10)}','program_manager',null),('${id(11)}','program_manager',null),('${id(12)}','program_manager',now());`);
 await db.exec(readFileSync('supabase/migrations/20261008063138_attendance_coach_request_review.sql','utf8'));
 await as(1);mid=(await manage('create',{title:'Policy meeting',meeting_type:'preseason',requirement:'active',late_minutes:10,starts_at:new Date(Date.now()+48*3600000).toISOString(),ends_at:new Date(Date.now()+50*3600000).toISOString()})).id;
 await db.exec('reset role');
 for (const file of ['20261008234849_attendance_active_meeting_roster_sync.sql','20261009155227_attendance_automatic_absence_strikes.sql','20261010144754_attendance_operations_lead_participation.sql','20261007033053_attendance_meeting_editing.sql','20261011025742_attendance_required_roster_editing.sql','20261014034212_attendance_check_in_hardening.sql','20261014051116_attendance_checkout_grace.sql','20261014052049_attendance_stem_outreach.sql']) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(`create table auth.users(id uuid primary key,email_confirmed_at timestamptz,last_sign_in_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
 insert into auth.users(id,email_confirmed_at,last_sign_in_at) select id,now(),now() from profiles;`);
 const before=await fingerprint();
 const boundary=async()=> (await db.query<any>(`select jsonb_build_object(
  'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
  'tables',(select jsonb_agg(jsonb_build_object('oid',c.oid,'acl',c.relacl,'rls',c.relrowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','team_attendance_private') and c.relkind in ('r','v')),
  'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl,'definition',pg_get_functiondef(p.oid)) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','team_attendance_private') and p.proname not in ('sync_missing_rosters','team_attendance_sync_my_rosters'))) r`)).rows[0].r;
 const boundaryBefore=await boundary();
 await db.exec(readFileSync('supabase/migrations/20261028001414_attendance_automatic_roster_membership.sql','utf8'));
 expect(await fingerprint()).toEqual(before);expect(await boundary()).toEqual(boundaryBefore);
});
test.beforeEach(async()=>{await db.exec('begin');});
test.afterEach(async()=>{await db.exec('rollback');});
test.afterAll(()=>db.close());
async function create(requirement='active',extra:any={}){await as(1);return (await manage('create',{title:'Synthetic roster meeting',meeting_type:'preseason',requirement,starts_at:new Date(Date.now()+72*3600000).toISOString(),ends_at:new Date(Date.now()+74*3600000).toISOString(),...extra})).id;}
async function newStudent(n=20,role='student',active=true){await db.exec('reset role');await db.query('insert into profiles values($1,$2,$3,$4)',[id(n),'Synthetic new participant',role,active]);await db.query('insert into auth.users(id,email_confirmed_at,last_sign_in_at) values($1,now(),now())',[id(n)]);}
async function ongoing(meeting=mid,minutes=20){await db.exec('reset role');await db.query("update team_meetings set starts_at=clock_timestamp()-make_interval(mins=>$2),ends_at=clock_timestamp()+interval '1 hour',status='open',check_in_open=true,code_expires_at=clock_timestamp()+interval '30 minutes',code_hash=sha256(convert_to(id::text||'123456','UTF8')) where id=$1",[meeting,minutes]);}
async function fingerprint(){await db.exec('reset role');return (await db.query<any>(`select jsonb_build_object(
 'meetings',(select jsonb_agg(to_jsonb(t) order by id) from team_meetings t),
 'members',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from team_meeting_members t),
 'attendance',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance t),
 'strikes',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_strikes t),
 'history',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_history t)) s`)).rows[0].s;}
async function visible(meeting=mid){return (await db.query('select id from team_meetings where id=$1',[meeting])).rows;}

async function autosync(n=20){await as(n);return (await db.query<any>('select public.team_attendance_sync_my_rosters() r')).rows[0].r;}
async function snapshotRow(meeting=mid,n=20){await db.exec('reset role');return (await db.query<any>('select * from team_meeting_members where meeting_id=$1 and student_id=$2',[meeting,id(n)])).rows[0];}

test('accepted student first visit repairs missing future row with own audit and real RLS; repeated visits are no-ops',async()=>{
 await newStudent();await newStudent(21);await as(20);expect(await visible()).toHaveLength(0);
 expect(await autosync()).toEqual({added:1});expect(await visible()).toHaveLength(1);
 expect((await row(20))).toMatchObject({physical_status:'pending',review_status:'none',checked_in_at:null,left_at:null});
 expect((await db.query<any>('select student_id from team_meeting_members where meeting_id=$1',[mid])).rows).toEqual([{student_id:id(20)}]);
 const audit=(await db.query<any>("select performed_by from team_attendance_history where action='ROSTER_AUTO_ADD'")).rows;expect(audit).toEqual([{performed_by:id(20)}]);
 const before=await fingerprint();expect(await autosync()).toEqual({added:0});expect(await fingerprint()).toEqual(before);
 await as(21);expect(await visible()).toHaveLength(0);
});

test('ongoing custom roster gets optional visibility without changing existing decisions, attendance or selected IDs',async()=>{
 const custom=await create('selected',{selected_students:[id(3)]});await ongoing(custom);
 await newStudent();const before=await fingerprint();expect(await autosync()).toEqual({added:2});
 expect(await snapshotRow(custom)).toMatchObject({required:false,member_status:'prospective'});
 await as(20);expect(await visible(custom)).toHaveLength(1);
 const pending=(await db.query<any>('select * from team_attendance where meeting_id=$1',[custom])).rows[0];expect(pending).toMatchObject({physical_status:'pending',review_status:'not_required',checked_in_at:null});
 const after=await fingerprint();expect(after.meetings).toEqual(before.meetings);expect(after.strikes).toEqual(before.strikes);
 expect(after.members.filter((x:any)=>x.student_id!==id(20))).toEqual(before.members);
 expect(after.attendance.filter((x:any)=>x.student_id!==id(20))).toEqual(before.attendance);
 await as(20);expect((await db.query<any>("select team_attendance_check_in($1,'654321') r",[custom])).rows[0].r.error).toBe('Invalid meeting code');
 expect((await db.query<any>("select team_attendance_check_in($1,'123456') r",[custom])).rows[0].r.message).toBe('Checked in');
});

test('future requirements mirror creation; registered area and custom selections do not become all-required',async()=>{
 const registered=await create('registered'),area=await create('areas',{areas:['Software']}),custom=await create('selected',{selected_students:[id(3)]}),optional=await create('optional');
 await newStudent();await as(1);await manage('member',{student_id:id(20),member_status:'registered',team_area:'Software'});
 expect(await autosync()).toEqual({added:5});
 for(const m of [mid,registered,area])expect((await snapshotRow(m)).required).toBe(true);
 for(const m of [custom,optional])expect((await snapshotRow(m)).required).toBe(false);
 await newStudent(21);expect(await autosync(21)).toEqual({added:5});
 for(const m of [registered,area,custom,optional])expect((await snapshotRow(m,21)).required).toBe(false);
});

test('all ongoing additions are optional and closed/finalized/ended meetings never receive new rows',async()=>{
 const closed=await create(),finalized=await create(),ended=await create();await ongoing(mid);
 await db.exec('reset role');await db.query("update team_meetings set status='closed' where id=$1",[closed]);await db.query("update team_meetings set status='finalized' where id=$1",[finalized]);
 await db.query("update team_meetings set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 minute' where id=$1",[ended]);
 await newStudent();expect(await autosync()).toEqual({added:1});expect((await snapshotRow()).required).toBe(false);
 for(const m of [closed,finalized,ended])expect(await snapshotRow(m)).toBeUndefined();
});

for(const state of ['pending','unconfirmed','banned','deleted','anonymous','inactive_profile','inactive_membership','readonly','mentor'])test(`${state} account cannot auto-enroll`,async()=>{
 await newStudent(20,state==='readonly'?'readonly':state==='mentor'?'mentor':'student',state!=='inactive_profile');
 await db.exec('reset role');
 const change:{[key:string]:string}={pending:'last_sign_in_at=null',unconfirmed:'email_confirmed_at=null',banned:"banned_until=now()+interval '1 hour'",deleted:'deleted_at=now()',anonymous:'is_anonymous=true'};
 if(change[state])await db.query('update auth.users set '+change[state]+' where id=$1',[id(20)]);
 if(state==='inactive_membership'){await as(1);await manage('member',{student_id:id(20),member_status:'inactive'});}
 const before=await fingerprint();expect(await autosync()).toEqual({added:0});expect(await fingerprint()).toEqual(before);
});

test('existing optional and touched rows remain unchanged after registration and repeated sync',async()=>{
 await newStudent();await ongoing();await autosync();await as(20);const a=await row(20);
 await db.exec('reset role');await db.query("update team_attendance set notice_at=now()-interval '1 day',notice_type='absent',notice_reason='Preserve my request',review_status='pending',version=version+1 where id=$1",[a.id]);
 await as(1);await manage('member',{student_id:id(20),member_status:'registered'});
 const before=await fingerprint();expect(await autosync()).toEqual({added:0});expect(await fingerprint()).toEqual(before);
 expect((await snapshotRow()).required).toBe(false);
});

test('anonymous access and cross-participant enrollment are unavailable',async()=>{
 await newStudent();await as(20);
 await db.exec('savepoint denied');await expect(db.query('select team_attendance_private.sync_missing_rosters($1)',[id(3)])).rejects.toThrow(/permission denied/);await db.exec('rollback to denied');
 await db.exec('reset role;set role anon;savepoint denied_anon');await expect(db.query('select team_attendance_sync_my_rosters()')).rejects.toThrow(/permission denied/);await db.exec('rollback to denied_anon');
 await db.exec("reset role;select set_config('test.uid','',false);set role authenticated;savepoint denied_null");await expect(db.query('select team_attendance_sync_my_rosters()')).rejects.toThrow(/Sign in required/);await db.exec('rollback to denied_null');
});

test('STEM outreach remains optional and does not introduce automatic notices',async()=>{
 const outreach=await create('optional',{meeting_type:'stem_outreach'});await newStudent();await autosync();
 expect((await snapshotRow(outreach)).required).toBe(false);
 await db.exec('reset role');expect((await db.query<any>('select count(*)::int n from team_attendance_strikes where student_id=$1',[id(20)])).rows[0].n).toBe(0);
});


test('invitation acceptance and later activation retry naturally without storing a stale sync flag',async()=>{
 await newStudent();await db.exec('reset role');await db.query('update auth.users set last_sign_in_at=null where id=$1',[id(20)]);
 expect(await autosync()).toEqual({added:0});await db.exec('reset role');await db.query('update auth.users set last_sign_in_at=now() where id=$1',[id(20)]);
 expect(await autosync()).toEqual({added:1});
 await newStudent(21,'student',false);expect(await autosync(21)).toEqual({added:0});await db.exec('reset role');await db.query('update profiles set active=true where id=$1',[id(21)]);
 expect(await autosync(21)).toEqual({added:1});
});

test('active Operations Lead eligibility is reused without turning an ordinary mentor into a participant',async()=>{
 await newStudent(20,'mentor');expect(await autosync()).toEqual({added:0});await db.exec('reset role');
 await db.exec("insert into team_positions values('operations_lead','Operations Lead',true)");await db.query("insert into team_member_positions values($1,'operations_lead',null)",[id(20)]);
 expect(await autosync()).toEqual({added:1});
});
