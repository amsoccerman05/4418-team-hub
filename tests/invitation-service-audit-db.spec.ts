import {test,expect} from '@playwright/test';
import type {PGlite} from '@electric-sql/pglite';
import {canonicalBaseline,syntheticCanonicalMigration,fixtureId as id} from './fixtures/canonical-role-core';

test.describe.configure({mode:'serial'});
let db:PGlite;
// Exact live Supabase auth.uid() body (catalog verified 2026-10-30). This suite
// intentionally does NOT use test.uid: service JWTs have no end-user subject.
const actualUid=`create or replace function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$`;
const lit=(v:string)=>`'${v.replaceAll("'","''")}'`;
const serviceClaims=JSON.stringify({role:'service_role',scope:'unchanged service claims'});
async function request(subject:string,claims=serviceClaims,role='service_role'){
 await db.exec(`reset role;select set_config('request.jwt.claim.sub',${lit(subject)},false);select set_config('request.jwt.claims',${lit(claims)},false);set role ${role}`);
}
async function identity(){return (await db.query<any>(`select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid uid,current_setting('request.jwt.claim.sub',true) subject,current_setting('request.jwt.claims',true) claims`)).rows[0];}
async function seed(n:number,actor=1){
 await request(id(actor),'{}','authenticated');
 await db.query('select team_invitation_reserve($1)',[JSON.stringify({id:id(n),email:`audit${n}@example.test`,display_name:'Synthetic audit member',role:'student',member_status:'prospective',reason:'Synthetic service audit regression'})]);
 await db.exec(`reset role;insert into auth.users(id,email,invited_at,raw_user_meta_data) values('${id(n+1000)}','audit${n}@example.test',clock_timestamp(),'{"team_invitation_id":"${id(n)}"}');insert into profiles(id,display_name,role,active) values('${id(n+1000)}','Synthetic quarantine','readonly',false)`);
 return {invitation:id(n),user:id(n+1000)};
}
async function finish(x:{invitation:string,user:string}){await db.query('select team_invitation_finish($1,$2)',[x.invitation,x.user]);}
async function snapshot(x:{invitation:string,user:string}){
 await db.exec('reset role');return (await db.query<any>(`select (select to_jsonb(p) from profiles p where id=$1) profile,(select to_jsonb(i) from team_private.invitations i where id=$2) invitation,(select coalesce(jsonb_agg(h order by id),'[]') from team_attendance_history h where student_id=$1) history`,[x.user,x.invitation])).rows[0];
}
test.beforeAll(async()=>{db=await canonicalBaseline();await db.exec(await syntheticCanonicalMigration(db));await db.exec(actualUid);});
test.afterAll(()=>db?.close());

test('actual null-subject service completion audits the locked Admin Lead inviter and replay adds no audit',async()=>{
 const x=await seed(1201,7);await request('');expect((await identity()).uid).toBeNull();await db.exec('begin');await finish(x);expect(await identity()).toEqual({uid:null,subject:'',claims:serviceClaims});await db.exec('commit');
 await db.exec('reset role');expect((await db.query<any>('select performed_by from team_attendance_history where student_id=$1',[x.user])).rows).toEqual([{performed_by:id(7)}]);
 expect((await db.query<any>('select role,active from profiles where id=$1',[x.user])).rows[0]).toEqual({role:'student',active:true});
 const before=await snapshot(x);await db.exec(`update profiles set role='readonly' where id='${id(7)}'`);await request('');await finish(x);expect(await identity()).toEqual({uid:null,subject:'',claims:serviceClaims});expect(await snapshot(x)).toEqual(before);await db.exec(`update profiles set role='admin_lead' where id='${id(7)}'`);
});

