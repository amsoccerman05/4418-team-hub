import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {baseline,id,migration} from './fixtures/outreach-baseline.mjs';
import {parseContext,safeWebsite} from '../src/outreach/model';
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
test('active student/lead participation never inherits Finance visibility',async()=>{
 for(const n of [5,6,999]){await as(n);await expect(context()).rejects.toMatchObject({code:'42501'});await expect(save('organization',organization())).rejects.toMatchObject({code:'42501'});}
 for(const n of [1,2]){await as(n);const c=await context();expect(c.contract_version).toBe(2);expect(c.can_manage).toBe(true);expect(new Set(c.owners.map((x:any)=>x.id))).toEqual(new Set([id(1),id(2),id(3),id(4)]));expect(c.income).toHaveLength(2);expect(c.seasons[0]).not.toHaveProperty('starting_funds');}
 for(const n of [3,4]){await as(n);const c=await context();expect(c.can_manage).toBe(false);expect(c.can_link_finance).toBe(false);expect(c.income).toEqual([]);expect(c.financials_redacted).toBe(true);}await as(1);
 await expect(context(id(999))).rejects.toThrow(/Season unavailable/);expect((await context(null)).season_id).toBe(id(100));await as(1);
});
test('organizations and business contacts persist separately from seasonal outreach',async()=>{
 await save('organization',organization());await save('organization',{...organization(301),kind:'person'});
 await save('engagement',engagement());await save('engagement',engagement(311,301));await save('engagement',engagement(312,300,101));
 await save('contact',{id:id(320),version:0,organization_id:id(300),name:'Synthetic Business Contact',title:'Community contact',email:'contact@example.test',phone:'555-0100',notes:'',active:true});
 const c=await context();expect(c.organizations).toHaveLength(2);expect(c.contacts).toHaveLength(1);expect(c.engagements).toHaveLength(2);expect((await context(id(101))).engagements).toHaveLength(1);
 await expect(save('engagement',engagement(313))).rejects.toMatchObject({code:'23505'});
 await expect(save('engagement',{...engagement(313,301,101),owner_id:id(6)})).rejects.toThrow(/active eligible owner/);
});
test('actor identity, client-authored metadata, idempotency and stale versions',async()=>{
 await expect(save('organization',organization(305),request(),id(2))).rejects.toMatchObject({code:'42501'});
 await expect(save('organization',{...organization(305),created_by:id(3)})).rejects.toMatchObject({code:'42501'});
 const req=request(),payload={...organization(305),created_by:id(1),role:'admin'};organizationReceipt=req;const first=await save('organization',payload,req);
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
 const p=(await context()).organizations[0];await db.exec(`reset role;update profiles set active=false where id='${id(1)}'`);await as(1);await expect(context()).rejects.toMatchObject({code:'42501'});await expect(save('organization',p)).rejects.toMatchObject({code:'42501'});await expect(save('organization',{...organization(305),created_by:id(1),role:'admin'},organizationReceipt)).rejects.toMatchObject({code:'42501'});await expect(status(organizationReceipt)).rejects.toMatchObject({code:'42501'});
 await db.exec(`reset role;update profiles set active=true where id='${id(1)}';update profiles set role='readonly' where id='${id(2)}'`);await as(2);await expect(context()).rejects.toMatchObject({code:'42501'});await as(1);
 await expect(save('recognition',{...(await context()).recognition[0],fulfillment_note:'Owner revoked'})).rejects.toThrow(/active eligible owner/);
 await db.exec(`reset role;update profiles set role='mentor' where id='${id(2)}'`);await as(1);
 await expect(save('engagement',engagement(315,300,102))).rejects.toThrow(/Open Finance season/);
 await save('organization',{...p,active:false});await expect(save('conversation',{id:id(355),version:0,engagement_id:id(310),occurred_on:'2026-10-06',channel:'other',summary:'Archived'})).rejects.toThrow(/Active organization/);
 await save('organization',{...p,version:p.version+1,active:true});
});
test('audit and request receipts are immutable, atomic, and inaccessible directly',async()=>{
 await db.exec(`reset role;create function outreach_private.fail_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;create trigger synthetic_failure before insert on outreach_private.history for each row execute function outreach_private.fail_audit()`);await as(1);
 const req=request();await expect(save('organization',organization(399),req)).rejects.toMatchObject({code:'P0001',message:'Outreach change rejected. Check the fields and refresh before retrying.'});expect(await status(req)).toEqual({status:'not_found'});expect((await context()).organizations.some((o:any)=>o.id===id(399))).toBe(false);
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
 for(const n of [5,6,999]){await as(n);await expect(cancel(req)).rejects.toMatchObject({code:'42501'});}
 await db.exec(`reset role;update profiles set active=false where id='${id(1)}'`);await as(1);await expect(cancel(organizationReceipt)).rejects.toMatchObject({code:'42501'});
 await db.exec(`reset role;update profiles set active=true where id='${id(1)}';create or replace function finance_private.can_manage_budget() returns boolean language sql stable security definer set search_path='' as $$select false$$;`);
 try{await as(1);await expect(cancel(linkReceipt)).rejects.toMatchObject({code:'42501'});expect((await cancel(organizationReceipt)).status).toBe('applied');expect(await cancel(req)).toEqual({status:'canceled'});}finally{await db.exec('reset role');await db.exec(originalFinance.guard);await as(1);}
 for(const role of ['anon','service_role']){await db.exec(`reset role;set role ${role}`);await expect(cancel(req)).rejects.toMatchObject({code:'42501'});}await as(1);
});

