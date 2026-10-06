import type {OutreachContext, EngagementStage, Organization, Engagement, Pledge, SaveResult, RequestStatus} from './types';
export const stages:Record<EngagementStage,string>={prospect:'Prospect',contacted:'Contacted',discussing:'In conversation',committed:'Committed',closed:'Closed'};
export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseOutreachRoute(route:string):{organizationId:string|null}|null {
  if(route==='#outreach')return {organizationId:null};
  const match=/^#outreach\/([^/]+)$/.exec(route);
  return match&&uuidPattern.test(match[1])?{organizationId:match[1].toLowerCase()}:null;
}
export const today=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
export const dateLabel=(value:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'No date set';
export const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
export function safeWebsite(value:string) {try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const id=(x:unknown):x is string=>typeof x==='string'&&uuidPattern.test(x);
const text=(x:unknown):x is string=>typeof x==='string';
const nullableId=(x:unknown)=>x===null||id(x);
const date=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
const nullableDate=(x:unknown)=>x===null||date(x);
const strings=(x:Record<string,unknown>,keys:string[])=>keys.every(key=>text(x[key]));
const flags=(x:Record<string,unknown>,keys:string[])=>keys.every(key=>typeof x[key]==='boolean');
const protectedText=(x:Record<string,unknown>,key:string,flag:string)=>typeof x[flag]==='boolean'&&(x[flag]?x[key]===null:text(x[key]));
const oneOf=(x:unknown,values:string[])=>typeof x==='string'&&values.includes(x);
const versioned=(x:Record<string,unknown>)=>id(x.id)&&Number.isInteger(x.version)&&Number(x.version)>0&&strings(x,['created_at','updated_at'])&&id(x.created_by);
const rows=(x:unknown,valid:(row:Record<string,unknown>)=>boolean)=>Array.isArray(x)&&x.every(row=>object(row)&&valid(row))&&new Set(x.map(row=>row.id)).size===x.length;
/** The private screen never accepts a partial/mismatched capability response. */
export function parseContext(value:unknown,actorId:string):OutreachContext|null {
  if(!object(value)||value.contract_version!==2||value.user_id!==actorId||!flags(value,['can_manage','can_create_prospect','can_link_finance','financials_redacted'])||!nullableId(value.season_id))return null;
  if(!rows(value.seasons,r=>id(r.id)&&text(r.name)&&oneOf(r.status,['draft','active','closed'])&&nullableDate(r.starts_on)&&nullableDate(r.ends_on))||
    !rows(value.owners,r=>id(r.id)&&text(r.name))||
    !rows(value.organizations,r=>versioned(r)&&oneOf(r.kind,['organization','person'])&&strings(r,['name','website'])&&protectedText(r,'notes','notes_redacted')&&flags(r,['active','can_edit','can_add_contact','can_create_engagement']))||
    !rows(value.contacts,r=>versioned(r)&&id(r.organization_id)&&strings(r,['name','title','email','phone'])&&protectedText(r,'notes','notes_redacted')&&flags(r,['active','can_edit']))||
    !rows(value.engagements,r=>versioned(r)&&id(r.organization_id)&&id(r.season_id)&&r.season_id===value.season_id&&oneOf(r.stage,Object.keys(stages))&&nullableId(r.owner_id)&&nullableDate(r.next_follow_up_on)&&protectedText(r,'notes','notes_redacted')&&flags(r,['can_edit','can_log','can_assign']))||
    !rows(value.conversations,r=>versioned(r)&&id(r.engagement_id)&&nullableId(r.contact_id)&&date(r.occurred_on)&&oneOf(r.channel,['email','phone','meeting','other'])&&protectedText(r,'summary','summary_redacted')&&text(r.author_name)&&r.can_edit===false)||
    !rows(value.pledges,r=>versioned(r)&&id(r.engagement_id)&&oneOf(r.kind,['cash','in_kind'])&&(r.kind==='in_kind'?r.amount===null:typeof r.amount==='number'&&Number.isFinite(r.amount)&&r.amount>0)&&text(r.description)&&date(r.promised_on)&&nullableDate(r.expected_on)&&oneOf(r.status,['pledged','canceled']))||
    !rows(value.recognition,r=>versioned(r)&&id(r.engagement_id)&&nullableId(r.pledge_id)&&nullableId(r.owner_id)&&oneOf(r.kind,['logo','recognition','thank_you','other'])&&strings(r,['description','fulfillment_note'])&&nullableDate(r.due_on)&&(r.status==='fulfilled'?date(r.fulfilled_on):r.fulfilled_on===null)&&oneOf(r.status,['promised','fulfilled','waived']))||
    !rows(value.income,r=>id(r.id)&&id(r.season_id)&&r.season_id===value.season_id&&strings(r,['source','income_type','reference'])&&typeof r.amount==='number'&&Number.isFinite(r.amount)&&r.amount>0&&oneOf(r.status,['expected','received','canceled'])&&nullableDate(r.expected_on)&&nullableDate(r.received_on))||
    !rows(value.income_links,r=>id(r.id)&&id(r.pledge_id)&&id(r.income_id)&&id(r.created_by)&&text(r.created_at)))return null;
  const ctx=value as unknown as OutreachContext;
  if(ctx.financials_redacted!==!ctx.can_manage||(!ctx.can_manage&&ctx.can_link_finance))return null;
  if(ctx.financials_redacted&&(ctx.pledges.length||ctx.recognition.length||ctx.income.length||ctx.income_links.length))return null;
  if([...ctx.organizations,...ctx.contacts,...ctx.engagements].some(row=>row.notes_redacted===ctx.can_manage))return null;
  if(ctx.conversations.some(row=>row.summary_redacted!==(!ctx.can_manage&&row.created_by!==actorId)))return null;
  if(!ctx.can_manage&&(ctx.organizations.some(row=>row.can_edit&&row.created_by!==actorId)||ctx.contacts.some(row=>row.can_edit&&row.created_by!==actorId)||ctx.engagements.some(row=>row.can_assign)))return null;
  const organizations=new Set(ctx.organizations.map(x=>x.id)), engagements=new Map(ctx.engagements.map(x=>[x.id,x])), pledges=new Map(ctx.pledges.map(x=>[x.id,x])), contacts=new Map(ctx.contacts.map(x=>[x.id,x]));
  if(ctx.season_id&&!ctx.seasons.some(s=>s.id===ctx.season_id))return null;
  if(ctx.contacts.some(c=>!organizations.has(c.organization_id))||ctx.engagements.some(e=>!organizations.has(e.organization_id))||new Set(ctx.engagements.map(e=>e.organization_id)).size!==ctx.engagements.length)return null;
  if(ctx.conversations.some(c=>!engagements.has(c.engagement_id)||(c.contact_id&&contacts.get(c.contact_id)?.organization_id!==engagements.get(c.engagement_id)?.organization_id))||ctx.pledges.some(p=>!engagements.has(p.engagement_id))||ctx.recognition.some(r=>!engagements.has(r.engagement_id)||(r.pledge_id&&pledges.get(r.pledge_id)?.engagement_id!==r.engagement_id)))return null;
  if(!ctx.can_link_finance&&(ctx.income.length||ctx.income_links.length))return null;
  if(ctx.income_links.some(l=>pledges.get(l.pledge_id)?.kind!=='cash'||!ctx.income.some(i=>i.id===l.income_id))||new Set(ctx.income_links.map(l=>l.income_id)).size!==ctx.income_links.length)return null;
  return ctx;
}
export function parseSaveResult(value:unknown,expectedId?:string):SaveResult|null {return object(value)&&id(value.id)&&(!expectedId||value.id===expectedId)&&Number.isInteger(value.version)&&Number(value.version)>0?value as SaveResult:null;}
export function parseRequestStatus(value:unknown):RequestStatus|null {if(!object(value))return null;if(value.status==='not_found')return {status:'not_found'};if(value.status==='canceled')return {status:'canceled'};const result=parseSaveResult(value.result);return value.status==='applied'&&result?{status:'applied',result}:null;}
export function receivedFor(ctx:OutreachContext,pledge:Pledge) {if(!ctx.can_link_finance)return null;const ids=new Set(ctx.income_links.filter(link=>link.pledge_id===pledge.id).map(link=>link.income_id));return ctx.income.filter(i=>ids.has(i.id)&&i.status==='received').reduce((total,i)=>total+i.amount,0);}
export type PortfolioRow={organization:Organization;engagement:Engagement|undefined};
export function portfolio(ctx:OutreachContext,query='',stage='all',includeArchived=false):PortfolioRow[] {
  const needle=query.trim().toLocaleLowerCase();
  return ctx.organizations.filter(o=>o.active||includeArchived).map(organization=>({organization,engagement:ctx.engagements.find(e=>e.organization_id===organization.id)})).filter(({organization:o,engagement:e})=>(stage==='all'||e?.stage===stage)&&(!needle||[o.name,o.notes||'',...ctx.contacts.filter(c=>c.organization_id===o.id&&(c.active||includeArchived)).flatMap(c=>[c.name,c.email,c.title])].some(value=>value.toLocaleLowerCase().includes(needle)))).sort((a,b)=>a.organization.name.localeCompare(b.organization.name));
}
export function followUps(ctx:OutreachContext,asOf=today()) {return ctx.engagements.filter(e=>e.stage!=='closed'&&e.next_follow_up_on&&e.next_follow_up_on<=asOf).sort((a,b)=>a.next_follow_up_on!.localeCompare(b.next_follow_up_on!));}
