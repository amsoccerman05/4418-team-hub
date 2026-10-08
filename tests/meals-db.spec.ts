import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

import { SQL_DELIVERY_ENVELOPE, syntheticProviderUsage, syntheticMailApproval } from './helpers/meal-delivery-fixture.ts';

// Synthetic data only. PGlite validates SQL/ACL/transaction behavior; it does not
// replace native concurrent-connection or deployed PostgREST/Edge tests.
let db: PGlite;
let meal: any;
const deliveryLeases = new Map<string,string>();
let mainSlot: string | undefined, drinkSlot: string | undefined;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const hash = (s: string) => createHash('sha256').update(s).digest();
const h = (s: string) => hash(s);
const draft = () => ({ title: 'Saturday team lunch', service_at: '2027-10-09T12:00:00Z', timezone: 'UTC', expected_headcount: 40,
  guidance: 'Label shared food ingredients; ask the coordinator privately about individual needs.', status: 'open',
  slots: [{ ...(mainSlot ? { id: mainSlot } : {}), label: 'Sandwiches', category: 'main', unit: 'servings', needed: 10 }, { ...(drinkSlot ? { id: drinkSlot } : {}), label: 'Water', category: 'drink', unit: 'bottles', needed: 20 }] });
async function query(sql: string, args: any[] = []) { return (await db.query<any>(sql, args)).rows; }
async function as(n: number) { await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`); }
async function server() { await db.exec('reset role;set role service_role;'); }
async function save(p: any) { return (await query('select public.meals_manager_save($1::jsonb) result', [JSON.stringify(p)]))[0].result; }
async function context() { return (await query('select public.meals_manager_context() result'))[0].result; }
async function list() { await server(); return (await query('select meals_private.list_public() result'))[0].result; }
async function hold(key = 'first', extra: Record<string, any> = {}) {
  await server();
  const p = { meal: meal.id, slot: mainSlot, whole: false, quantity: 2, name: 'Synthetic Parent', email: 'parent@example.invalid', ...extra };
  return (await query('select meals_private.create_hold($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) result',
    [p.meal,p.slot,p.whole,p.quantity,p.name,p.email,h('request:'+key),h('verify:'+key),h('manage:'+key),h('ip:'+key),randomUUID(),randomUUID(),SQL_DELIVERY_ENVELOPE,syntheticProviderUsage()]))[0].result;
}
async function beginDelivery(oid: string) {
  await server();const lease=(await query('select meals_private.begin_delivery($1,$2) lease',[oid,syntheticProviderUsage()]))[0].lease;
  if(lease)deliveryLeases.set(oid,lease.lease_token);return lease;
}
async function finishDelivery(oid: string,status='failed') {
  await server();return query('select meals_private.finish_delivery($1,$2,$3,false,null)',[oid,deliveryLeases.get(oid),status]);
}
async function verify(key = 'first') { await server();return (await query('select meals_private.verify($1,$2) result',[h('verify:'+key),h('access:'+key)]))[0].result; }
async function inspect(key = 'first', purpose = 'access') { await server();return (await query('select meals_private.inspect($1) result',[h(purpose+':'+key)]))[0].result; }
async function change(key: string, version: number, quantity: number | null, cancel = false, purpose='access') {
  await server();return (await query('select meals_private.change_claim($1,$2,$3,$4) result',[h(purpose+':'+key),version,quantity,cancel]))[0].result;
}
async function currentDraft(extra: Record<string,any> = {}) { const m=(await list())[0];return {...draft(),id:m.id,version:m.version,...extra}; }
async function raw(sql: string, args: any[] = []) { await db.exec('reset role');return query(sql,args); }

test.beforeEach(async () => {
  mainSlot=undefined;drinkSlot=undefined;deliveryLeases.clear();
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.profiles(id uuid primary key,role text,active boolean);
    insert into profiles values('${id(1)}','mentor',true),('${id(2)}','admin',true),('${id(3)}','lead',true),('${id(4)}','student',true),('${id(5)}','mentor',false),('${id(6)}','readonly',true);`);
  await db.exec(readFileSync('supabase/drafts/saturday-meals.sql','utf8'));
  await db.exec(syntheticMailApproval(50)); // Explicit synthetic test budget; draft defaults to zero.
  await as(1);meal=await save(draft());
  mainSlot=meal.slots.find((s:any)=>s.category==='main').id;drinkSlot=meal.slots.find((s:any)=>s.category==='drink').id;
});
test.afterEach(async()=>{await db?.close();});

