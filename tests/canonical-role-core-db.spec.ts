import {test,expect} from '@playwright/test';
import {canonicalBaseline,syntheticCanonicalMigration,canonicalPins,fixtureId as id} from './fixtures/canonical-role-core';
import type {PGlite} from '@electric-sql/pglite';
test.describe.configure({mode:'serial'});
let db:PGlite;
const as=async(n:number)=>db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);
const role=async(n:number,r:string)=>db.exec(`reset role;update profiles set role='${r}' where id='${id(n)}'`);
const reserve=async(n:number,r='student')=>db.query<any>('select team_invitation_reserve($1) r',[JSON.stringify({id:id(n),email:`canonical${n}@example.test`,display_name:'Synthetic invitation',role:r,reason:'Synthetic canonical role test',area_id:'',member_status:''})]);
const policy=async()=>(await db.query<any>('select team_attendance_policy_context() p')).rows[0].p;
test.beforeAll(async()=>{db=await canonicalBaseline();});test.afterAll(()=>db?.close());
test('exact sole account transition preserves unrelated records, assignments and every existing ACL/mode',async()=>{
 const before=(await db.query<any>(`select (select jsonb_agg(to_jsonb(p)-'updated_at' order by id) from profiles p) profiles,(select jsonb_agg(to_jsonb(p) order by id) from team_member_positions p) positions`)).rows[0];
 const a=(await db.query(`select n.nspname,p.proname,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace order by 1,2,p.oid`)).rows;
 await db.exec(await syntheticCanonicalMigration(db));
 const after=(await db.query<any>(`select (select jsonb_agg(to_jsonb(p)-'updated_at' order by id) from profiles p) profiles,(select jsonb_agg(to_jsonb(p) order by id) from team_member_positions p) positions`)).rows[0];
 expect(after).toEqual({...before,profiles:before.profiles.map((p:any)=>p.id===id(7)?{...p,role:'admin_lead'}:p)});
 expect((await db.query(`select n.nspname,p.proname,p.proacl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace order by 1,2,p.oid`)).rows).toEqual(a);
 for(const pin of canonicalPins){const name=pin.schema==='public'?`public.${pin.signature}`:pin.signature;expect((await db.query<any>('select md5(pg_get_functiondef($1::regprocedure)) d',[name])).rows[0].d).toBe(pin.expected_definition_md5);}
 await expect(db.exec(`update profiles set role='admin' where id='${id(7)}'`)).rejects.toThrow(/profiles_role_check/);
});
test('Mentor alone administers the suite; converted Admin Lead retains only ordinary operations and Student invitations',async()=>{
 await as(1);expect((await db.query<any>('select team_private.admin() a')).rows[0].a).toBe(true);expect((await db.query<any>('select team_dashboard_context() c')).rows[0].c.admin).toBe(true);await db.query('select team_management_context_v2()');
 await as(7);expect((await db.query<any>('select team_private.admin() a')).rows[0].a).toBe(false);expect((await db.query<any>('select team_dashboard_context() c')).rows[0].c.admin).toBe(false);await expect(db.query('select team_management_context_v2()')).rejects.toThrow(/Mentor/);await db.query('select team_operations_context()');
 expect((await reserve(901)).rows[0].r.send).toBe(true);for(const r of ['mentor','lead','admin_lead','readonly','admin'])await expect(reserve(902,r)).rejects.toThrow(/students only/);
 await as(1);await expect(reserve(903,'admin')).rejects.toThrow(/retired/);expect((await reserve(904,'admin_lead')).rows[0].r.send).toBe(true);
});
test('generic Mentor and generic Admin Lead cannot review issues; assigned Mentor Coach and eligible PM can',async()=>{
 for(const n of [1,7,8]){await as(n);expect((await policy()).can_review).toBe(false);expect((await policy()).can_review_requests).toBe(false);await expect(db.query("select team_attendance_policy_action('warning_parent_contact',$1)",[JSON.stringify({student_id:id(2),note:'Test'})])).rejects.toThrow(/Assigned Lead Coach/);}
 for(const n of [1,7]){await as(n);const payload={meeting_id:id(201),attendance_id:id(213),version:1,explanation:'Generic role cannot decide',category:'Other',quantity:1};
  for(const [action,extra] of [['attendance',{review_status:'excused'}],['strike',{}],['rescind',{strike_id:id(999)}]] as const)await expect(db.query('select team_attendance_manage($1,$2)',[action,JSON.stringify({...payload,...extra})])).rejects.toThrow(/Lead Coach|Program Manager/);
  // Physical corrections remain ordinary meeting management, not issue approval.
  const version=(await db.query<any>('select version from team_attendance where id=$1',[id(211)])).rows[0].version;await db.query("select team_attendance_manage('attendance',$1)",[JSON.stringify({meeting_id:id(201),attendance_id:id(211),version,physical_status:'late',explanation:'Physical correction only'})]);
 }
 await db.exec(`reset role;insert into team_member_positions(user_id,position_key,assigned_by,assignment_reason) values('${id(1)}','lead_coach_1','${id(8)}','Synthetic'),('${id(7)}','program_manager','${id(8)}','Synthetic'),('${id(5)}','program_manager','${id(8)}','Synthetic')`);
 for(const n of [1,7]){await as(n);expect((await policy()).can_review).toBe(true);expect((await policy()).can_review_requests).toBe(true);}
 await as(5);expect((await policy()).can_review).toBe(false);expect((await policy()).can_review_requests).toBe(false);
 await db.exec('reset role');expect((await db.query<any>('select team_attendance_private.can_review_request($1,$2) a',[id(1),id(1)])).rows[0].a).toBe(false);
});
test('Readonly, inactive and revoked assignments deny current reviewer authority without changing history',async()=>{
 await db.exec(`reset role;update team_member_positions set revoked_at=now(),revoked_by='${id(8)}',revoke_reason='Synthetic' where user_id='${id(7)}'`);await as(7);expect((await policy()).can_review).toBe(false);
 await role(1,'readonly');await as(1);await expect(db.query('select team_attendance_policy_context()')).rejects.toThrow();await role(1,'mentor');
 await db.exec(`reset role;update profiles set active=false where id='${id(1)}'`);await as(1);await expect(db.query('select team_attendance_policy_context()')).rejects.toThrow();await db.exec(`reset role;update profiles set active=true where id='${id(1)}'`);
});
test('last active Mentor cannot be deactivated or demoted even with an active Admin Lead',async()=>{
 await db.exec(`reset role;update profiles set active=false where role='mentor' and id<>'${id(1)}'`);
 await expect(db.exec(`update profiles set role='admin_lead' where id='${id(1)}'`)).rejects.toThrow(/at least one active Mentor/);
 await expect(db.exec(`update profiles set active=false where id='${id(1)}'`)).rejects.toThrow(/at least one active Mentor/);
});