test('unrelated original subject and complete JWT claims are restored after successful registration',async()=>{
 const x=await seed(1202);const claims=JSON.stringify({role:'service_role',sub:id(5),nested:{unchanged:true}});await request(id(2),claims);const before=await identity();await db.exec('begin');await finish(x);expect(await identity()).toEqual(before);await db.exec('commit');
 await db.exec('reset role');expect((await db.query<any>('select performed_by from team_attendance_history where student_id=$1',[x.user])).rows).toEqual([{performed_by:id(1)}]);
});

test('caught INSERT error restores both identity views and rolls back provisioning and audit',async()=>{
 const x=await seed(1203);const before=await snapshot(x);
 // An additional test-only error trigger forces the exception path; the actual
 // audit trigger and its NOT NULL constraint remain installed and unchanged.
 await db.exec(`create function public.synthetic_membership_failure() returns trigger language plpgsql as $$begin if new.student_id='${x.user}' then if auth.uid()<>'${id(1)}'::uuid then raise exception 'Wrong attribution';end if;raise exception 'Synthetic membership failure' using errcode='23514';end if;return new;end$$;create trigger synthetic_membership_failure before insert on team_attendance_members for each row execute function public.synthetic_membership_failure()`);
 const claims=JSON.stringify({role:'service_role',sub:id(5),marker:'preserved on error'});await request(id(2),claims);const actorBefore=await identity();
 await db.exec('begin');await db.exec(`do $$begin begin perform team_invitation_finish('${x.invitation}','${x.user}');raise exception 'Expected membership failure';exception when check_violation then if sqlerrm<>'Synthetic membership failure' then raise;end if;end;end$$`);
 expect(await identity()).toEqual(actorBefore);await db.exec('commit');expect(await snapshot(x)).toEqual(before);await db.exec('drop trigger synthetic_membership_failure on team_attendance_members;drop function public.synthetic_membership_failure()');
});

test('existing conflicting registration is not overwritten and restores claims before reconciliation error',async()=>{
 const x=await seed(1204);await request(id(1),'{}','authenticated');await db.exec(`reset role;insert into team_attendance_members(student_id,member_status,team_area) values('${x.user}','registered','Unrelated registration')`);const before=await snapshot(x);await request('');
 await expect(finish(x)).rejects.toThrow(/Existing registration differs/);expect(await identity()).toEqual({uid:null,subject:'',claims:serviceClaims});expect(await snapshot(x)).toEqual(before);
});

test('identity mismatch and revoked or inactive inviter remain quarantined without subject changes or audit',async()=>{
 for(const mode of ['identity','readonly','inactive']){
  const x=await seed(mode==='identity'?1205:mode==='readonly'?1206:1207,7);const before=await snapshot(x);
  if(mode==='readonly')await db.exec(`update profiles set role='readonly' where id='${id(7)}'`);
  if(mode==='inactive')await db.exec(`update profiles set active=false where id='${id(7)}'`);
  await request(id(2));const actorBefore=await identity();await expect(finish(mode==='identity'?{...x,user:id(2)}:x)).rejects.toThrow(/identity mismatch|no longer authorized/);expect(await identity()).toEqual(actorBefore);expect(await snapshot(x)).toEqual(before);await db.exec(`update profiles set role='admin_lead',active=true where id='${id(7)}'`);
 }
});

test('service-only EXECUTE and nonnullable audit remain enforced',async()=>{
 await db.exec('reset role');expect((await db.query<any>(`select has_function_privilege('anon','public.team_invitation_finish(uuid,uuid)','execute') anon,has_function_privilege('authenticated','public.team_invitation_finish(uuid,uuid)','execute') member,has_function_privilege('service_role','public.team_invitation_finish(uuid,uuid)','execute') service,(select attnotnull from pg_attribute where attrelid='team_attendance_history'::regclass and attname='performed_by') nonnullable`)).rows[0]).toEqual({anon:false,member:false,service:true,nonnullable:true});
 for(const role of ['anon','authenticated']){await request(id(1),'{}',role);await expect(db.query('select team_invitation_finish($1,$2)',[id(1201),id(2201)])).rejects.toThrow(/permission denied/);}
});
