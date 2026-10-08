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
 await db.exec(`drop view team_attendance_history;alter table team_attendance_private.history set schema public;alter table public.history rename to team_attendance_history;grant select on team_attendance_history to authenticated;
 create policy attendance_history_read on team_attendance_history for select to authenticated using(team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));`);
 await db.exec(readFileSync('tests/fixtures/attendance-production-functions.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609300001_attendance_policy_v03.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261008032037_attendance_program_manager_mentor_review.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261008051847_attendance_program_manager_participation.sql','utf8'));
 await db.exec(`reset role;
 insert into profiles values('${id(7)}','Mentor PM','mentor',true),('${id(8)}','Admin PM','admin',true),('${id(9)}','Reader PM','readonly',true),('${id(10)}','Inactive mentor PM','mentor',false),('${id(11)}','Lead PM','lead',true),('${id(12)}','Revoked mentor PM','mentor',true),('${id(13)}','Inactive student','student',false);
 insert into team_member_positions values('${id(7)}','program_manager',null),('${id(8)}','program_manager',null),('${id(9)}','program_manager',null),('${id(10)}','program_manager',null),('${id(11)}','program_manager',null),('${id(12)}','program_manager',now());`);
 await as(1);mid=(await manage('create',{title:'Policy meeting',meeting_type:'preseason',requirement:'active',late_minutes:10,starts_at:new Date(Date.now()+48*3600000).toISOString(),ends_at:new Date(Date.now()+50*3600000).toISOString()})).id;
});
test.afterEach(()=>db.close());
const participants=[2,3,4,5,7,8,11];
const pms=[4,7,8,11];
async function context(){return (await db.query<any>('select team_attendance_policy_context() c')).rows[0].c;}
async function create(requirement='active',extra:any={}) {await as(1);return (await manage('create',{title:'Scoped roster test',meeting_type:'preseason',requirement,starts_at:new Date(Date.now()+72*3600000).toISOString(),ends_at:new Date(Date.now()+74*3600000).toISOString(),...extra})).id;}
async function scoped(n:number,meetings:string[]){return (await db.query<any>('select team_attendance_sync_participant_rosters($1,$2::uuid[]) r',[id(n),meetings])).rows[0].r;}
async function snapshot(){await db.exec('reset role');return (await db.query<any>(`select jsonb_build_object('meetings',(select jsonb_agg(to_jsonb(t) order by id) from team_meetings t),'members',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from team_meeting_members t),'attendance',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance t),'history',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_history t)) s`)).rows[0].s;}

test('participants and capabilities use live account plus position state without shared-role changes',async()=>{
 await as(1);expect((await db.query<any>('select student_id from team_attendance_roster() order by student_id')).rows.map(r=>r.student_id)).toEqual(participants.map(id));
 for(const n of [...participants,1,6,12]){
  await as(n);const c=await context();
  expect(c.can_participate).toBe(participants.includes(n));
  expect(c.can_manage_meetings).toBe([1,2,6,7,8,11,12].includes(n));
  expect(c.can_review).toBe([1,4,7,8,11,12].includes(n));
  expect(c.can_review_program_manager_requests).toBe([1,12].includes(n));
  if(c.can_read_team)expect(c.mentor_review_required_for.sort()).toEqual(pms.map(id));
 }
 for(const n of [9,10,13]){await as(n);await expect(context()).rejects.toThrow(/Active Attendance account/);}
 await db.exec('reset role');
 expect((await db.query<any>('select role from profiles where id=$1',[id(7)])).rows[0].role).toBe('mentor');
 expect((await db.query<any>('select role from profiles where id=$1',[id(8)])).rows[0].role).toBe('admin');
 for(const n of [7,8]){
  await db.exec('reset role');await db.query('update team_member_positions set revoked_at=now() where user_id=$1',[id(n)]);await as(n);expect((await context()).can_participate).toBe(false);
  await db.exec('reset role');await db.query('update team_member_positions set revoked_at=null where user_id=$1',[id(n)]);
 }
 await db.exec("reset role;update team_positions set active=false where key='program_manager'");
 for(const n of [7,8]){await as(n);expect((await context()).can_participate).toBe(false);}
 await as(4);expect((await context()).can_participate).toBe(true);
});