test('private tables are RLS-protected; browser roles and service role cannot read contacts/tokens or write base rows',async()=>{
  await hold();
  for(const role of ['anon','authenticated','service_role']) {
    await db.exec('reset role;set role '+role);
    for(const table of ['meals','slots','parent_contacts','claims','tokens','outbox','idempotency','mail_budget','rate_windows','history']) {
      await expect(query(`select * from meals_private.${table}`)).rejects.toThrow(/permission denied/);
      await expect(query(`delete from meals_private.${table}`)).rejects.toThrow(/permission denied/);
    }
    await expect(query('select meals_private.manager()')).rejects.toThrow(/permission denied/);
    if(role!=='authenticated') await expect(context()).rejects.toThrow(/permission denied/);
    if(role!=='service_role') await expect(query('select meals_private.list_public()')).rejects.toThrow(/permission denied/);
  }
  const r=await raw("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='meals_private' and c.relkind='r' and c.relrowsecurity");
  expect(r[0].n).toBe(10);
  expect((await raw("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='meals_private' and has_function_privilege('anon',p.oid,'EXECUTE')"))[0].n).toBe(0);
});

test('manager wrappers read fresh active mentor/admin profiles and reject leads, students, inactive, anonymous and forged identities',async()=>{
  for(const n of [1,2]) {await as(n);expect((await context()).meals).toHaveLength(1);}
  for(const n of [3,4,5,6]) {await as(n);await expect(context()).rejects.toThrow(/coordinator/);await expect(save(draft())).rejects.toThrow(/coordinator/);}
  await raw(`update profiles set active=false where id='${id(1)}'`);await as(1);await expect(context()).rejects.toThrow(/coordinator/);
  await db.exec("reset role;select set_config('test.uid','',false);set role authenticated;");await expect(context()).rejects.toThrow(/coordinator/);
});

test('public projection is explicit and contains no contacts, claims, hashes, individual dietary data or delivery details',async()=>{
  await hold('private',{name:'Private Parent Marker',email:'private-marker@example.invalid'});
  const publicMeals=await list(), serialized=JSON.stringify(publicMeals);
  expect(publicMeals[0]).toMatchObject({whole_meal:'coordination_required',slots:expect.any(Array)});
  expect(publicMeals[0].slots.find((s:any)=>s.id===mainSlot)).toMatchObject({confirmed:0,held:2,remaining:8});
  for(const forbidden of ['Private Parent Marker','private-marker','contact','token','claim_id','email_status','hold_expires_at'])expect(serialized).not.toContain(forbidden);
  expect(Object.keys(publicMeals[0]).sort()).toEqual(['expected_headcount','guidance','id','service_at','slots','status','timezone','title','version'].concat('whole_meal').sort());
  await as(1);expect((await context()).claims[0]).toMatchObject({name:'Private Parent Marker',email:'private-marker@example.invalid'});
});

test('pending holds reserve exact capacity; confirmation does not double count; whole-meal claims are mutually exclusive',async()=>{
  await hold('a',{quantity:8});await hold('b',{quantity:2});
  await expect(hold('c',{quantity:1})).rejects.toThrow(/no longer available/);
  await expect(hold('whole',{whole:true,slot:null,quantity:1})).rejects.toThrow(/coordinator/);
  await verify('a');let m=(await list())[0];expect(m.slots.find((s:any)=>s.id===mainSlot)).toMatchObject({confirmed:8,held:2,remaining:0});
  const a=await inspect('a');await change('a',a.version,null,true);
  await raw("update meals_private.claims set hold_expires_at=clock_timestamp()-interval '1 second' where status='pending'");
  await hold('whole',{whole:true,slot:null,quantity:1});
  await expect(hold('item',{slot:drinkSlot})).rejects.toThrow(/coordinator/);
  await expect(hold('whole2',{whole:true,slot:null,quantity:1})).rejects.toThrow(/coordinator/);
  await verify('whole');m=(await list())[0];expect(m.whole_meal).toBe('confirmed');expect(m.slots.every((s:any)=>s.confirmed===s.needed&&s.remaining===0)).toBe(true);
  expect((await raw('select count(*)::int n from meals_private.claims'))[0].n).toBe(3);
});

test('expired holds free capacity without being deleted and expired verification cannot revive them',async()=>{
  await hold('old',{quantity:10});await raw("update meals_private.claims set hold_expires_at=clock_timestamp()-interval '1 second'");
  expect((await list())[0].slots.find((s:any)=>s.id===mainSlot).remaining).toBe(10);
  await expect(verify('old')).rejects.toThrow(/expired/);
  await hold('new',{quantity:10});
  expect((await raw("select status from meals_private.claims order by created_at" )).map(r=>r.status)).toEqual(['expired','pending']);
  expect((await raw("select revoked_at from meals_private.tokens where token_hash=$1",[h('verify:old')]))[0].revoked_at).not.toBeNull();
});

