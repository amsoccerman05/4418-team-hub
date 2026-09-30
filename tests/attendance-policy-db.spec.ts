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
 await as(1);mid=(await manage('create',{title:'Policy meeting',meeting_type:'preseason',requirement:'active',late_minutes:10,starts_at:new Date(Date.now()+48*3600000).toISOString(),ends_at:new Date(Date.now()+50*3600000).toISOString()})).id;
});
test.afterEach(()=>db.close());
test('lead own absence/late/early requests enforce identity; self review and unrelated lead review denied',async()=>{
 for(const kind of ['absent','late','early']){await request(2,kind);expect((await row(2)).notice_type).toBe(kind);}
 await as(1);expect((await row(5)).notice_at).toBeNull();
 await as(2);const a=await row(2);
 await expect(manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,review_status:'excused',explanation:'Own'})).rejects.toThrow(/Another Mentor/);
 await manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,physical_status:'present',explanation:'Verified arrival correction'});
 expect((await row(2)).review_status).toBe('pending');expect((await row(2)).reviewed_by).toBeNull();
 expect((await db.query<any>("select after_data from team_attendance_history where entity_id=$1 and action='CORRECTION_NOTE'",[a.id])).rows[0].after_data.explanation).toBe('Verified arrival correction');
 await request(3);await as(2);const other=await row();
 await expect(manage('attendance',{meeting_id:mid,attendance_id:other.id,version:other.version,review_status:'excused',explanation:'Unrelated lead'})).rejects.toThrow(/Another Mentor/);
});
test('mentor and active Program Manager review; Program Manager cannot self-review or gain meeting management',async()=>{
 await request(3);await as(4);let a=await row();await manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,review_status:'excused',left_at:a.left_at,explanation:'Reviewed confirmation'});
 expect((await row()).reviewed_by).toBe(id(4));
 expect((await db.query<any>('select team_attendance_private.manager() m')).rows[0].m).toBe(false);
 await expect(manage('create',{})).rejects.toThrow(/Leadership/);
 await request(4);a=await row(4);await expect(manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,review_status:'excused',explanation:'Own'})).rejects.toThrow(/Another Mentor/);
 await as(1);await manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,review_status:'excused',explanation:'Mentor reviewed'});
 expect((await row(4)).reviewed_by).toBe(id(1));
});
test('strike authority rechecks position revocation/archive/inactive; keeps audit and student privacy',async()=>{
 await as(1);const a=await row();const p={meeting_id:mid,attendance_id:a.id,category:'Unexcused Absence',quantity:1,explanation:'Verified'};
 for(const n of [2,3,6]){await as(n);await expect(manage('strike',p)).rejects.toThrow();}
 for(const n of [1,4]){await as(n);await manage('strike',p);}
 let strikes=(await db.query<any>('select * from team_attendance_strikes')).rows;expect(strikes).toHaveLength(2);
 await manage('rescind',{...p,strike_id:strikes[0].id,explanation:'Corrected'});expect((await db.query<any>('select count(*)::int n from team_attendance_strikes')).rows[0].n).toBe(2);
 await db.exec("reset role;update team_member_positions set revoked_at=now() where position_key='program_manager'");await as(4);await expect(manage('strike',p)).rejects.toThrow();
 await db.exec("reset role;update team_member_positions set revoked_at=null;update team_positions set active=false where key='program_manager'");await as(4);await expect(manage('strike',p)).rejects.toThrow();
 await db.exec(`reset role;update team_positions set active=true;update profiles set active=false where id='${id(4)}'`);await as(4);await expect(manage('strike',p)).rejects.toThrow();
 await as(5);expect((await db.query('select * from team_attendance_strikes')).rows).toHaveLength(0);
 expect((await db.query<any>('select team_attendance_policy_context() c')).rows[0].c.people).toEqual([]);
});
test('five-minute authoritative grace overrides old meeting setting; future close rejected',async()=>{
 await as(1);expect((await db.query<any>('select late_minutes from team_meetings where id=$1',[mid])).rows[0].late_minutes).toBe(5);
 await expect(manage('close',{meeting_id:mid,version:1})).rejects.toThrow(/window/);
 for(const [n,seconds,status] of [[3,299,'present'],[5,301,'late']] as const){
  await db.exec('reset role');await db.query("update team_meetings set starts_at=clock_timestamp()-($2||' seconds')::interval,ends_at=clock_timestamp()+interval '1 hour',late_minutes=10,status='open',check_in_open=true,code_expires_at=clock_timestamp()+interval '30 minutes',code_hash=sha256(convert_to(id::text||'123456','UTF8')) where id=$1",[mid,String(seconds)]);
  await as(n);await db.query("select team_attendance_check_in($1,'123456')",[mid]);expect((await row(n)).physical_status).toBe(status);expect((await row(n)).checked_in_at).not.toBeNull();
 }
});
test('January 1 reset and completed warning actions retain strike audit without inventing completion',async()=>{
 await as(1);const a=await row();await manage('strike',{meeting_id:mid,attendance_id:a.id,category:'Other',quantity:2,explanation:'Verified'});
 let c=(await db.query<any>('select team_attendance_policy_context() c')).rows[0].c;expect(c.warnings).toEqual([]);expect(new Date(c.strike_year_start).toISOString()).toBe(new Date(Date.UTC(new Date().getUTCFullYear(),0,1)).toISOString());
 await db.query("select team_attendance_policy_action('warning_parent_contact',$1::jsonb)",[JSON.stringify({student_id:id(3),note:'Verbal warning and parent contact completed'})]);

 c=(await db.query<any>('select team_attendance_policy_context() c')).rows[0].c;expect(c.warnings[0].actor).toBe(id(1));expect(c.strike_year_start).not.toBeNull();
 expect((await db.query('select * from team_attendance_strikes')).rows).toHaveLength(1);
});