for(const n of [7,8])test(`shared ${n===7?'mentor':'admin'} Program Manager submits all own request kinds and legacy notice with version and audit`,async()=>{
 for(const kind of ['absent','late','early']){await request(n,kind);const a=await row(n);expect(a).toMatchObject({notice_type:kind,review_status:'pending',reviewed_by:null,physical_status:'pending'});}
 await as(1);expect((await row(5)).notice_at).toBeNull();
 await as(n);const a=await row(n);
 await expect(db.query('select team_attendance_request($1::jsonb)',[JSON.stringify({meeting_id:mid,version:1,notice_type:'absent',reason:'Stale'})])).rejects.toThrow(/Attendance changed/);
 const other=await create();await as(n);await db.query('select team_attendance_notice($1,$2)',[other,'Legacy participant notice']);
 const legacy=(await db.query<any>('select * from team_attendance where meeting_id=$1 and student_id=$2',[other,id(n)])).rows[0];expect(legacy).toMatchObject({review_status:'pending',notice_reason:'Legacy participant notice',version:2});
 expect((await db.query<any>("select performed_by from team_attendance_history where entity_id=$1 and action='UPDATE' order by id desc limit 1",[a.id])).rows[0].performed_by).toBe(id(n));
});

test('ordinary mentor/admin, readonly, inactive and revoked PM cannot use any participant entry point or become roster targets',async()=>{
 for(const n of [1,6,9,10,12,13]){
  await as(n);
  for(const q of [()=>db.query('select team_attendance_request($1::jsonb)',[JSON.stringify({meeting_id:mid,version:1,notice_type:'absent',reason:'Denied'})]),()=>db.query('select team_attendance_notice($1,$2)',[mid,'Denied']),()=>db.query('select team_attendance_check_in($1,$2)',[mid,'123456']),()=>db.query('select team_attendance_check_out($1)',[mid])])await expect(q()).rejects.toThrow(/Active Attendance participant required/);
  await as(1);await expect(manage('member',{student_id:id(n),member_status:'registered'})).rejects.toThrow(/Active Attendance participant/);
  await expect(create('selected',{selected_students:[id(n)]})).rejects.toThrow(/unavailable/);
 }
});

for(const n of [7,8])test(`Program Manager ${n} check-in/out preserves original timestamps, request and independent review`,async()=>{
 await request(n,'early');const pending=await row(n);await as(1);await manage('attendance',{meeting_id:mid,attendance_id:pending.id,version:pending.version,review_status:'excused',explanation:'Independent mentor'});
 await db.exec('reset role');await db.query("update team_meetings set starts_at=clock_timestamp()-interval '1 minute',ends_at=clock_timestamp()+interval '1 hour',status='open',check_in_open=true,code_expires_at=clock_timestamp()+interval '30 minutes',code_hash=sha256(convert_to(id::text||'123456','UTF8')) where id=$1",[mid]);
 await as(n);await db.query("select team_attendance_check_in($1,'123456')",[mid]);let a=await row(n);expect(a).toMatchObject({physical_status:'present',review_status:'excused',reviewed_by:id(1),notice_type:'early'});expect(a.checked_in_at).not.toBeNull();
 await db.query('select team_attendance_check_out($1)',[mid]);a=await row(n);expect(a.physical_status).toBe('left_early');expect(a.left_at).not.toBeNull();const v=a.version;
 await db.query('select team_attendance_check_out($1)',[mid]);expect(await row(n)).toEqual(a);expect((await row(n)).version).toBe(v);
 await db.exec('reset role');await db.query('update team_member_positions set revoked_at=now() where user_id=$1',[id(n)]);await as(n);await expect(db.query('select team_attendance_check_out($1)',[mid])).rejects.toThrow(/participant/);
});

