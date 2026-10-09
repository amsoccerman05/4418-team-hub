import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const migration='supabase/migrations/20261009155227_attendance_automatic_absence_strikes.sql';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let db:PGlite; let mid:string; let migrated=false;
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);}
async function manage(action:string,p:any){return (await db.query<any>('select team_attendance_manage($1,$2::jsonb) r',[action,JSON.stringify(p)])).rows[0].r;}
async function row(n=30){return (await db.query<any>('select * from team_attendance where meeting_id=$1 and student_id=$2',[mid,id(n)])).rows[0];}
async function meeting(){return (await db.query<any>('select id,title,starts_at,ends_at,status,version'+(migrated?',auto_absence_strikes_enabled':'')+' from team_meetings where id=$1',[mid])).rows[0];}
async function create(selected=[30],extra:any={}){await as(1);mid=(await manage('create',{title:'Synthetic automatic strike meeting',meeting_type:'preseason',requirement:'selected',selected_students:selected.map(id),starts_at:new Date(Date.now()-3*3600000).toISOString(),ends_at:new Date(Date.now()-3600000).toISOString(),...extra})).id;return mid;}
async function correction(n:number,p:any){await as(2);const a=await row(n);return manage('attendance',{meeting_id:mid,attendance_id:a.id,version:a.version,explanation:'Synthetic reviewed correction',...p});}
async function close(){await as(1);const m=await meeting();await manage('close',{meeting_id:mid,version:m.version});}
async function candidateIDs(){await as(1);return (await db.query<any>(`select a.id from team_attendance a join team_meeting_members mm using(meeting_id,student_id) where a.meeting_id=$1 and mm.required and a.physical_status in ('pending','absent') and a.review_status in ('none','denied') and not exists(select 1 from team_attendance_strikes s where s.attendance_id=a.id and (s.source='automatic_absence' or lower(trim(s.category))='unexcused absence')) order by a.id`,[mid])).rows.map(a=>a.id);}
async function finalize(count:number){await as(1);const m=await meeting();return manage('finalize',{meeting_id:mid,version:m.version,automatic_absence_strike_count:count,automatic_absence_strike_attendance_ids:await candidateIDs()});}
async function strikes(n?:number){await as(1);return (await db.query<any>('select * from team_attendance_strikes where meeting_id=$1'+(n?' and student_id=$2':'')+' order by assigned_at,id',n?[mid,id(n)]:[mid])).rows;}
async function addStrike(n=30,category='Unexcused Absence'){await as(1);const a=await row(n);return manage('strike',{meeting_id:mid,attendance_id:a.id,category,quantity:1,explanation:'Synthetic manual decision'});}
async function fingerprint(){await db.exec('reset role');return (await db.query<any>(`select jsonb_build_object(
 'meetings',(select jsonb_agg(to_jsonb(t)-'auto_absence_strikes_enabled' order by id) from team_meetings t),
 'snapshots',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from team_meeting_members t),
 'attendance',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance t),
 'strikes',(select jsonb_agg(to_jsonb(t)-'source' order by id) from team_attendance_strikes t),
 'history',(select jsonb_agg(to_jsonb(t) order by id) from team_attendance_history t)) s`)).rows[0].s;}
