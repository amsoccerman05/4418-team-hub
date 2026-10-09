import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;let mid:string;
const id=(n:number)=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);}
async function manage(action:string,p:any){return (await db.query<any>('select team_attendance_manage($1,$2::jsonb) r',[action,JSON.stringify(p)])).rows[0].r;}
async function row(n=3){return (await db.query<any>('select * from team_attendance where meeting_id=$1 and student_id=$2',[mid,id(n)])).rows[0];}
async function request(n:number,kind='absent'){await as(n);const a=await row(n);return db.query('select team_attendance_request($1::jsonb)',[JSON.stringify({meeting_id:mid,version:a.version,notice_type:kind,reason:'Policy request',expected_at:kind==='absent'?null:new Date(Date.now()+49*3600000).toISOString(),student_id:id(5)})]);}
test.beforeEach(async()=>{
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
});
test.afterEach(()=>db.close());

const migration = () => readFileSync('supabase/migrations/20261008234849_attendance_active_meeting_roster_sync.sql','utf8');
async function migrate(){await db.exec('reset role');await db.exec(migration());}
async function sync(){return (await db.query<any>('select team_attendance_sync_future_rosters() r')).rows[0].r;}
async function scoped(n:number,meetings:string[]){return (await db.query<any>('select team_attendance_sync_participant_rosters($1,$2::uuid[]) r',[id(n),meetings])).rows[0].r;}
async function create(requirement='active',extra:any={}){await as(1);return (await manage('create',{title:'Synthetic roster meeting',meeting_type:'preseason',requirement,starts_at:new Date(Date.now()+72*3600000).toISOString(),ends_at:new Date(Date.now()+74*3600000).toISOString(),...extra})).id;}
async function newStudent(n=20,role='student',active=true){await db.exec('reset role');await db.query('insert into profiles values($1,$2,$3,$4)',[id(n),'Synthetic new participant',role,active]);}
async function ongoing(meeting=mid,minutes=20){await db.exec('reset role');await db.query("update team_meetings set starts_at=clock_timestamp()-make_interval(mins=>$2),ends_at=clock_timestamp()+interval '1 hour',status='open',check_in_open=true,code_expires_at=clock_timestamp()+interval '30 minutes',code_hash=sha256(convert_to(id::text||'123456','UTF8')) where id=$1",[meeting,minutes]);}
async function fingerprint(){await db.exec('reset role');return (await db.query<any>(`select jsonb_build_object(
 'meetings',(select jsonb_agg(to_jsonb(t) order by id) from team_meetings t),
 'members',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from team_meeting_members t),
 'attendance',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance t),
 'strikes',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_strikes t),
 'history',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_history t)) s`)).rows[0].s;}
async function visible(meeting=mid){return (await db.query('select id from team_meetings where id=$1',[meeting])).rows;}

for(const kind of ['all','scoped'])test(`${kind} sync fixes started-meeting visibility through real RLS, audits actor, and leaves check-in identity/late rules intact`,async()=>{
 await ongoing();await newStudent();await newStudent(21);await as(20);expect(await visible()).toHaveLength(0);
 await expect(db.query("select team_attendance_check_in($1,'123456')",[mid])).rejects.toThrow(/roster/);
 await as(1);expect(await sync()).toMatchObject({added:0,promoted:0,skipped:0});
 await expect(scoped(20,[mid])).rejects.toThrow(/future/);
 const before=await fingerprint();await migrate();expect(await fingerprint()).toEqual(before);
 await as(1);expect(kind==='all'?await sync():await scoped(20,[mid])).toMatchObject({added:kind==='all'?2:1,promoted:0,skipped:0});
 const after=await fingerprint();await as(1);expect(kind==='all'?await sync():await scoped(20,[mid])).toMatchObject({added:0,promoted:0,skipped:0});expect(await fingerprint()).toEqual(after);
 await as(20);expect(await visible()).toHaveLength(1);
 expect((await db.query<any>('select student_id from team_meeting_members where meeting_id=$1',[mid])).rows).toEqual([{student_id:id(20)}]);
 expect((await db.query<any>('select student_id from team_attendance where meeting_id=$1',[mid])).rows).toEqual([{student_id:id(20)}]);
 expect((await db.query<any>("select team_attendance_check_in($1,'654321') r",[mid])).rows[0].r.error).toBe('Invalid meeting code');
 expect((await db.query<any>("select team_attendance_check_in($1,'123456') r",[mid])).rows[0].r.message).toBe('Checked in');
 const checked=await row(20);expect(checked).toMatchObject({physical_status:'late',review_status:'none',version:2});expect(checked.checked_in_at).not.toBeNull();
 await db.query("select team_attendance_check_in($1,'123456')",[mid]);expect(await row(20)).toEqual(checked);
 await as(21);expect(await visible()).toHaveLength(kind==='all'?1:0);
 await as(1);expect((await row(21))?.checked_in_at??null).toBeNull();
 const audit=(await db.query<any>("select performed_by from team_attendance_history where student_id=$1 and action='ROSTER_SYNC_ADD'",[id(20)])).rows;
 expect(audit).toEqual([{performed_by:id(1)}]);
});