test('verification is single-use; management link reopens after session expiry, is scoped and revokes on cancellation',async()=>{
  await hold('a');await hold('b');await expect(inspect('a','manage')).rejects.toThrow(/expired/);
  const a=await verify('a'),b=await verify('b');expect(a.status).toBe('confirmed');expect(a).not.toHaveProperty('email');
  await expect(verify('a')).rejects.toThrow(/expired/);
  await expect(query('select meals_private.inspect($1)',[h('wrong')])).rejects.toThrow(/expired/);
  await raw("update meals_private.tokens set expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '1 hour' where token_hash=$1",[h('access:a')]);
  await expect(inspect('a')).rejects.toThrow(/expired/);expect((await inspect('a','manage')).id).toBe(a.id);
  await server();expect((await query('select meals_private.reopen_session($1,$2) result',[h('manage:a'),h('new-access:a')]))[0].result.id).toBe(a.id);
  await change('a',a.version,null,true,'manage');
  await expect(inspect('a','manage')).rejects.toThrow(/expired/);expect((await inspect('b')).id).toBe(b.id);
  expect((await raw('select count(*)::int n from meals_private.tokens where claim_id=$1 and revoked_at is null',[a.id]))[0].n).toBe(0);
  const fields=(await raw("select column_name from information_schema.columns where table_schema='meals_private' and table_name in ('tokens','outbox')")).map(x=>x.column_name);
  for(const secret of ['token','access_token','verify_token','url','body','payload'])expect(fields).not.toContain(secret);
});

test('quantity edits and cancellations are versioned, bounded and preserve other contributions',async()=>{
  await hold('a',{quantity:5});await hold('b',{quantity:4});const a=await verify('a');await verify('b');
  await expect(change('a',a.version,7)).rejects.toThrow(/no longer available/);
  const edited=await change('a',a.version,6);expect(edited.quantity).toBe(6);
  await expect(change('a',a.version,1)).rejects.toThrow(/changed/);
  await change('a',edited.version,null,true);expect((await inspect('b')).quantity).toBe(4);
  const states=await raw('select status,quantity from meals_private.claims order by created_at');expect(states).toEqual([{status:'cancelled',quantity:6},{status:'confirmed',quantity:4}]);
});

test('coordinator edits reject stale/missing versions, invalid Saturdays, over-reduction, claimed-slot removal and identity changes',async()=>{
  await expect(save({...draft(),service_at:'2027-10-10T12:00:00Z'})).rejects.toThrow(/Saturday/);
  await hold('a',{quantity:6});const p=await currentDraft();await as(1);
  await expect(save({...p,version:undefined})).rejects.toThrow(/version/);
  await expect(save({...p,version:1})).rejects.toThrow(/changed/);
  await expect(save({...p,slots:[{...p.slots[0],needed:5},p.slots[1]]})).rejects.toThrow(/below/);
  await expect(save({...p,slots:[p.slots[1]]})).rejects.toThrow(/claimed slot/);
  for(const field of ['label','unit','category'])await expect(save({...p,slots:[{...p.slots[0],[field]:field==='category'?'side':'Changed'},p.slots[1]]})).rejects.toThrow(/specifications/);
  await expect(save({...p,service_at:'2027-10-16T12:00:00Z'})).rejects.toThrow(/rescheduling/);
  expect((await save({...p,slots:[{...p.slots[0],needed:6},p.slots[1]]})).slots.find((s:any)=>s.id===mainSlot).needed).toBe(6);
});

test('whole-meal commitments freeze specifications; cancellation requires acknowledgement and retains cancelled records',async()=>{
  await hold('whole',{whole:true,slot:null,quantity:1});await verify('whole');const p=await currentDraft();await as(1);
  await expect(save({...p,expected_headcount:41})).rejects.toThrow(/headcount/);
  await expect(save({...p,slots:[{...p.slots[0],needed:11},p.slots[1]]})).rejects.toThrow(/capacity/);
  await expect(save({...p,slots:[{...p.slots[0],label:'Other food'},p.slots[1]]})).rejects.toThrow(/capacity/);
  await expect(save({...p,status:'cancelled',cancellation_reason:'Synthetic cancellation'})).rejects.toThrow(/acknowledge/);
  await expect(save({...p,status:'cancelled',acknowledge_cancellation:true})).rejects.toThrow(/reason/);
  const closed=await save({...p,status:'cancelled',cancellation_reason:'Synthetic cancellation',acknowledge_cancellation:true});expect(closed.status).toBe('cancelled');expect(closed.whole_meal).toBe('available');
  expect((await raw("select count(*)::int n from meals_private.claims where status='cancelled'"))[0].n).toBe(1);
  await expect(inspect('whole','manage')).rejects.toThrow(/expired/);
  await expect(hold('new')).rejects.toThrow(/not accepting/);
});