test('all PM roles deny self and peer decisions including mentor PM, while preserving physical corrections and strikes',async()=>{
 for(const n of pms){
  await request(n);const a=await row(n);
  for(const reviewer of pms){await as(reviewer);for(const status of ['excused','denied','not_required','none','pending'])await expect(manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,review_status:status,explanation:'Forbidden'})).rejects.toThrow(/Mentor|review/);}
  await as(1);await manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,review_status:'excused',explanation:'Independent active mentor'});expect((await row(n)).reviewed_by).toBe(id(1));
 }
 await as(7);const own=await row(7);await manage('attendance',{meeting_id:mid,attendance_id:own.id,version:own.version,physical_status:'present',explanation:'Observed self correction'});expect((await row(7)).review_status).toBe('excused');expect((await row(7)).reviewed_by).toBe(id(1));
 const student=await row(3);await manage('strike',{meeting_id:mid,attendance_id:student.id,category:'Other',quantity:1,explanation:'Existing PM strike authority'});
 await db.query("select team_attendance_policy_action('warning_parent_contact',$1::jsonb)",[JSON.stringify({student_id:id(8),note:'Completed warning'})]);
 expect((await context()).warnings.some((w:any)=>w.student_id===id(8))).toBe(true);
});

test('meeting snapshots include all allowed participants and preserve registered, area and selected semantics',async()=>{
 await as(1);await manage('member',{student_id:id(7),member_status:'registered',team_area:'Software'});
 const registered=await create('registered'),areas=await create('areas',{areas:['Software']}),selected=await create('selected',{selected_students:[id(8)]});
 for(const [meeting,n,required] of [[registered,7,true],[registered,8,false],[areas,7,true],[areas,8,false],[selected,7,false],[selected,8,true]] as const){expect((await db.query<any>('select required from team_meeting_members where meeting_id=$1 and student_id=$2',[meeting,id(n)])).rows[0].required).toBe(required);}
 const before=await snapshot();await as(1);await manage('member',{student_id:id(7),member_status:'prospective',team_area:'Mechanical'});const after=await snapshot();expect(after.history).toHaveLength(before.history.length+1);before.history=before.history.filter((h:any)=>h.entity!=='team_attendance_members');after.history=after.history.filter((h:any)=>h.entity!=='team_attendance_members');expect(after).toEqual(before);
});

test('scoped roster sync touches only one participant and explicit meetings, supports admin actor, and retries idempotently',async()=>{
 await db.exec(`reset role;delete from team_attendance where student_id in ('${id(7)}','${id(8)}');delete from team_meeting_members where student_id in ('${id(7)}','${id(8)}')`);
 const unrelated=await create();await db.exec(`reset role;delete from team_attendance where student_id in ('${id(7)}','${id(8)}');delete from team_meeting_members where student_id in ('${id(7)}','${id(8)}')`);
 await as(1);let result=await scoped(7,[mid]);expect(result).toMatchObject({added:1,promoted:0,skipped:0,student_id:id(7),meeting_ids:[mid]});
 expect((await db.query('select 1 from team_meeting_members where student_id=$1',[id(8)])).rows).toHaveLength(0);expect((await db.query('select 1 from team_meeting_members where meeting_id=$1 and student_id=$2',[unrelated,id(7)])).rows).toHaveLength(0);
 const before=await snapshot();await as(1);result=await scoped(7,[mid]);expect(result).toMatchObject({added:0,promoted:0,skipped:0});expect(await snapshot()).toEqual(before);
 await db.exec("reset role;select set_config('test.uid','',false)");result=(await db.query<any>('select team_attendance_private.sync_participant_rosters($1,$2::uuid[]) r',[id(8),[mid]])).rows[0].r;expect(result.added).toBe(1);
 const audit=(await db.query<any>("select * from team_attendance_history where student_id=$1 and action='ROSTER_SYNC_ADD'",[id(8)])).rows[0];expect(audit.performed_by).toBeNull();expect(audit.actor_auth_uid).toBeNull();expect(audit.actor_database_session).toBeTruthy();
 for(const n of [3,4,9,10]){await as(n);await expect(scoped(7,[unrelated])).rejects.toThrow(/Leadership/);await expect(db.query('select team_attendance_private.sync_participant_rosters($1,$2::uuid[])',[id(7),[unrelated]])).rejects.toThrow(/permission denied/);}
});