const prospect=(org=400,eng=410)=>({id:id(org),version:0,engagement_id:id(eng),season_id:id(100),kind:'organization',name:'Synthetic student prospect',website:'https://student.example.test',next_follow_up_on:'2026-10-20'});
const sentLog=(n=450,eng=410)=>({id:id(n),version:0,engagement_id:id(eng),contact_id:null,occurred_on:'2026-10-06',channel:'email',summary:'STUDENT_OWN_SENT_EMAIL: a manually entered record of an email already sent'});
let studentProspectRequest='';let assignedLogRequest='';
test('student prospect is atomic, immediately usable, actor-authored, and safe to replay',async()=>{
 await as(3);const req=request();studentProspectRequest=req;const first=await save('prospect',prospect(),req);expect(first).toEqual({id:id(400),version:1});
 expect(await save('prospect',prospect(),req)).toEqual(first);await expect(save('prospect',{...prospect(),name:'Different'},req)).rejects.toMatchObject({code:'22023'});
 await expect(save('prospect',prospect())).rejects.toMatchObject({code:'40001'});
 const c=await context(),o=c.organizations.find((r:any)=>r.id===id(400)),e=c.engagements.find((r:any)=>r.id===id(410));
 expect(o.created_by).toBe(id(3));expect(e.created_by).toBe(id(3));expect(e.owner_id).toBe(id(3));expect(e.stage).toBe('prospect');expect(e.can_log).toBe(true);expect(e.can_assign).toBe(false);
 await save('contact',{id:id(420),version:0,organization_id:id(400),name:'Synthetic work contact',title:'Outreach',email:'shared@example.test',phone:'555-0140'});
 await save('conversation',{...sentLog(),contact_id:id(420)});
 await expect(save('prospect',prospect(402,410))).rejects.toMatchObject({code:'23505'});expect((await context()).organizations.some((r:any)=>r.id===id(402))).toBe(false);
 await db.exec('reset role');expect((await db.query<any>('select count(*)::int n from outreach_private.history where request_id=$1',[req])).rows[0].n).toBe(2);expect((await db.query<any>('select count(*)::int n from outreach_private.requests where request_id=$1',[req])).rows[0].n).toBe(1);await as(3);
});
test('all sponsor/contact identity details are shared while private notes, other message contents and financials are redacted',async()=>{
 await as(1);let c=await context();await save('organization',{...c.organizations.find((r:any)=>r.id===id(400)),notes:'MENTOR_ONLY_ORG'});await save('contact',{...c.contacts.find((r:any)=>r.id===id(420)),notes:'MENTOR_ONLY_CONTACT'});await save('engagement',{...c.engagements.find((r:any)=>r.id===id(410)),notes:'MENTOR_ONLY_ENGAGEMENT'});
 await save('conversation',{...sentLog(451),summary:'MENTOR_ONLY_EMAIL_BODY'});
 for(const actor of [3,4]){await as(actor);c=await context();const o=c.organizations.find((r:any)=>r.id===id(400)),contact=c.contacts.find((r:any)=>r.id===id(420));expect(o.name).toBe('Synthetic student prospect');expect(o.website).toBe('https://student.example.test');expect([contact.name,contact.title,contact.email,contact.phone]).toEqual(['Synthetic work contact','Outreach','shared@example.test','555-0140']);
  expect(c.organizations.every((r:any)=>r.notes===null&&r.notes_redacted)).toBe(true);expect(c.contacts.every((r:any)=>r.notes===null&&r.notes_redacted)).toBe(true);expect(c.engagements.every((r:any)=>r.notes===null&&r.notes_redacted)).toBe(true);
  const own=c.conversations.find((r:any)=>r.id===id(450)),other=c.conversations.find((r:any)=>r.id===id(451));expect(own.summary_redacted).toBe(actor!==3);expect(own.summary).toBe(actor===3?sentLog().summary:null);expect(other.summary).toBeNull();expect(other.author_name).toBe('Synthetic Admin');expect(other.channel).toBe('email');expect(other.can_edit).toBe(false);
  expect(JSON.stringify(c)).not.toContain('MENTOR_ONLY');expect(c.pledges).toEqual([]);expect(c.recognition).toEqual([]);expect(c.income).toEqual([]);expect(c.income_links).toEqual([]);expect(c.financials_redacted).toBe(true);expect(c.can_link_finance).toBe(false);expect(c).not.toHaveProperty('history');
 }
 await as(1);c=await context();expect(c.conversations.find((r:any)=>r.id===id(450)).summary).toBe(sentLog().summary);expect(c.conversations.find((r:any)=>r.id===id(451)).summary).toBe('MENTOR_ONLY_EMAIL_BODY');
});
test('student edits preserve redacted mentor notes and cannot archive or change another author',async()=>{
 await as(3);let c=await context();await save('organization',{...c.organizations.find((r:any)=>r.id===id(400)),name:'Student corrected name',notes:''});await save('contact',{...c.contacts.find((r:any)=>r.id===id(420)),title:'Community outreach',notes:null});await save('engagement',{...c.engagements.find((r:any)=>r.id===id(410)),stage:'contacted',next_follow_up_on:'2026-10-22',notes:'attempted replacement'});
 c=await context();await expect(save('organization',{...c.organizations.find((r:any)=>r.id===id(400)),active:false})).rejects.toMatchObject({code:'42501'});await expect(save('contact',{...c.contacts.find((r:any)=>r.id===id(420)),created_by:id(1)})).rejects.toMatchObject({code:'42501'});
 await as(1);c=await context();expect(c.organizations.find((r:any)=>r.id===id(400)).notes).toBe('MENTOR_ONLY_ORG');expect(c.contacts.find((r:any)=>r.id===id(420)).notes).toBe('MENTOR_ONLY_CONTACT');expect(c.engagements.find((r:any)=>r.id===id(410)).notes).toBe('MENTOR_ONLY_ENGAGEMENT');
});
test('unrelated students cannot take over or log; explicit manager assignment enables only scoped participation',async()=>{
 await as(4);let c=await context();const e=c.engagements.find((r:any)=>r.id===id(410));expect(e.can_edit).toBe(false);expect(e.can_log).toBe(false);
 await expect(save('organization',{...c.organizations.find((r:any)=>r.id===id(400)),name:'Takeover'})).rejects.toMatchObject({code:'42501'});await expect(save('contact',{...c.contacts.find((r:any)=>r.id===id(420)),phone:'Takeover'})).rejects.toMatchObject({code:'42501'});await expect(save('engagement',{...e,owner_id:id(4)})).rejects.toMatchObject({code:'42501'});await expect(save('conversation',sentLog(452))).rejects.toMatchObject({code:'42501'});
 await as(1);c=await context();await save('engagement',{...c.engagements.find((r:any)=>r.id===id(410)),owner_id:id(4)});
 await as(4);c=await context();const assigned=c.engagements.find((r:any)=>r.id===id(410));expect(assigned.can_log).toBe(true);expect(assigned.can_assign).toBe(false);expect(c.organizations.find((r:any)=>r.id===id(400)).can_edit).toBe(false);expect(c.organizations.find((r:any)=>r.id===id(400)).can_add_contact).toBe(true);
 assignedLogRequest=request();await save('conversation',sentLog(452),assignedLogRequest);await save('contact',{id:id(421),version:0,organization_id:id(400),name:'Student-added colleague',email:'colleague@example.test'});
 await expect(save('engagement',{...assigned,owner_id:id(3)})).rejects.toMatchObject({code:'42501'});
 await as(3);expect((await context()).engagements.find((r:any)=>r.id===id(410)).can_log).toBe(true); // Creator ownership remains, assignment is additional.
});
test('students cannot spoof authors, alter log bodies, claim others prospects, or create financial commitments',async()=>{
 await as(3);for(const spoof of [{created_by:id(1)},{author_id:id(1)},{sender_id:id(1)}])await expect(save('conversation',{...sentLog(454),...spoof})).rejects.toMatchObject({code:'42501'});
 for(const n of [3,4]){await as(n);const c=await context();for(const row of c.conversations.filter((r:any)=>[id(450),id(451),id(452)].includes(r.id)))await expect(save('conversation',{...row,summary:'Changed body'})).rejects.toMatchObject({code:'22023'});await expect(save('pledge',pledge(460,410))).rejects.toMatchObject({code:'42501'});await expect(save('recognition',{...recognition(461),engagement_id:id(410)})).rejects.toMatchObject({code:'42501'});await expect(link()).rejects.toMatchObject({code:'42501'});}
 await as(3);await expect(save('engagement',{...engagement(412,301,101),owner_id:id(3)})).rejects.toMatchObject({code:'42501'});await expect(save('engagement',{...engagement(413,400,101),owner_id:id(4)})).rejects.toMatchObject({code:'42501'});await expect(save('engagement',{...engagement(413,400,101),owner_id:id(3),stage:'committed'})).rejects.toMatchObject({code:'42501'});
});
test('assignment revocation denies late writes and replay but own opaque recovery remains usable',async()=>{
 await as(1);let c=await context();await save('engagement',{...c.engagements.find((r:any)=>r.id===id(410)),owner_id:id(3)});
 await as(4);c=await context();expect(c.engagements.find((r:any)=>r.id===id(410)).can_log).toBe(false);expect(c.contacts.find((r:any)=>r.id===id(421)).can_edit).toBe(false);
 await expect(save('conversation',sentLog(453))).rejects.toMatchObject({code:'42501'});await expect(save('conversation',sentLog(452),assignedLogRequest)).rejects.toMatchObject({code:'42501'});
 const recovered={status:'applied',result:{id:id(452),version:1}};expect(await status(assignedLogRequest)).toEqual(recovered);expect(await cancel(assignedLogRequest)).toEqual(recovered);expect(await cancel(request())).toEqual({status:'canceled'});
 await as(3);expect(await status(assignedLogRequest)).toEqual({status:'not_found'});await expect(status(assignedLogRequest,id(4))).rejects.toMatchObject({code:'42501'});
 await db.exec(`reset role;update profiles set role='readonly' where id='${id(4)}'`);await as(4);await expect(status(assignedLogRequest)).rejects.toMatchObject({code:'42501'});await expect(cancel(assignedLogRequest)).rejects.toMatchObject({code:'42501'});await db.exec(`reset role;update profiles set role='lead' where id='${id(4)}'`);await as(4);expect(await status(assignedLogRequest)).toEqual(recovered);
});
test('creator logging also requires active organization and open season while recovery never exposes payloads',async()=>{
 await db.exec(`reset role;update outreach_private.organizations set active=false where id='${id(400)}'`);await as(3);expect((await context()).engagements.find((r:any)=>r.id===id(410)).can_log).toBe(false);await expect(save('conversation',sentLog(455))).rejects.toThrow(/Active organization/);await expect(save('prospect',prospect(),studentProspectRequest)).rejects.toMatchObject({code:'42501'});expect(await status(studentProspectRequest)).toEqual({status:'applied',result:{id:id(400),version:1}});
 await db.exec(`reset role;update outreach_private.organizations set active=true where id='${id(400)}';update finance_seasons set status='closed' where id='${id(100)}'`);await as(3);const c=await context();expect(c.can_create_prospect).toBe(false);expect(c.engagements.find((r:any)=>r.id===id(410)).can_log).toBe(false);await expect(save('conversation',sentLog(455))).rejects.toThrow(/Open Finance season/);await expect(save('prospect',prospect(403,414))).rejects.toThrow(/Open Finance season/);
 await db.exec(`reset role;update finance_seasons set status='active' where id='${id(100)}'`);await as(3);
});
test('new private policy helpers stay inaccessible and Outreach still cannot mutate Finance',async()=>{
 for(const expression of ["outreach_private.require_participant()",`outreach_private.manager('${id(3)}')`,`outreach_private.can_work_engagement('${id(410)}','${id(3)}')`,`outreach_private.can_add_contact('${id(400)}','${id(3)}')`,`outreach_private.can_edit_record('organization','${id(400)}','${id(3)}')`])await expect(db.exec(`select ${expression}`)).rejects.toMatchObject({code:'42501'});
 expect(await financeSnapshot()).toEqual(originalFinance);await as(1);
});