test('bulk sync only includes future/ongoing draft/open broad meetings, never closed/finalized/ended/custom rosters',async()=>{
 const future=mid,open=await create(),draft=await create(),closed=await create(),finalized=await create(),ended=await create(),selected=await create('selected',{selected_students:[id(3)]}),optional=await create('optional'),areas=await create('areas',{areas:['Software']});
 await ongoing(open);await ongoing(draft);await db.exec('reset role');await db.query("update team_meetings set status='draft',check_in_open=false where id=$1",[draft]);
 await db.query("update team_meetings set status='closed' where id=$1",[closed]);await db.query("update team_meetings set status='finalized' where id=$1",[finalized]);
 await db.query("update team_meetings set starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 second' where id=$1",[ended]);
 await newStudent();await migrate();await as(1);expect(await sync()).toMatchObject({added:3,promoted:0,skipped:0});
 expect((await db.query<any>('select meeting_id from team_meeting_members where student_id=$1 order by meeting_id',[id(20)])).rows.map(x=>x.meeting_id)).toEqual([future,open,draft].sort());
 for(const target of [closed,finalized,ended,selected,optional,areas]){const before=await fingerprint();await as(1);await expect(scoped(20,[open,target])).rejects.toThrow(/future or in-progress/);expect(await fingerprint()).toEqual(before);}
});

test('registered eligibility, active membership, and participant identity remain authoritative',async()=>{
 const registered=await create('registered');await ongoing(registered);await newStudent(20);await newStudent(21,'student',false);await newStudent(22,'readonly');await newStudent(23,'mentor');await newStudent(24);
 await as(1);await manage('member',{student_id:id(24),member_status:'inactive'});await migrate();await as(1);await sync();
 expect((await db.query<any>('select student_id from team_meeting_members where meeting_id=$1 and student_id>=$2',[registered,id(20)])).rows).toEqual([]);
 await expect(scoped(20,[registered])).rejects.toThrow(/Registered/);
 for(const n of [21,22,23,24])await expect(scoped(n,[registered])).rejects.toThrow(/participant|inactive/);
 await manage('member',{student_id:id(20),member_status:'registered'});expect(await scoped(20,[registered])).toMatchObject({added:1});
 await as(20);expect(await visible(registered)).toHaveLength(1);
});

test('ongoing sync preserves attendance, requests, reviews, strikes and all existing required snapshots byte-for-byte',async()=>{
 await ongoing();await as(1);const a=await row(3);await manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,physical_status:'present',explanation:'Recorded before sync'});await manage('strike',{meeting_id:mid,attendance_id:a.id,category:'Other',quantity:1,explanation:'Preserved synthetic strike'});
 await newStudent();await migrate();const before=await fingerprint();await as(1);expect(await sync()).toMatchObject({added:1});const after=await fingerprint();
 expect(after.meetings).toEqual(before.meetings);expect(after.strikes).toEqual(before.strikes);
 expect(after.attendance.filter((x:any)=>x.student_id!==id(20))).toEqual(before.attendance);
 expect(after.members.filter((x:any)=>x.student_id!==id(20))).toEqual(before.members);
 expect(after.history.filter((x:any)=>x.student_id!==id(20))).toEqual(before.history);
});