test('legacy provisioned invitation reports immutable status, while unprovisioned retired role stays held',async()=>{
 await db.exec(`reset role;insert into team_private.invitations(id,email,display_name,role,actor_id,reason,status,user_id) values('${id(912)}','canonical912@example.test','Synthetic invitation','admin','${id(1)}','Synthetic canonical role test','pending','${id(7)}'),('${id(913)}','canonical913@example.test','Synthetic invitation','admin','${id(1)}','Synthetic canonical role test','review',null)`);
 const history=(await db.query('select * from team_private.invitations where id=any($1::uuid[]) order by id',[[id(912),id(913)]])).rows;
 await as(1);expect((await reserve(912,'admin')).rows[0].r).toMatchObject({send:false,status:'pending'});await expect(reserve(913,'admin')).rejects.toThrow(/requires Mentor review; do not resend/);
 await db.exec('reset role;set role service_role');await db.query('select team_invitation_finish($1,$2)',[id(912),id(7)]);await expect(db.query('select team_invitation_finish($1,$2)',[id(913),id(2)])).rejects.toThrow(/Retired Admin/);
 await db.exec('reset role');expect((await db.query('select * from team_private.invitations where id=any($1::uuid[]) order by id',[[id(912),id(913)]])).rows).toEqual(history);expect((await db.query<any>('select role from profiles where id=$1',[id(7)])).rows[0].role).toBe('admin_lead');
 await as(1);await expect(db.query('select team_invitation_reserve($1)',[JSON.stringify({id:id(914),email:'canonical913@example.test',display_name:'Synthetic invitation',role:'admin_lead',reason:'New request',area_id:'',member_status:''})])).rejects.toThrow(/unique/);
});