async function migrate(){await db.exec('reset role');await db.exec(readFileSync(migration,'utf8'));migrated=true;}
test.beforeEach(async()=>{
 migrated=false;
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key,display_name text,role text,active boolean);
    insert into profiles values
      ('${id(1)}','Ordinary mentor','mentor',true),('${id(2)}','Coach One','mentor',true),
      ('${id(3)}','Student','student',true),('${id(4)}','Coach Two','mentor',true),
      ('${id(5)}','Program Manager','mentor',true),('${id(6)}','Peer PM','mentor',true),
      ('${id(7)}','Admin','admin',true),('${id(8)}','Lead','lead',true),
      ('${id(9)}','Inactive coach','mentor',false),('${id(10)}','Revoked coach','mentor',true),
      ('${id(11)}','Readonly coach','readonly',true),('${id(12)}','Admin coach','admin',true),
      ('${id(13)}','Lead coach','lead',true),('${id(14)}','Student coach','student',true),
      ('${id(15)}','Dual coach PM','mentor',true),('${id(16)}','Student PM','student',true),
      ('${id(17)}','Lead PM','lead',true),('${id(18)}','Admin PM','admin',true),
      ('${id(19)}','Inactive PM','mentor',false),('${id(20)}','Revoked PM','mentor',true),
      ('${id(21)}','Readonly PM','readonly',true),('${id(22)}','Lead Coach 1','mentor',true);
    create table team_positions(key text primary key,name text,active boolean);
    insert into team_positions values ('program_manager','Program Manager',true),
      ('lead_coach_1','Lead Coach 1',true),('lead_coach_2','Lead Coach 2',true);
    create table team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
    insert into team_member_positions values
      ('${id(2)}','lead_coach_1',null),('${id(4)}','lead_coach_2',null),
      ('${id(9)}','lead_coach_1',null),('${id(10)}','lead_coach_2',now()),
      ('${id(11)}','lead_coach_1',null),('${id(12)}','lead_coach_1',null),
      ('${id(13)}','lead_coach_1',null),('${id(14)}','lead_coach_1',null),
      ('${id(15)}','lead_coach_1',null),
      ${[5,6,15,16,17,18,19,21].map(n => `('${id(n)}','program_manager',null)`).join(',')},
      ('${id(20)}','program_manager',now());
    create function public.team_has_position(key text) returns boolean
    language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.team_member_positions mp
      join public.team_positions p on p.key=mp.position_key and p.active
      join public.profiles u on u.id=mp.user_id and u.active and u.role in ('student','lead','mentor','admin')
      where mp.user_id=auth.uid() and mp.position_key=$1 and mp.revoked_at is null)
    $$;
    select set_config('test.uid','${id(1)}',false);`);
  for (const file of ['202609100001_team_attendance.sql', '202609120001_attendance_requests_recurrence.sql', '202609120008_attendance_roster_sync.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(`drop view team_attendance_history;
    alter table team_attendance_private.history set schema public;
    alter table public.history rename to team_attendance_history;
    drop trigger team_history_actor on public.team_attendance_history;
    alter table public.team_attendance_history drop column actor_auth_uid,
      drop column actor_database_session, drop column actor_database_role,
      alter column performed_by set not null;
    grant select on team_attendance_history to authenticated;
    create policy attendance_history_read on team_attendance_history for select to authenticated
      using(team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));`);
  await db.exec(readFileSync('tests/fixtures/attendance-production-functions.sql', 'utf8'));
  for (const file of ['202609300001_attendance_policy_v03.sql', '20261008032037_attendance_program_manager_mentor_review.sql', '20261008051847_attendance_program_manager_participation.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(readFileSync('supabase/migrations/20261008063138_attendance_coach_request_review.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261008234849_attendance_active_meeting_roster_sync.sql', 'utf8'));
  await db.exec(`insert into profiles values ${Array.from({length:12},(_,i)=>`('${id(i+30)}','Synthetic student ${i+30}','student',true)`).join(',')};`);
});
test.afterEach(()=>db.close());

test('additive migration preserves all historic records and later reviews never backfill a previously finalized meeting',async()=>{
 await create();await close();await as(1);await manage('finalize',{meeting_id:mid,version:(await meeting()).version});
 await addStrike(30,'Other');
 const before=await fingerprint();await migrate();expect(await fingerprint()).toEqual(before);
 await as(1);expect((await meeting()).auto_absence_strikes_enabled).toBe(false);
 await correction(30,{review_status:'denied'});expect(await strikes()).toHaveLength(1);
 await correction(30,{review_status:'excused'});await correction(30,{physical_status:'present'});
 await correction(30,{physical_status:'absent',review_status:'none'});expect(await strikes()).toHaveLength(1);
 await as(1);expect((await meeting()).auto_absence_strikes_enabled).toBe(false);
 await expect(finalize(1)).rejects.toThrow(/finalized/);
});

test('finalization creates exactly one strike only for required unexcused absences and records the authenticated actor',async()=>{
 await create([30,31,32,33,34,35,36,37,38]);await migrate();
 await correction(31,{physical_status:'absent',review_status:'denied'});
 await correction(32,{review_status:'pending'});await correction(33,{review_status:'excused'});
 await correction(34,{review_status:'not_required'});await correction(35,{physical_status:'present'});
 await correction(36,{physical_status:'late'});
 const m=await meeting();await correction(37,{physical_status:'left_early',left_at:new Date(Date.parse(m.starts_at)+60000).toISOString()});
 await addStrike(38,'Unexcused Absence');await addStrike(30,'Other');
 await close();expect(await finalize(2)).toEqual({automatic_absence_strikes:2});
 await as(1);expect((await meeting()).auto_absence_strikes_enabled).toBe(true);
 const all=await strikes();expect(all.filter(s=>s.source==='automatic_absence').map(s=>s.student_id).sort()).toEqual([id(30),id(31)]);
 for(const s of all.filter(s=>s.source==='automatic_absence')){
  expect(s).toMatchObject({quantity:1,category:'Unexcused Absence',assigned_by:id(1),rescinded_at:null});
  const audit=(await db.query<any>("select * from team_attendance_history where entity='team_attendance_strikes' and entity_id=$1",[s.id])).rows;
  expect(audit).toHaveLength(1);expect(audit[0]).toMatchObject({performed_by:id(1),action:'INSERT'});
  expect(audit[0].after_data.source).toBe('automatic_absence');
 }
 expect((await row(30)).physical_status).toBe('absent');expect((await row(32)).review_status).toBe('pending');
 expect((await row(39)).physical_status).toBe('pending');
 const state=await fingerprint();await expect(finalize(2)).rejects.toThrow(/finalized/);expect(await fingerprint()).toEqual(state);
});

test('old clients, stale previews and invalid counts fail atomically before attendance completion',async()=>{
 await create();await migrate();await close();const state=await fingerprint();
 for(const p of [{},{automatic_absence_strike_count:0},{automatic_absence_strike_count:2},{automatic_absence_strike_count:'1'},{automatic_absence_strike_count:null},{automatic_absence_strike_count:1.5}]){
  await as(1);await expect(manage('finalize',{meeting_id:mid,version:(await meeting()).version,automatic_absence_strike_attendance_ids:await candidateIDs(),...p})).rejects.toThrow(/preview/);
  expect(await fingerprint()).toEqual(state);
 }
 expect(await finalize(1)).toEqual({automatic_absence_strikes:1});
});

test('pending requests wait for denial, then approval rescinds only the automatic strike and never re-creates a rescinded decision',async()=>{
 await create();await migrate();await correction(30,{review_status:'pending'});await addStrike(30,'Other');await close();
 expect(await finalize(0)).toEqual({automatic_absence_strikes:0});expect(await strikes()).toHaveLength(1);
 expect(await correction(30,{review_status:'denied'})).toEqual({automatic_absence_strikes:1,automatic_absence_strikes_rescinded:0});
 const before=await strikes();const auto=before.find(s=>s.source==='automatic_absence');const manual=before.find(s=>s.source==='manual');
 expect(auto.assigned_by).toBe(id(2));
 expect(await correction(30,{review_status:'excused'})).toEqual({automatic_absence_strikes:0,automatic_absence_strikes_rescinded:1});
 const after=await strikes();expect(after.find(s=>s.source==='manual')).toEqual(manual);
 expect(after.find(s=>s.source==='automatic_absence')).toMatchObject({id:auto.id,rescinded_by:id(2)});
 await correction(30,{review_status:'denied'});expect(await strikes()).toHaveLength(2);expect((await strikes()).find(s=>s.source==='automatic_absence').rescinded_at).not.toBeNull();
});

test('physical correction rescinds only automatic absence strikes; required prospective and optional records retain snapshot semantics',async()=>{
 await create([30,31]);await migrate();await correction(31,{physical_status:'present'});await close();await finalize(1);
 expect(await correction(30,{physical_status:'present'})).toMatchObject({automatic_absence_strikes_rescinded:1});
 expect(await correction(31,{physical_status:'absent'})).toMatchObject({automatic_absence_strikes:1});
 await correction(39,{physical_status:'absent',review_status:'none'});expect(await strikes(39)).toHaveLength(0);
 await as(1);expect((await db.query<any>('select member_status,required from team_meeting_members where meeting_id=$1 and student_id=$2',[mid,id(31)])).rows[0]).toEqual({member_status:'prospective',required:true});
});

test('manual decisions block automatic duplicates, active automatic strikes block manual duplicate absence, and manual rescission remains final',async()=>{
 await create([30,31]);await migrate();await addStrike(30);let s=(await strikes(30))[0];
 await manage('rescind',{meeting_id:mid,attendance_id:s.attendance_id,strike_id:s.id,explanation:'Synthetic waived manual incident'});
 await close();await finalize(1);expect(await strikes(30)).toHaveLength(1);expect((await strikes(30))[0].source).toBe('manual');
 await expect(addStrike(31,' unexcused absence ')).rejects.toThrow(/automatic absence strike already exists/);
 await addStrike(31,'Insufficient Notice');s=(await strikes(31)).find(s=>s.source==='automatic_absence');
 await manage('rescind',{meeting_id:mid,attendance_id:s.attendance_id,strike_id:s.id,explanation:'Synthetic waived automatic incident'});
 await correction(31,{review_status:'none'});expect(await strikes(31)).toHaveLength(2);
 await addStrike(31);expect(await strikes(31)).toHaveLength(3);
});

test('permissions, production audit schema and unrelated helpers remain unchanged',async()=>{
 await create();
 const inspect=async()=>{await db.exec('reset role');return (await db.query<any>(`select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','team_attendance_private','public') and p.proname not in ('team_attendance_manage','reconcile_absence_strike')),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p),
 'audit',(select jsonb_agg(jsonb_build_object('name',column_name,'nullable',is_nullable) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='team_attendance_history')) s`)).rows[0].s;};
 const before=await inspect();await migrate();expect(await inspect()).toEqual(before);await close();
 for(const n of [30,11,9]){await as(n);await expect(manage('finalize',{meeting_id:mid,version:2,automatic_absence_strike_count:1})).rejects.toThrow(/Leadership/);}
 await as(1);await expect(db.query('select team_attendance_private.reconcile_absence_strike($1)',[(await row()).id])).rejects.toThrow(/permission denied/);
 await db.exec('reset role;set role anon');await expect(manage('finalize',{})).rejects.toThrow(/permission denied/);
 await finalize(1);await as(30);expect((await db.query('select * from team_attendance_strikes')).rows).toHaveLength(1);
 await as(31);expect((await db.query('select * from team_attendance_strikes')).rows).toHaveLength(0);
 await as(30);await expect(db.query("update team_attendance_strikes set source='manual'")).rejects.toThrow(/permission denied/);
});

test('strike or audit failure rolls back the entire finalization and pending-to-absence conversion',async()=>{
 await create();await migrate();await close();const before=await fingerprint();
 await db.exec(`create function public.fail_auto_audit() returns trigger language plpgsql as $$begin if new.entity='team_attendance_strikes' then raise exception 'Synthetic unavailable audit';end if;return new;end$$;
 create trigger fail_auto_audit before insert on public.team_attendance_history for each row execute function public.fail_auto_audit();`);
 await expect(finalize(1)).rejects.toThrow(/Synthetic unavailable audit/);expect(await fingerprint()).toEqual(before);
 await as(1);expect((await meeting()).auto_absence_strikes_enabled).toBe(false);
});

test('named preview rejects a stale same-count replacement and malformed or duplicate candidate IDs',async()=>{
 await create([30,31]);await migrate();await correction(31,{physical_status:'present'});await close();
 const stale=await candidateIDs();await correction(30,{physical_status:'present'});await correction(31,{physical_status:'absent'});
 for(const ids of [stale,null,{},[],[null],[...(await candidateIDs()),...(await candidateIDs())]]){
  const before=await fingerprint();await as(1);await expect(manage('finalize',{meeting_id:mid,version:(await meeting()).version,automatic_absence_strike_count:1,automatic_absence_strike_attendance_ids:ids})).rejects.toThrow(/preview/);expect(await fingerprint()).toEqual(before);
 }
 expect(await finalize(1)).toEqual({automatic_absence_strikes:1});expect((await strikes())[0].student_id).toBe(id(31));
});