test('coordinator cancellation needs current version and reason, revokes capability, and retains private audit attribution',async()=>{
  const held=await hold();const c=await verify();await as(1);
  await expect(query('select public.meals_manager_cancel_claim($1,$2,$3)',[held.claim_id,1,'No longer needed'])).rejects.toThrow(/changed/);
  await expect(query('select public.meals_manager_cancel_claim($1,$2,$3)',[held.claim_id,c.version,''])).rejects.toThrow(/reason/);
  await query('select public.meals_manager_cancel_claim($1,$2,$3)',[held.claim_id,c.version,'Synthetic coordinator request']);
  await expect(inspect()).rejects.toThrow(/expired/);
  const audit=(await raw("select actor_id,reason from meals_private.history where action='coordinator_cancelled'"))[0];expect(audit).toEqual({actor_id:id(1),reason:'Synthetic coordinator request'});
});

test('idempotent claim retries do not reserve/send/budget twice and retain known failed or uncertain delivery status',async()=>{
  const a=await hold();await server();expect(Boolean(await beginDelivery(a.outbox_id))).toBe(true);
  expect(Boolean(await beginDelivery(a.outbox_id))).toBe(false);
  expect(await hold()).toMatchObject({claim_id:a.claim_id,email_status:'uncertain',replayed:true,can_send:false});
  await server();await finishDelivery(a.outbox_id);
  expect(await hold()).toMatchObject({email_status:'failed',hold_expires_at:null,can_send:false});
  await expect(hold('first',{quantity:3})).rejects.toThrow(/key already used/);
  expect((await raw('select count(*)::int n from meals_private.claims'))[0].n).toBe(1);
  expect((await raw('select used from meals_private.mail_budget'))[0].used).toBe(1);
});



test('dispatch lease rejects closed, cancelled, past-service and expired-hold states before sending',async()=>{
  for(const state of ['closed','cancelled','past-service','expired-hold']) {
    await raw("update meals_private.meals set status='open',service_at=$1 where id=$2",[draft().service_at,meal.id]);
    const held=await hold('dispatch-'+state,{quantity:1});
    if(state==='closed'||state==='cancelled')await raw('update meals_private.meals set status=$1 where id=$2',[state,meal.id]);
    else if(state==='past-service')await raw("update meals_private.meals set service_at=clock_timestamp()-interval '1 minute' where id=$1",[meal.id]);
    else await raw("update meals_private.claims set hold_expires_at=clock_timestamp()-interval '1 second' where id=$1",[held.claim_id]);
    await server();expect(Boolean(await beginDelivery(held.outbox_id))).toBe(false);
    expect((await raw('select status,envelope from meals_private.outbox where id=$1',[held.outbox_id]))[0]).toEqual({status:'failed',envelope:null});
  }
});

test('definite delivery failure releases pending capacity, revokes links and increments meal version once',async()=>{
  const held=await hold('failed',{quantity:10});const before=(await list())[0];await server();
  await beginDelivery(held.outbox_id);
  await finishDelivery(held.outbox_id);
  const after=(await list())[0];expect(after.version).toBe(before.version+1);
  expect(after.slots.find((s:any)=>s.id===mainSlot)).toMatchObject({held:0,confirmed:0,remaining:10});
  await expect(verify('failed')).rejects.toThrow(/expired/);await expect(inspect('failed','manage')).rejects.toThrow(/expired/);
  expect(await hold('failed',{quantity:10})).toMatchObject({claim_id:held.claim_id,email_status:'failed',hold_expires_at:null,can_send:false});
  await server();await finishDelivery(held.outbox_id);
  expect((await list())[0].version).toBe(after.version);
  await hold('replacement',{quantity:10});
  expect((await raw('select status from meals_private.claims where id=$1',[held.claim_id]))[0].status).toBe('expired');
  expect((await raw('select count(*)::int n from meals_private.tokens where claim_id=$1 and revoked_at is null',[held.claim_id]))[0].n).toBe(0);
  expect((await raw("select count(*)::int n from meals_private.history where claim_id=$1 and action='delivery_failed'",[held.claim_id]))[0].n).toBe(1);
});

