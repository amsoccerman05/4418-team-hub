// Runs only inside fabrication-local.mjs's OWNED disposable Supabase stack.
// Uses real signup/login sessions and raw PostgREST, never hosted data or fake JWTs.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {localFetch,localURL,ORIGIN,API_PORT} from './fabrication-safety.mjs';
export const attendanceAutomaticRosterSources=[
 'supabase/migrations/20261028001414_attendance_automatic_roster_membership.sql',
 'tests/integration/attendance-automatic-roster-stack.spec.mjs',
];
const lit=v=>`'${String(v).replaceAll("'","''")}'`;
const future=minutes=>new Date(Date.now()+minutes*60000).toISOString();
export async function runAttendanceAutomaticRosterIntegration({base,anonKey,sql,registerSecret,gate,waitFor}){
 assert.equal(localURL(base).origin,`http://127.0.0.1:${API_PORT}`,'Only the owned disposable stack is supported');
 assert(!sql("select pg_get_functiondef('auth.uid()'::regprocedure)").includes('test.uid'),'Real Supabase Auth required');
 assert.equal(sql("select is_nullable from information_schema.columns where table_schema='public' and table_name='team_attendance_history' and column_name='performed_by'"),'NO');
 const checks=[],pass=label=>{const message=`Automatic roster: ${label}`;checks.push(message);console.log(`PASS ${message}`);};
 const headers=actor=>({apikey:anonKey,Origin:ORIGIN,...(actor?{Authorization:`Bearer ${actor.token}`}:{})});
 const request=(path,body,actor=null,method='POST')=>localFetch(base,path,{method,headers:{...headers(actor),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const rpc=(name,body,actor)=>request(`/rest/v1/rpc/${name}`,body,actor);
 async function json(response){const body=await response.json();assert.equal(response.status,200,`Automatic roster HTTP ${response.status}; code=${body?.code||'unspecified'}; message=${body?.message||'unspecified'}`);return body;}
 const read=(table,columns,filter,actor)=>request(`/rest/v1/${table}?select=${columns}&${filter}`,undefined,actor,'GET').then(json);
 const sync=actor=>rpc('team_attendance_sync_my_rosters',{},actor).then(json);
 const query=q=>JSON.parse(sql(q));
 const fingerprint=()=>sql(`select jsonb_build_object('meetings',(select jsonb_agg(to_jsonb(t) order by id) from public.team_meetings t),'members',(select jsonb_agg(to_jsonb(t) order by meeting_id,student_id) from public.team_meeting_members t),'attendance',(select jsonb_agg(to_jsonb(t) order by id) from public.team_attendance t),'strikes',(select jsonb_agg(to_jsonb(t) order by id) from public.team_attendance_strikes t),'history',(select jsonb_agg(to_jsonb(t) order by id) from public.team_attendance_history t))`);
 async function signup(name,role='student',active=true){
  const email=`auto-roster-${name}-${randomUUID()}@example.invalid`,password=`Synthetic-${randomBytes(24).toString('hex')}!`;registerSecret(password);
  const created=await json(await request('/auth/v1/signup',{email,password,data:{role:'admin',active:true,member_status:'registered'}}));
  assert(created.user?.id&&created.access_token);registerSecret(created.access_token);if(created.refresh_token)registerSecret(created.refresh_token);
  const login=await json(await request('/auth/v1/token?grant_type=password',{email,password}));assert.equal(login.user.id,created.user.id);
  registerSecret(login.access_token);if(login.refresh_token)registerSecret(login.refresh_token);
  const actor={id:login.user.id,token:login.access_token};
  sql(`insert into public.profiles(id,display_name,role,active) values(${lit(actor.id)},${lit(`Synthetic Automatic Roster ${name}`)},${lit(role)},${active});`);
  return actor;
 }
 const manager=await signup('manager','mentor'),existing=await signup('existing');
 const manage=(action,p)=>rpc('team_attendance_manage',{action,p},manager).then(json);
 const mutate=q=>sql(`select set_config('request.jwt.claim.sub',${lit(manager.id)},false);${q}`);
 const create=async(title,requirement='active',start=60,end=180)=>(await manage('create',{title:`Synthetic automatic roster ${title}`,meeting_type:'preseason',requirement,selected_students:requirement==='selected'?[existing.id]:[],starts_at:future(start),ends_at:future(end)})).id;
 const current=await create('current selected','selected',-10,120),upcoming=await create('future active'),custom=await create('future selected','selected'),registered=await create('future registered','registered');
 const closed=await create('closed','active',-10,120);await manage('close',{meeting_id:closed,version:Number(sql(`select version from public.team_meetings where id=${lit(closed)}`))});
 const ended=await create('ended','active',-120,-60);
 const student=await signup('new'),peer=await signup('peer'),inactive=await signup('inactive','student',false),reader=await signup('readonly','readonly'),pending=await signup('pending');
 // Synthetic server-owned not-yet-accepted state; no fabricated claims or Auth hooks.
 sql(`update auth.users set last_sign_in_at=null where id=${lit(pending.id)};`);
 const beforeInstall=fingerprint(),policyBefore=sql("select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p");
 sql(readFileSync(new URL(`../../${attendanceAutomaticRosterSources[0]}`,import.meta.url),'utf8'));sql("notify pgrst, 'reload schema';");
 assert.equal(fingerprint(),beforeInstall);assert.equal(sql("select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p"),policyBefore);
 await waitFor(async()=>{const r=await rpc('team_attendance_sync_my_rosters',{},manager);if(r.status===404)return false;assert.deepEqual(await json(r),{added:0});return true;},'automatic roster RPC schema reload');
 pass('additive migration changes no existing business data or RLS and real nonparticipant mentor stays a no-op');
 for(const actor of [student,peer])assert.deepEqual(await read('team_meetings','id',`id=eq.${current}`,actor),[]);
 const deniedBefore=fingerprint();
 for(const actor of [inactive,reader,pending])assert.deepEqual(await sync(actor),{added:0});
 const anonymous=await rpc('team_attendance_sync_my_rosters',{},null);assert.equal(anonymous.status,401);assert.equal((await anonymous.json()).code,'42501');
 const forgedTarget=await rpc('team_attendance_sync_my_rosters',{target_id:peer.id},student);assert.equal(forgedTarget.status,404);
 const privateCall=await rpc('sync_missing_rosters',{target_id:peer.id},student);assert.equal(privateCall.status,404);
 assert.equal(fingerprint(),deniedBefore);pass('anonymous, target-spoofing, private-helper, pending, inactive, and readonly paths cannot enroll others or create obligations');
 const expected=Number(sql(`select count(*) from public.team_meetings m where m.ends_at>clock_timestamp() and m.status in ('draft','open') and not exists(select 1 from public.team_meeting_members mm where mm.meeting_id=m.id and mm.student_id=${lit(student.id)})`));
 assert(expected>=4);
 const [first,second]=await Promise.all([sync(student),sync(student)]);assert.equal(first.added+second.added,expected);assert([first.added,second.added].includes(0));
 assert.deepEqual(await read('team_meeting_members','student_id,required',`meeting_id=eq.${current}`,student),[{student_id:student.id,required:false}]);
 assert.equal((await read('team_meetings','id',`id=eq.${current}`,student)).length,1);
 assert.deepEqual(await read('team_meetings','id',`id=eq.${current}`,peer),[]);
 assert.equal(sql(`select required from public.team_meeting_members where meeting_id=${lit(upcoming)} and student_id=${lit(student.id)}`),'t');
 for(const id of [current,custom,registered])assert.equal(sql(`select required from public.team_meeting_members where meeting_id=${lit(id)} and student_id=${lit(student.id)}`),'f');
 for(const id of [closed,ended])assert.deepEqual(await read('team_meetings','id',`id=eq.${id}`,student),[]);
 const own=await read('team_attendance','student_id,physical_status,review_status,checked_in_at,left_at',`meeting_id=eq.${current}`,student);
 assert.deepEqual(own,[{student_id:student.id,physical_status:'pending',review_status:'not_required',checked_in_at:null,left_at:null}]);
 assert.equal(sql(`select count(*) from public.team_attendance_strikes where student_id=${lit(student.id)}`),'0');
 const audit=query(`select jsonb_agg(jsonb_build_object('student_id',student_id,'performed_by',performed_by) order by id) from public.team_attendance_history where action='ROSTER_AUTO_ADD' and student_id=${lit(student.id)}`);
 assert.equal(audit.length,expected);assert(audit.every(row=>row.student_id===student.id&&row.performed_by===student.id));
 const after=fingerprint();assert.deepEqual(await sync(student),{added:0});assert.equal(fingerprint(),after);
 pass('concurrent real-session sync is idempotent, self-only, actor-audited; current/custom rosters stay optional, future active is required, no check-in or strike is created');
 // Hold the existing global Attendance lock before enqueueing another real HTTP
 // call, then end a missing target meeting. It must not use a stale time boundary.
 const boundary=await create('ending during lock wait','selected',-10,20),late=await signup('late');
 const release=await gate('4418,10');let waiting;
 try{
  waiting=sync(late);
  await waitFor(()=>sql("select exists(select 1 from pg_stat_activity where wait_event='advisory' and query like '%team_attendance_sync_my_rosters%')")==='t','self-sync waiting for authoritative lock');
  mutate(`update public.team_meetings set ends_at=clock_timestamp()-interval '1 second' where id=${lit(boundary)};`);
 }finally{await release();}
 await waiting;
 assert.equal(sql(`select count(*) from public.team_meeting_members where meeting_id=${lit(boundary)} and student_id=${lit(late.id)}`),'0');
 pass('real HTTP lock wait rechecks scheduled end and cannot backfill ended history');
 return checks;
}