test('in-progress optional promotions still preserve touched requests, reviews and check-ins',async()=>{
 const clean=await create('registered'),requested=await create('registered'),reviewed=await create('registered'),recorded=await create('registered');
 await as(1);await manage('member',{student_id:id(7),member_status:'registered'});
 for(const meeting of [clean,requested,reviewed,recorded])await ongoing(meeting);
 await db.query("update team_attendance set notice_at=now(),notice_reason='Keep',review_status='pending',version=version+1 where meeting_id=$1 and student_id=$2",[requested,id(7)]);
 await db.query("update team_attendance set reviewed_at=now(),reviewed_by=$2,review_reason='Keep',review_status='excused',version=version+1 where meeting_id=$1 and student_id=$3",[reviewed,id(1),id(7)]);
 await db.query("update team_attendance set checked_in_at=now(),physical_status='present',version=version+1 where meeting_id=$1 and student_id=$2",[recorded,id(7)]);
 await migrate();const before=await fingerprint();await as(1);expect(await scoped(7,[clean,requested,reviewed,recorded])).toMatchObject({added:0,promoted:1,skipped:3});const after=await fingerprint();
 const retained=(s:any)=>s.attendance.filter((x:any)=>[requested,reviewed,recorded].includes(x.meeting_id));expect(retained(after)).toEqual(retained(before));
});

test('closed check-in, expired code, rate limit, and scheduled end still deny student check-in after roster sync',async()=>{
 await ongoing();await newStudent();await migrate();await as(1);await scoped(20,[mid]);
 await as(20);for(let i=0;i<5;i++)expect((await db.query<any>("select team_attendance_check_in($1,'654321') r",[mid])).rows[0].r.error).toBe('Invalid meeting code');
 expect((await db.query<any>("select team_attendance_check_in($1,'123456') r",[mid])).rows[0].r.error).toMatch(/Too many/);
 for(const change of ["check_in_open=false","code_expires_at=clock_timestamp()-interval '1 second'","starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 second'"]){
  await ongoing();await db.exec('reset role');await db.query('update team_meetings set '+change+' where id=$1',[mid]);await as(20);await expect(db.query("select team_attendance_check_in($1,'123456')",[mid])).rejects.toThrow(/closed|expired/);expect((await row(20)).checked_in_at).toBeNull();
 }
});

test('migration changes only two sync function bodies and preserves auth, RLS, review rules and audit schema',async()=>{
 await ongoing();await newStudent();
 const inspect=async()=>{await db.exec('reset role');return (await db.query<any>(`select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','team_attendance_private','public') and p.proname not in ('team_attendance_sync_future_rosters','sync_participant_rosters')),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p),
 'audit',(select jsonb_agg(jsonb_build_object('name',column_name,'nullable',is_nullable) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='team_attendance_history')) s`)).rows[0].s;};
 const before=await inspect();await migrate();expect(await inspect()).toEqual(before);
 const state=await fingerprint();await db.exec("reset role;select set_config('test.uid','',false)");
 for(const q of [()=>sync(),()=>scoped(20,[mid]),()=>db.query('select team_attendance_private.sync_participant_rosters($1,$2::uuid[])',[id(20),[mid]])])await expect(q()).rejects.toThrow(/Leadership/);
 expect(await fingerprint()).toEqual(state);
 for(const n of [3,4,9,10,13,20]){await as(n);await expect(sync()).rejects.toThrow(/Leadership/);await expect(scoped(20,[mid])).rejects.toThrow(/Leadership/);}
 await db.exec('reset role;set role anon');await expect(sync()).rejects.toThrow(/permission denied/);
 await db.exec('reset role;set role authenticated');await expect(db.query('select team_attendance_private.sync_participant_rosters(null,null)')).rejects.toThrow(/permission denied/);
});