test('required Outreach text rejects the exact JavaScript trim whitespace set',async()=>{
 const blank=['\t\n','\u00a0','\ufeff','\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000','\t\n\v\f\r '];
 for(const text of blank){expect(text.trim()).toBe('');await as(3);await expect(save('prospect',{...prospect(700,710),name:text})).rejects.toMatchObject({code:'23514'});await expect(save('contact',{id:id(720),version:0,organization_id:id(400),name:text})).rejects.toMatchObject({code:'23514'});await expect(save('conversation',{...sentLog(750),summary:text})).rejects.toMatchObject({code:'23514'});await as(1);await expect(save('pledge',{...pledge(730,410),description:text})).rejects.toMatchObject({code:'23514'});await expect(save('recognition',{...recognition(740),description:text})).rejects.toMatchObject({code:'23514'});}
 for(const n of [1,3,4]){await as(n);expect(parseContext(await context(),id(n))).not.toBeNull();}
});
test('every Outreach calendar field rejects infinity, BC, and five-digit years before context can become unreadable',async()=>{
 for(const bad of ['infinity','-infinity','0001-01-01 BC','10000-01-01']){
  await as(3);const c=await context();await expect(save('prospect',{...prospect(700,710),next_follow_up_on:bad})).rejects.toMatchObject({code:'23514'});await expect(save('engagement',{...c.engagements.find((r:any)=>r.id===id(410)),next_follow_up_on:bad})).rejects.toMatchObject({code:'23514'});await expect(save('conversation',{...sentLog(750),occurred_on:bad})).rejects.toMatchObject({code:'23514'});
  await as(1);await expect(save('pledge',{...pledge(730,410),promised_on:bad,expected_on:null})).rejects.toMatchObject({code:'23514'});await expect(save('pledge',{...pledge(730,410),expected_on:bad})).rejects.toMatchObject({code:'23514'});await expect(save('recognition',{...recognition(740),due_on:bad})).rejects.toMatchObject({code:'23514'});await expect(save('recognition',{...recognition(740),status:'fulfilled',fulfilled_on:bad})).rejects.toMatchObject({code:'23514'});
 }
 await as(3);for(const [n,date] of [[750,'0001-01-01'],[751,'9999-12-31']] as const){const c=await context();await save('engagement',{...c.engagements.find((r:any)=>r.id===id(410)),next_follow_up_on:date});await save('conversation',{...sentLog(n),occurred_on:date});expect(parseContext(await context(),id(3))).not.toBeNull();}
 expect((await context()).organizations.some((r:any)=>r.id===id(700))).toBe(false);
});
test('actual RPC context safely projects invalid legacy Finance dates and null actor labels without changing the source',async()=>{
 await db.exec(`reset role;update profiles set display_name=null where id='${id(3)}'`);
 for(const bad of ['infinity','-infinity','0001-01-01 BC','10000-01-01']){
  await db.exec('reset role');await db.query('update finance_seasons set starts_on=$1::date,ends_on=$1::date where id=$2',[bad,id(100)]);await db.query("update finance_income set expected_on=$1::date,received_on=$1::date,status='received' where id=$2",[bad,id(200)]);
  for(const n of [1,3,4]){await as(n);const c=await context();expect(parseContext(c,id(n))).not.toBeNull();expect(c.seasons.find((r:any)=>r.id===id(100))).toMatchObject({starts_on:null,ends_on:null});expect(c.owners.find((r:any)=>r.id===id(3)).name).toBe('Team member');expect(c.conversations.find((r:any)=>r.id===id(450)).author_name).toBe('Team member');if(n===1)expect(c.income.find((r:any)=>r.id===id(200))).toMatchObject({expected_on:null,received_on:null,status:'received'});}
  await db.exec('reset role');expect((await db.query<any>("select starts_on::text date from finance_seasons where id=$1",[id(100)])).rows[0].date).toBe(bad);expect((await db.query<any>("select expected_on::text date from finance_income where id=$1",[id(200)])).rows[0].date).toBe(bad);
 }
 await db.exec(`update profiles set display_name='Synthetic Student' where id='${id(3)}';update finance_seasons set starts_on=null,ends_on=null where id='${id(100)}';update finance_income set expected_on=null,received_on=null,status='expected' where id='${id(200)}'`);expect(await financeSnapshot()).toEqual(originalFinance);await as(1);
});
test('optional malformed websites never blank actual RPC context or produce an unsafe link',async()=>{
 await as(3);for(const [n,website] of [[701,'https://'],[702,'http://bad host'],[703,'https://user:secret@example.test'],[704,'']] as const){await save('organization',{...organization(n),website});const c=await context();expect(parseContext(c,id(3))).not.toBeNull();expect(safeWebsite(c.organizations.find((r:any)=>r.id===id(n)).website)).toBeNull();}
 await expect(save('organization',{...organization(705),website:'javascript:alert(1)'})).rejects.toMatchObject({code:'23514'});expect(parseContext(await context(),id(3))).not.toBeNull();await as(1);
});