test('delivery failure arriving after verification preserves the confirmed pledge and management access',async()=>{
  const held=await hold('confirmed',{quantity:10});await server();await beginDelivery(held.outbox_id);
  const verified=await verify('confirmed');const before=(await list())[0];await server();
  await finishDelivery(held.outbox_id);
  const after=(await list())[0];expect(after.version).toBe(before.version);
  expect(after.slots.find((s:any)=>s.id===mainSlot)).toMatchObject({held:0,confirmed:10,remaining:0});
  expect(await inspect('confirmed','manage')).toMatchObject({id:verified.id,status:'confirmed',version:verified.version});
  expect((await raw('select status from meals_private.outbox where id=$1',[held.outbox_id]))[0].status).toBe('failed');
  expect((await raw("select count(*)::int n from meals_private.history where claim_id=$1 and action='delivery_failed'",[held.claim_id]))[0].n).toBe(0);
});

test('daily budget defaults fail-closed; budget and email limits leave no partial records',async()=>{
  const defaultValue=(await raw("select pg_get_expr(d.adbin,d.adrelid) value from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='meals_private.mail_budget'::regclass and a.attname='daily_limit'"))[0].value;
  expect(defaultValue).toBe('0');
  await raw('update meals_private.mail_budget set daily_limit=0');await expect(hold('disabled')).rejects.toThrow(/budget/);
  expect((await raw('select count(*)::int n from meals_private.claims'))[0].n).toBe(0);
  await raw('update meals_private.mail_budget set daily_limit=1');await hold('a');await expect(hold('b')).rejects.toThrow(/budget/);
  expect((await raw('select count(*)::int n from meals_private.parent_contacts'))[0].n).toBe(1);
  await raw('update meals_private.mail_budget set daily_limit=100');
  for(let i=1;i<4;i++)await hold('rate'+i,{slot:drinkSlot,quantity:1});
  await expect(hold('over-rate',{slot:drinkSlot,quantity:1})).rejects.toThrow(/Too many/);
  expect((await raw('select used from meals_private.mail_budget'))[0].used).toBe(4);
  expect((await raw('select count(*)::int n from meals_private.claims'))[0].n).toBe(4);
});

test('cross-meal slots, malformed hashes, nulls, extra fields and audit failure cannot create partial writes',async()=>{
  await as(1);const other=await save({...draft(),slots:[{...draft().slots[0],id:undefined}]});
  await expect(hold('cross',{meal:other.id,slot:mainSlot})).rejects.toThrow(/Slot unavailable/);
  await server();await expect(query('select meals_private.create_hold($1,$2,false,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[meal.id,mainSlot,'Synthetic','x@example.invalid',h('r'),null,h('m'),h('i'),randomUUID(),randomUUID(),SQL_DELIVERY_ENVELOPE,syntheticProviderUsage()])).rejects.toThrow(/Invalid/);
  await as(1);await expect(save({...draft(),extra:true})).rejects.toThrow(/Invalid/);
  await db.exec('reset role');await db.exec(`create function meals_private.fail_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;
    create trigger fail_audit before insert on meals_private.history for each row execute function meals_private.fail_audit();`);
  await expect(hold('atomic')).rejects.toThrow(/audit failure/);
  expect((await raw('select count(*)::int n from meals_private.claims'))[0].n).toBe(0);
  expect((await raw('select count(*)::int n from meals_private.tokens'))[0].n).toBe(0);
  expect((await raw('select used from meals_private.mail_budget'))[0].used).toBe(0);
});


test('new slot identifiers are server assigned; request quota commits independently and saturates',async()=>{
  await as(1);
  const p=await currentDraft();await as(1);
  await expect(save({...p,slots:[...p.slots,{id:id(999),label:'Forged slot',category:'other',unit:'items',needed:1}]})).rejects.toThrow(/assigned by the server/);
  const before=await raw('select count(*)::int n from meals_private.slots');expect(before[0].n).toBe(2);
  await server();
  for(let i=0;i<120;i++)expect((await query('select meals_private.reserve_request($1) ok',[h('request-ip')]))[0].ok).toBe(true);
  for(let i=0;i<3;i++)expect((await query('select meals_private.reserve_request($1) ok',[h('request-ip')]))[0].ok).toBe(false);
  expect((await raw("select used from meals_private.rate_windows where kind='request'"))[0].used).toBe(121);
  await server();await expect(query('select meals_private.reserve_request($1)',[new Uint8Array(1)])).rejects.toThrow(/Invalid request hash/);
});