test('targeted preflight is atomic and enforces future broad meetings, valid active target, registration and explicit lists',async()=>{
 const registered=await create('registered'),selected=await create('selected',{selected_students:[id(7)]}),optional=await create('optional');
 const before=await snapshot();
 for(const list of [[],[mid,mid],[mid,id(999)],[mid,selected],[mid,optional],[registered]]){await as(1);await expect(scoped(7,list)).rejects.toThrow();expect(await snapshot()).toEqual(before);}
 for(const n of [1,6,9,10,12,13]){await as(1);await expect(scoped(n,[mid])).rejects.toThrow(/participant/);expect(await snapshot()).toEqual(before);}
 await as(1);await manage('member',{student_id:id(7),member_status:'inactive'});await expect(scoped(7,[mid])).rejects.toThrow(/inactive/);
 await manage('member',{student_id:id(7),member_status:'registered'});
 await db.exec('reset role');await db.query("update team_meetings set starts_at=now()-interval '1 hour' where id=$1",[mid]);await as(1);await expect(scoped(7,[mid,registered])).rejects.toThrow(/future/);
 await db.exec('reset role');await db.query("update team_meetings set status='finalized' where id=$1",[registered]);await as(1);await expect(scoped(7,[registered])).rejects.toThrow(/future/);
});

test('targeted and normal future sync preserve requests, reviewed/recorded attendance, historical snapshots and audit versions',async()=>{
 const clean=await create('registered'),requested=await create('registered'),reviewed=await create('registered'),recorded=await create('registered');
 await as(1);await manage('member',{student_id:id(7),member_status:'registered'});
 await db.exec('reset role');
 await db.query("update team_attendance set notice_at=now(),notice_reason='Keep',review_status='pending',version=version+1 where meeting_id=$1 and student_id=$2",[requested,id(7)]);
 await db.query("update team_attendance set reviewed_at=now(),reviewed_by=$2,review_reason='Keep',review_status='excused',version=version+1 where meeting_id=$1 and student_id=$3",[reviewed,id(1),id(7)]);
 await db.query("update team_attendance set checked_in_at=now(),physical_status='present',version=version+1 where meeting_id=$1 and student_id=$2",[recorded,id(7)]);
 const protectedRows=(await db.query<any>('select to_jsonb(a) a from team_attendance a where meeting_id=any($1::uuid[]) and student_id=$2 order by meeting_id',[[requested,reviewed,recorded],id(7)])).rows;
 await as(1);expect(await scoped(7,[clean,requested,reviewed,recorded])).toMatchObject({added:0,promoted:1,skipped:3});
 expect((await db.query<any>('select to_jsonb(a) a from team_attendance a where meeting_id=any($1::uuid[]) and student_id=$2 order by meeting_id',[[requested,reviewed,recorded],id(7)])).rows).toEqual(protectedRows);
 expect((await db.query<any>('select version,review_status from team_attendance where meeting_id=$1 and student_id=$2',[clean,id(7)])).rows[0]).toEqual({version:2,review_status:'none'});
 await db.exec(`reset role;delete from team_attendance where meeting_id='${mid}' and student_id='${id(8)}';delete from team_meeting_members where meeting_id='${mid}' and student_id='${id(8)}'`);
 await as(1);expect((await db.query<any>('select team_attendance_sync_future_rosters() r')).rows[0].r).toMatchObject({added:1,promoted:0,skipped:3});
 expect((await db.query<any>('select required from team_meeting_members where meeting_id=$1 and student_id=$2',[mid,id(8)])).rows[0].required).toBe(true);
});

test('new private arbitrary-identity predicates and scoped core are not callable by authenticated or anonymous users',async()=>{
 for(const role of ['authenticated','anon']){await db.exec(`reset role;set role ${role}`);for(const query of ['select team_attendance_private.is_participant(null)','select team_attendance_private.is_program_manager(null)','select team_attendance_private.is_student_program_manager(null)','select team_attendance_private.can_review_request(null,null)','select team_attendance_private.sync_participant_rosters(null,null)'])await expect(db.query(query)).rejects.toThrow(/permission denied/);}
});