test('creator can preserve an unchanged inactive assignee while new assignments still require eligibility',async()=>{
 await as(1);let e=(await context()).engagements.find((r:any)=>r.id===id(410));await save('engagement',{...e,owner_id:id(4)});
 await db.exec(`reset role;update profiles set role='readonly' where id='${id(4)}'`);await as(3);e=(await context()).engagements.find((r:any)=>r.id===id(410));expect(e.can_edit).toBe(true);expect(e.can_log).toBe(true);
 const {owner_id:ignored,...fields}=e;await save('engagement',{...fields,next_follow_up_on:'2026-11-01'});const updated=(await context()).engagements.find((r:any)=>r.id===id(410));expect(updated.owner_id).toBe(id(4));expect(updated.next_follow_up_on).toBe('2026-11-01');expect(parseContext(await context(),id(3))).not.toBeNull();
 await as(4);await expect(context()).rejects.toMatchObject({code:'42501'});await as(1);await expect(save('engagement',{...(await context()).engagements.find((r:any)=>r.id===id(310)),owner_id:id(4)})).rejects.toThrow(/active eligible owner/);
 await db.exec(`reset role;update profiles set role='lead' where id='${id(4)}'`);await as(1);await save('engagement',{...updated,owner_id:id(3),notes:'MENTOR_ONLY_ENGAGEMENT'});
});