test('new canonical invitation completion rechecks the inviter and preserves quarantine and provisioned replay',async()=>{
 await db.exec(`reset role;update profiles set active=true where id='${id(8)}'`);await as(8);await reserve(915,'admin_lead');
 await db.exec(`reset role;insert into auth.users(id,email,invited_at,raw_user_meta_data) values('${id(615)}','canonical915@example.test',clock_timestamp(),'{"team_invitation_id":"${id(915)}"}');insert into profiles(id,display_name,role,active) values('${id(615)}','Synthetic quarantined','readonly',true);update profiles set role='admin_lead' where id='${id(8)}';set role service_role`);
 await expect(db.query('select team_invitation_finish($1,$2)',[id(915),id(615)])).rejects.toThrow(/no longer authorized/);
 await db.exec('reset role');expect((await db.query<any>('select role,active from profiles where id=$1',[id(615)])).rows[0]).toEqual({role:'readonly',active:false});
 await db.exec(`update profiles set role='mentor' where id='${id(8)}';set role service_role`);await db.query('select team_invitation_finish($1,$2)',[id(915),id(615)]);
 await db.exec(`reset role;update profiles set active=false where id='${id(8)}';set role service_role`);await db.query('select team_invitation_finish($1,$2)',[id(915),id(615)]);await db.exec('reset role');expect((await db.query<any>('select role,active from profiles where id=$1',[id(615)])).rows[0]).toEqual({role:'admin_lead',active:true});
});

for(const defect of ['version','count','no-mentor','function','acl'])test(`canonical migration rejects ${defect} drift atomically`,async()=>{
 const other=await canonicalBaseline();try{const sql=await syntheticCanonicalMigration(other);
  if(defect==='version')await other.exec(`update profiles set display_name='Concurrent name' where id='${id(7)}'`);
  if(defect==='count')await other.exec(`insert into profiles(id,display_name,role,active) values('${id(999)}','Unexpected legacy','admin',true)`);
  if(defect==='no-mentor')await other.exec("update profiles set active=false where role='mentor'");
  if(defect==='function')await other.exec("create or replace function team_private.admin() returns boolean language sql stable security definer set search_path='' as $$select false$$");
  if(defect==='acl')await other.exec('grant execute on function team_private.admin() to anon');
  const snap=async()=>JSON.stringify((await other.query(`select (select jsonb_agg(to_jsonb(p) order by id) from profiles p) p,(select jsonb_agg(to_jsonb(p) order by id) from team_member_positions p) a,(select pg_get_constraintdef(oid) from pg_constraint where conname='profiles_role_check') c,(select jsonb_agg(jsonb_build_object('oid',oid,'def',pg_get_functiondef(oid),'acl',proacl) order by oid) from pg_proc where pronamespace in ('team_private'::regnamespace,'public'::regnamespace,'private'::regnamespace)) f`)).rows);
  const before=await snap();await expect(other.exec(sql)).rejects.toThrow(/drift|exactly one|version changed|active Mentor/);await other.exec('rollback');expect(await snap()).toBe(before);
 }finally{await other.close();}
});
