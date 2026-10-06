import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {baseline,id,migration} from './fixtures/outreach-baseline.mjs';
test.describe.configure({mode:'serial'});
let db:PGlite;let actor=1;let sequence=1000;let linkReceipt='';let organizationReceipt='';
const request=()=>id(sequence++);
async function as(n:number){actor=n;await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);}
async function context(season:string|null=id(100)){return(await db.query<any>('select outreach_context($1) c',[season])).rows[0].c;}
async function save(entity:string,p:Record<string,unknown>,req=request(),expected=id(actor)){return(await db.query<any>('select outreach_save($1,$2,$3,$4) r',[entity,JSON.stringify(p),req,expected])).rows[0].r;}
async function link(pledge=id(330),income=id(200),req=request(),expected=id(actor)){return(await db.query<any>('select outreach_link_income($1,$2,$3,$4) r',[pledge,income,req,expected])).rows[0].r;}
async function status(req:string,expected=id(actor)){return(await db.query<any>('select outreach_request_status($1,$2) r',[req,expected])).rows[0].r;}
async function cancel(req:string,expected:string|null=id(actor)){return(await db.query<any>('select outreach_cancel_request($1,$2) r',[req,expected])).rows[0].r;}
const organization=(n=300)=>({id:id(n),version:0,kind:'organization',name:`Synthetic ${n}`,website:'https://example.test',notes:'Local synthetic fixture',active:true});
const engagement=(n=310,org=300,season=100)=>({id:id(n),version:0,organization_id:id(org),season_id:id(season),stage:'prospect',owner_id:id(2),next_follow_up_on:'2026-10-20',notes:''});
const pledge=(n=330,eng=310)=>({id:id(n),version:0,engagement_id:id(eng),kind:'cash',amount:500,description:'Synthetic cash pledge',promised_on:'2026-10-05',expected_on:'2026-11-01',status:'pledged'});
const recognition=(n=340)=>({id:id(n),version:0,engagement_id:id(310),pledge_id:id(330),owner_id:id(2),kind:'thank_you',description:'Send a thank-you note',due_on:'2026-11-15',status:'promised',fulfilled_on:null,fulfillment_note:''});
async function financeSnapshot(){await db.exec('reset role');return(await db.query<any>(`select jsonb_build_object('income',(select jsonb_agg(to_jsonb(i) order by id) from finance_income i),'seasons',(select jsonb_agg(to_jsonb(s) order by id) from finance_seasons s),'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from finance_private.history h),'grants',(select jsonb_agg(jsonb_build_object('relname',relname,'acl',relacl::text,'rls',relrowsecurity) order by relname) from pg_class where relname like 'finance_%'),'guard',pg_get_functiondef('finance_private.can_manage_budget()'::regprocedure)) data`)).rows[0].data;}
let originalFinance:any;
test.beforeAll(async()=>{db=new PGlite();await db.exec(baseline());originalFinance=await financeSnapshot();await db.exec(readFileSync(migration,'utf8'));expect(await financeSnapshot()).toEqual(originalFinance);await as(1);});
test.afterAll(()=>db.close());
test('active admin/mentor only, even when student/lead has Finance access',async()=>{
 for(const n of [3,4,5,6,999]){await as(n);await expect(context()).rejects.toMatchObject({code:'42501'});await expect(save('organization',organization())).rejects.toMatchObject({code:'42501'});}
 for(const n of [1,2]){await as(n);const c=await context();expect(c.contract_version).toBe(1);expect(c.can_manage).toBe(true);expect(c.owners.map((x:any)=>x.id)).toEqual([id(1),id(2)]);expect(c.income).toHaveLength(2);expect(c.seasons[0]).not.toHaveProperty('starting_funds');}
 await expect(context(id(999))).rejects.toThrow(/Season unavailable/);expect((await context(null)).season_id).toBe(id(100));await as(1);
});
test('organizations and business contacts persist separately from seasonal outreach',async()=>{
 await save('organization',organization());await save('organization',{...organization(301),kind:'person'});
 await save('engagement',engagement());await save('engagement',engagement(311,301));await save('engagement',engagement(312,300,101));
 await save('contact',{id:id(320),version:0,organization_id:id(300),name:'Synthetic Business Contact',title:'Community contact',email:'contact@example.test',phone:'555-0100',notes:'',active:true});
 const c=await context();expect(c.organizations).toHaveLength(2);expect(c.contacts).toHaveLength(1);expect(c.engagements).toHaveLength(2);expect((await context(id(101))).engagements).toHaveLength(1);
 await expect(save('engagement',engagement(313))).rejects.toMatchObject({code:'23505'});
 await expect(save('engagement',{...engagement(313,301,101),owner_id:id(3)})).rejects.toThrow(/active admin or mentor/);
});
test('actor identity, client-authored metadata, idempotency and stale versions',async()=>{
 await expect(save('organization',organization(305),request(),id(2))).rejects.toMatchObject({code:'42501'});
 const req=request(),payload={...organization(305),created_by:id(3),role:'admin'};organizationReceipt=req;const first=await save('organization',payload,req);
 expect(await save('organization',payload,req)).toEqual(first);expect(await status(req)).toEqual({status:'applied',result:first});
 await expect(save('organization',{...payload,name:'Changed request'},req)).rejects.toThrow(/different data/);
 const created=(await context()).organizations.find((x:any)=>x.id===id(305));expect(created.created_by).toBe(id(1));
 await expect(save('organization',{...created,version:0,name:'Stale'})).rejects.toMatchObject({code:'40001'});
 await save('organization',{...created,name:'Updated synthetic'});
 expect(await save('organization',payload,req)).toEqual(first); // Original outcome, no new history/version.
 await as(2);expect(await status(req)).toEqual({status:'not_found'});await expect(status(req,id(1))).rejects.toMatchObject({code:'42501'});await as(1);
 await db.exec('reset role');expect((await db.query<any>('select count(*)::int n from outreach_private.history where request_id=$1',[req])).rows[0].n).toBe(1);await as(1);
});
test('conversations reject cross-organization contacts and are append-only',async()=>{
 const p={id:id(350),version:0,engagement_id:id(310),contact_id:id(320),occurred_on:'2026-10-05',channel:'meeting',summary:'Synthetic discussion only'};
 await expect(save('conversation',{...p,engagement_id:id(311)})).rejects.toThrow(/contact from this organization/);
 await save('conversation',p);const row=(await context()).conversations[0];expect(row.created_by).toBe(id(1));
 await expect(save('conversation',{...row,summary:'Overwrite'})).rejects.toThrow(/append-only/);
 await expect(save('contact',{...(await context()).contacts[0],organization_id:id(301)})).rejects.toThrow(/cannot be moved/);
 await expect(save('engagement',{...(await context()).engagements[0],season_id:id(101)})).rejects.toThrow(/cannot be moved/);
});
test('pledges never imply receipts; cash and in-kind validity enforced',async()=>{
 await save('pledge',pledge());await save('pledge',{...pledge(331),kind:'in_kind',amount:null,description:'Synthetic donated materials'});
 for(const patch of [{status:'received'},{kind:'cash',amount:null},{kind:'cash',amount:0},{kind:'in_kind',amount:50},{expected_on:'2026-10-01'}])await expect(save('pledge',{...pledge(339),...patch})).rejects.toMatchObject({code:'23514'});
 await save('pledge',pledge(332,311));await save('pledge',pledge(333,312));
 await expect(save('pledge',{...(await context()).pledges[0],engagement_id:id(311)})).rejects.toThrow(/cannot be moved/);
});
test('recognition and thank-you obligations have independent owners, due dates and completion',async()=>{
 await expect(save('recognition',{...recognition(),pledge_id:id(332)})).rejects.toThrow(/pledge from this engagement/);
 await save('recognition',recognition());let r=(await context()).recognition[0];
 await expect(save('recognition',{...r,status:'fulfilled'})).rejects.toMatchObject({code:'23514'});
 await save('recognition',{...r,status:'fulfilled',fulfilled_on:'2026-10-06',fulfillment_note:'Synthetic completion evidence'});
 r=(await context()).recognition[0];expect(r.status).toBe('fulfilled');expect((await context()).pledges.find((x:any)=>x.id===id(330)).status).toBe('pledged');
 await expect(save('recognition',{...r,status:'promised'})).rejects.toMatchObject({code:'23514'});
});
test('Finance linking only associates existing same-season cash income and preserves Finance authority',async()=>{
 await expect(link(id(331))).rejects.toThrow(/cash pledge/);await expect(link(id(330),id(201))).rejects.toThrow(/this season/);
 const req=request(),first=await link(id(330),id(200),req);linkReceipt=req;expect(await link(id(330),id(200),req)).toEqual(first);
 expect(await link(id(330),id(200))).toEqual(first);await expect(link(id(332),id(200))).rejects.toThrow(/already linked/);
 await expect(link(id(330),id(202),req)).rejects.toThrow(/different data/);
 const c=await context();expect(c.income_links).toHaveLength(1);expect(c.income[0].status).toBe('expected');
 const p=c.pledges.find((x:any)=>x.id===id(330));await expect(save('pledge',{...p,kind:'in_kind',amount:null})).rejects.toThrow(/remain cash/);
 expect(await financeSnapshot()).toEqual(originalFinance);await as(1);
});
test('current Finance status is read through, with no receipt totals or local status copies',async()=>{
 await db.exec(`reset role;update finance_income set status='received',received_on='2026-10-06' where id='${id(200)}'`);await as(1);
 const c=await context();expect(c.income.find((i:any)=>i.id===id(200)).status).toBe('received');expect(c.pledges.find((p:any)=>p.id===id(330)).status).toBe('pledged');expect(c.income_links[0]).not.toHaveProperty('amount');
 await db.exec(`reset role;update finance_income set status='expected',received_on=null where id='${id(200)}'`);await as(1);
});
test('unchanged Finance guard remains authoritative even if its policy later tightens',async()=>{
 await db.exec(`reset role;create or replace function finance_private.can_manage_budget() returns boolean language sql stable security definer set search_path='' as $$select false$$;`);
 try{await as(1);const c=await context();expect(c.can_link_finance).toBe(false);expect(c.income).toEqual([]);expect(c.income_links).toEqual([]);await expect(link()).rejects.toMatchObject({code:'42501'});await expect(link(id(330),id(200),linkReceipt)).rejects.toMatchObject({code:'42501'});await expect(status(linkReceipt)).rejects.toMatchObject({code:'42501'});}finally{await db.exec('reset role');await db.exec(originalFinance.guard);await as(1);}
});
test('roles and owner eligibility revoke live, closed seasons and archived organizations reject edits',async()=>{
 const p=(await context()).organizations[0];await db.exec(`reset role;update profiles set active=false where id='${id(1)}'`);await as(1);await expect(context()).rejects.toMatchObject({code:'42501'});await expect(save('organization',p)).rejects.toMatchObject({code:'42501'});await expect(save('organization',{...organization(305),created_by:id(3),role:'admin'},organizationReceipt)).rejects.toMatchObject({code:'42501'});await expect(status(organizationReceipt)).rejects.toMatchObject({code:'42501'});
 await db.exec(`reset role;update profiles set active=true where id='${id(1)}';update profiles set role='student' where id='${id(2)}'`);await as(2);await expect(context()).rejects.toMatchObject({code:'42501'});await as(1);
 await expect(save('recognition',{...(await context()).recognition[0],fulfillment_note:'Owner revoked'})).rejects.toThrow(/active admin or mentor/);
 await db.exec(`reset role;update profiles set role='mentor' where id='${id(2)}'`);await as(1);
 await expect(save('engagement',engagement(315,300,102))).rejects.toThrow(/Open Finance season/);
 await save('organization',{...p,active:false});await expect(save('conversation',{id:id(355),version:0,engagement_id:id(310),occurred_on:'2026-10-06',channel:'other',summary:'Archived'})).rejects.toThrow(/Active organization/);
 await save('organization',{...p,version:p.version+1,active:true});
});
test('audit and request receipts are immutable, atomic, and inaccessible directly',async()=>{
 await db.exec(`reset role;create function outreach_private.fail_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;create trigger synthetic_failure before insert on outreach_private.history for each row execute function outreach_private.fail_audit()`);await as(1);
 const req=request();await expect(save('organization',organization(399),req)).rejects.toThrow(/synthetic audit failure/);expect(await status(req)).toEqual({status:'not_found'});expect((await context()).organizations.some((o:any)=>o.id===id(399))).toBe(false);
 await db.exec('reset role;drop trigger synthetic_failure on outreach_private.history;drop function outreach_private.fail_audit()');
 for(const table of ['history','requests','conversations'])for(const verb of [`delete from ${table}`,`truncate ${table}`])await expect(db.exec(`set search_path=outreach_private,public;${verb}`)).rejects.toMatchObject({code:'42501'});
 await db.exec("set search_path=public");
 for(const role of ['anon','authenticated','service_role']){await db.exec(`reset role;set role ${role}`);for(const table of ['organizations','contacts','engagements','conversations','pledges','recognition','income_links','history','requests'])for(const action of ['select * from','delete from','truncate'])await expect(db.exec(`${action} outreach_private.${table}`)).rejects.toMatchObject({code:'42501'});await expect(db.exec('select outreach_private.require_manager()')).rejects.toMatchObject({code:'42501'});if(role!=='authenticated')await expect(context()).rejects.toMatchObject({code:'42501'});}
 await as(1);expect(await financeSnapshot()).toEqual(originalFinance);await as(1);
});
test('cancellation tombstone is idempotent and prevents late save or link without business changes',async()=>{
 const req=request(),before=await context();expect(await status(req)).toEqual({status:'not_found'});
 expect(await cancel(req)).toEqual({status:'canceled'});expect(await cancel(req)).toEqual({status:'canceled'});expect(await status(req)).toEqual({status:'canceled'});
 await expect(save('organization',organization(399),req)).rejects.toMatchObject({code:'22023'});
 await expect(link(id(330),id(202),req)).rejects.toThrow(/canceled before application/);
 expect(await context()).toEqual(before);await db.exec('reset role');
 expect((await db.query<any>('select count(*)::int n from outreach_private.requests where request_id=$1',[req])).rows[0].n).toBe(1);
 expect((await db.query<any>('select count(*)::int n from outreach_private.history where request_id=$1',[req])).rows[0].n).toBe(0);await as(1);
});
test('canceling an already-applied request returns its original receipt without undo or duplicate audit',async()=>{
 const before=await context(),outcome=await status(organizationReceipt),financeOutcome=await status(linkReceipt);
 expect(await cancel(organizationReceipt)).toEqual(outcome);expect(await cancel(organizationReceipt)).toEqual(outcome);
 expect(await cancel(linkReceipt)).toEqual(financeOutcome);expect(await context()).toEqual(before);
 await db.exec('reset role');expect((await db.query<any>('select count(*)::int n from outreach_private.history where request_id=$1',[organizationReceipt])).rows[0].n).toBe(1);
 expect(await financeSnapshot()).toEqual(originalFinance);await as(1);
});
test('cancellation preserves actor isolation, live access, and Finance guards for applied links',async()=>{
 const req=request();await as(2);expect(await cancel(req)).toEqual({status:'canceled'});await as(1);expect(await status(req)).toEqual({status:'not_found'});
 await expect(cancel(req,id(2))).rejects.toMatchObject({code:'42501'});await expect(cancel(req,null)).rejects.toMatchObject({code:'22023'});
 for(const n of [3,4,5,6,999]){await as(n);await expect(cancel(req)).rejects.toMatchObject({code:'42501'});}
 await db.exec(`reset role;update profiles set active=false where id='${id(1)}'`);await as(1);await expect(cancel(organizationReceipt)).rejects.toMatchObject({code:'42501'});
 await db.exec(`reset role;update profiles set active=true where id='${id(1)}';create or replace function finance_private.can_manage_budget() returns boolean language sql stable security definer set search_path='' as $$select false$$;`);
 try{await as(1);await expect(cancel(linkReceipt)).rejects.toMatchObject({code:'42501'});expect((await cancel(organizationReceipt)).status).toBe('applied');expect(await cancel(req)).toEqual({status:'canceled'});}finally{await db.exec('reset role');await db.exec(originalFinance.guard);await as(1);}
 for(const role of ['anon','service_role']){await db.exec(`reset role;set role ${role}`);await expect(cancel(req)).rejects.toMatchObject({code:'42501'});}await as(1);
});