test('public and directly executable private saves suppress raw row diagnostics while preserving error codes and rollback',async()=>{
 await as(3);const before=await context(),contact=before.contacts.find((r:any)=>r.id===id(420)),eng=before.engagements.find((r:any)=>r.id===id(410));
 const raw=async(operation:()=>Promise<unknown>)=>{try{await operation();throw new Error('Expected database rejection');}catch(error:any){const fields=Object.fromEntries(Object.getOwnPropertyNames(error).map(key=>[key,error[key]]));expect(JSON.stringify(fields)).not.toContain('MENTOR_ONLY_');expect(JSON.stringify(fields)).not.toContain('Failing row contains');expect(error.detail||'').toBe('');expect(error.hint||'').toBe('');return error;}};
 for(const payload of [{...contact,name:''},{...contact,name:null}]){const error=await raw(()=>save('contact',payload));expect(error.code).toBe(payload.name===null?'23502':'23514');expect(error.message).toBe('Outreach change rejected. Check the fields and refresh before retrying.');}
 const engagementError=await raw(()=>save('engagement',{...eng,stage:'invalid'}));expect(engagementError.code).toBe('23514');
 const privateError=await raw(()=>db.query('select outreach_private.save($1,$2,$3,$4)',['contact',JSON.stringify({...contact,name:''}),request(),id(3)]));expect(privateError.code).toBe('23514');
 const atomicRequest=request(),atomicError=await raw(()=>save('prospect',prospect(799,410),atomicRequest));expect(atomicError.code).toBe('23505');expect(await status(atomicRequest)).toEqual({status:'not_found'});expect((await context()).organizations.some((r:any)=>r.id===id(799))).toBe(false);
 const denied=await raw(()=>save('organization',{...before.organizations.find((r:any)=>r.id===id(301)),name:'Forbidden'}));expect(denied.code).toBe('42501');expect(denied.message).toContain('not owned or assigned');const stale=await raw(()=>save('engagement',{...eng,version:0}));expect(stale.code).toBe('40001');expect(stale.message).toContain('Changed by another teammate');
 expect(await context()).toEqual(before);await as(1);const manager=await context();expect(manager.contacts.find((r:any)=>r.id===id(420)).notes).toBe('MENTOR_ONLY_CONTACT');expect(manager.engagements.find((r:any)=>r.id===id(410)).notes).toBe('MENTOR_ONLY_ENGAGEMENT');
});
