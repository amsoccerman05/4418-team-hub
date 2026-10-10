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
 await db.exec(readFileSync('supabase/migrations/20261008234849_attendance_active_meeting_roster_sync.sql','utf8'));
 await db.exec(`reset role;insert into team_positions values('operations_lead','Operations Lead',true);
 insert into profiles values('${id(20)}','Synthetic Admin Operations Lead','admin',true),('${id(21)}','Synthetic Mentor Operations Lead','mentor',true),('${id(22)}','Synthetic revoked Operations Lead','admin',true),('${id(23)}','Synthetic inactive Operations Lead','admin',false),('${id(24)}','Synthetic readonly Operations Lead','readonly',true);
 insert into team_member_positions values('${id(20)}','operations_lead',null),('${id(21)}','operations_lead',null),('${id(22)}','operations_lead',now()),('${id(23)}','operations_lead',null),('${id(24)}','operations_lead',null);`);
 await as(1);mid=(await manage('create',{title:'Policy meeting',meeting_type:'preseason',requirement:'active',late_minutes:10,starts_at:new Date(Date.now()+48*3600000).toISOString(),ends_at:new Date(Date.now()+50*3600000).toISOString()})).id;
});
test.afterEach(()=>db.close());

const migration = () => readFileSync('supabase/migrations/20261010144421_attendance_operations_lead_participation.sql','utf8');
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

async function context(){return (await db.query<any>('select team_attendance_policy_context() c')).rows[0].c;}
async function definitions(){await db.exec('reset role');return (await db.query(`select n.nspname,p.proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','team_attendance_private') and not (n.nspname='team_attendance_private' and p.proname='is_participant') order by n.nspname,p.proname,p.oid`)).rows;}

test('migration changes only the private participant predicate and no account, membership, roster, attendance or audit data',async()=>{
 const before=await fingerprint(),defs=await definitions();
 const people=await db.query('select * from profiles order by id');
 const membership=await db.query('select * from team_attendance_members order by student_id');
 await migrate();expect(await fingerprint()).toEqual(before);expect(await definitions()).toEqual(defs);
 expect((await db.query('select * from profiles order by id')).rows).toEqual(people.rows);
 expect((await db.query('select * from team_attendance_members order by student_id')).rows).toEqual(membership.rows);
 for(const n of [20,21]){await as(n);expect(await context()).toMatchObject({can_participate:true,can_manage_meetings:true,can_read_team:true,can_review_requests:false});}
 await as(20);expect((await context()).can_review).toBe(false);await as(21);expect((await context()).can_review).toBe(true);
});

test('active Operations Lead is the only added position; unrelated admin/mentor, revoked, inactive and readonly stay excluded',async()=>{
 await migrate();
 for(const n of [1,6,12,22,23,24]){await as(n);await expect(db.query("select team_attendance_check_in($1,'123456')",[mid])).rejects.toThrow(/Active Attendance participant required/);}
 await db.exec('reset role');
 const expected=[2,3,4,5,7,8,11,20,21];
 expect((await db.query<any>('select id from profiles where team_attendance_private.is_participant(id) order by id')).rows.map(r=>r.id)).toEqual(expected.map(id));
 await db.exec("update team_positions set active=false where key='operations_lead'");
 for(const n of [20,21]){await as(n);expect((await context()).can_participate).toBe(false);expect((await context()).can_manage_meetings).toBe(true);}
 await db.exec("reset role;update team_positions set active=true,name='Renamed position' where key='operations_lead'");
 await as(20);expect((await context()).can_participate).toBe(true);
});

for(const n of [20,21])test(`Operations Lead ${n} joins only the selected active meeting and checks self in and out, preserving management and all other records`,async()=>{
 const tomorrow=await create();await ongoing();const before=await fingerprint();await migrate();expect(await fingerprint()).toEqual(before);
 await as(n);await expect(db.query("select team_attendance_check_in($1,'123456')",[mid])).rejects.toThrow(/not on this meeting roster/);
 await as(1);expect(await scoped(n,[mid])).toMatchObject({added:1,promoted:0,skipped:0});
 expect((await db.query('select 1 from team_meeting_members where meeting_id=$1 and student_id=$2',[tomorrow,id(n)])).rows).toHaveLength(0);
 expect((await db.query('select 1 from team_attendance_members where student_id=$1',[id(n)])).rows).toHaveLength(0);
 const other=(await db.query<any>('select * from team_attendance where student_id<>$1 order by id',[id(n)])).rows;
 await as(n);await db.query("select team_attendance_check_in($1,'123456')",[mid]);const checked=await row(n);
 expect(checked).toMatchObject({physical_status:'late',review_status:'none',version:2});expect(checked.checked_in_at).not.toBeNull();
 await db.query("select team_attendance_check_in($1,'123456')",[mid]);expect(await row(n)).toEqual(checked);
 await db.query('select team_attendance_check_out($1)',[mid]);expect(await row(n)).toMatchObject({physical_status:'left_early',checked_in_at:checked.checked_in_at});
 expect(await context()).toMatchObject({can_manage_meetings:true,can_read_team:true,can_review_requests:false});
 await as(1);expect((await db.query<any>('select * from team_attendance where student_id<>$1 order by id',[id(n)])).rows).toEqual(other);
 expect((await db.query<any>("select performed_by from team_attendance_history where student_id=$1 and action='ROSTER_SYNC_ADD'",[id(n)])).rows).toEqual([{performed_by:id(1)}]);
 expect((await db.query('select 1 from team_attendance_strikes where student_id=$1',[id(n)])).rows).toHaveLength(0);
});

test('revoking the Operations Lead position immediately removes self-service but preserves admin management',async()=>{
 await ongoing();await migrate();await as(1);await scoped(20,[mid]);await as(20);await db.query("select team_attendance_check_in($1,'123456')",[mid]);
 await db.exec('reset role');await db.query('update team_member_positions set revoked_at=now() where user_id=$1',[id(20)]);
 await as(20);expect(await context()).toMatchObject({can_participate:false,can_manage_meetings:true});
 await expect(db.query('select team_attendance_check_out($1)',[mid])).rejects.toThrow(/Active Attendance participant required/);
});

test('Operations Lead requests cannot be self-reviewed and gain no request-review permission',async()=>{
 await migrate();await as(1);await scoped(20,[mid]);await request(20);const a=await row(20);
 await expect(manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,review_status:'excused',explanation:'Self review denied'})).rejects.toThrow();
 expect((await row(20)).review_status).toBe('pending');expect((await context()).can_review_requests).toBe(false);
});

test('arbitrary-identity predicate remains inaccessible to authenticated and anonymous callers',async()=>{
 await migrate();for(const role of ['authenticated','anon']){await db.exec(`reset role;set role ${role}`);await expect(db.query('select team_attendance_private.is_participant(null)')).rejects.toThrow(/permission denied/);}
});
