import type {AssemblyCheck,AssemblyContext,AssemblySnapshot,CheckInput,ComponentInput,ReadinessFacts} from './types';

export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const componentStatuses={needed:'Needed',ordered:'Ordered',received:'Received',installed:'Installed'} as const;
export const checkKinds={fit:'Fit',function:'Function',durability:'Durability',other:'Other'} as const;
export const checkOutcomes={passed:'Passed',failed:'Failed',blocked:'Blocked'} as const;
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const nullableId=(value:unknown)=>value===null||id(value);
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max;
const nonblank=(value:unknown,max:number)=>text(value,max)&&!!value.trim();
// Canonical Planning columns use PostgreSQL length(), which counts Unicode
// code points rather than the UTF-16 units used by Assembly's own inputs.
const canonicalText=(value:unknown,max:number):value is string=>typeof value==='string'&&Array.from(value).length<=max;
const canonicalTitle=(value:unknown)=>{if(typeof value!=='string')return false;const trimmed=value.replace(/^ +| +$/g,'');return trimmed.length>0&&canonicalText(trimmed,200);};
const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const stamp=(value:unknown)=>text(value,100)&&Number.isFinite(Date.parse(value));
const list=(value:unknown,predicate:(row:any)=>boolean,max=1000)=>Array.isArray(value)&&value.length<=max&&value.every(predicate);
const unique=(rows:{id:string}[])=>new Set(rows.map(row=>row.id)).size===rows.length;
const identityList=(value:unknown,max=1000):value is string[]=>list(value,id,max)&&new Set(value as string[]).size===(value as string[]).length;
/** PostgreSQL date output, retained verbatim; JS Date cannot represent its full range. */
function canonicalDateOrder(value:unknown):number|null {
 if(value==='-infinity')return -Infinity;if(value==='infinity')return Infinity;
 if(typeof value!=='string')return null;
 const match=/^(\d{4}|[1-9]\d{4,6})-(\d{2})-(\d{2})( BC)?$/.exec(value);if(!match)return null;
 const displayYear=Number(match[1]),year=match[4]?1-displayYear:displayYear,month=Number(match[2]),day=Number(match[3]);
 if(displayYear<1||month<1||month>12)return null;
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(day<1||day>days[month-1])return null;
 // Exact PostgreSQL date bounds: Julian day 0 to 5874897-12-31.
 if(year< -4713||year===-4713&&(month<11||month===11&&day<24)||year>5874897)return null;
 // A monotonic numeric tuple key is sufficient for ordering; no normalization.
 return year*372+(month-1)*31+day;
}
function canonicalTimeline(start:unknown,due:unknown):boolean {
 const first=start===null?null:canonicalDateOrder(start),last=due===null?null:canonicalDateOrder(due);
 return (start===null||first!==null)&&(due===null||last!==null)&&(first===null||last===null||last>=first);
}

/** Reference-only evidence: never fetch or render a supplied URL as embedded content. */
export function safeEvidenceUrl(value:string):string|null {
 if(typeof value!=='string'||value.length>2000||/[\s\\\u0000-\u001f\u007f-\u009f]/.test(value)||/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)||!/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::[0-9]{1,5})?(?:[/?#]|$)/i.test(value))return null;
 try{
  const url=new URL(value),host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||host.length>253||host.split('.').some(label=>label.startsWith('xn--'))||/(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host)||url.port!==''&&(!Number.isInteger(Number(url.port))||Number(url.port)<1||Number(url.port)>65535))return null;
  return url.href;
 }catch{return null;}
}
export function validateComponent(value:ComponentInput):string|null {
 if(!object(value)||!id(value.id))return 'The component is unavailable. Refresh before saving.';
 if(!nonblank(value.name,200))return 'Add a component name of up to 200 characters.';
 if(!integer(value.quantity,1,100000))return 'Quantity must be a whole number between 1 and 100,000.';
 if(!Object.hasOwn(componentStatuses,value.status))return 'Choose a component status.';
 if(!text(value.notes,2000))return 'Keep component notes within 2,000 characters.';
 return null;
}
export function validateCheck(value:CheckInput):string|null {
 if(!object(value)||!id(value.id)||!nullableId(value.revision_id)||!nullableId(value.rework_task_id)||!nullableId(value.supersedes_id)||value.supersedes_id===value.id)return 'Check the linked revision, earlier check and Planning task.';
 if(!nonblank(value.title,200))return 'Add a check title of up to 200 characters.';
 if(!Object.hasOwn(checkKinds,value.kind)||!Object.hasOwn(checkOutcomes,value.outcome))return 'Choose a check kind and outcome.';
 if(!(['procedure','expected','observed'] as const).every(key=>nonblank(value[key],2000)))return 'Add a procedure, expected result and observed result, up to 2,000 characters each.';
 if(!text(value.evidence_url,2000)||value.evidence_url!==''&&!safeEvidenceUrl(value.evidence_url))return 'Use an HTTPS evidence link without credentials, spaces or local addresses.';
 if(value.outcome==='passed'&&value.rework_task_id!==null)return 'A passed check cannot request rework.';
 return null;
}
const component=(value:unknown)=>object(value)&&validateComponent(value as ComponentInput)===null&&id(value.created_by)&&stamp(value.created_at)&&stamp(value.updated_at);
const revision=(value:unknown)=>object(value)&&id(value.id)&&id(value.part_id)&&nonblank(value.name,200)&&integer(value.revision_number,1);
const part=(value:unknown)=>object(value)&&id(value.id)&&nonblank(value.name,200)&&['needs_review','ready','in_progress','done','on_hold'].includes(value.status)&&integer(value.version,1)&&id(value.current_revision_id)&&integer(value.revision_number,1)&&integer(value.quantity,1,100000);
const owner=(value:unknown)=>object(value)&&id(value.id)&&text(value.name,150)&&(value.active===undefined||typeof value.active==='boolean');
const task=(value:unknown)=>object(value)&&id(value.id)&&id(value.board_id)&&canonicalTitle(value.title)&&canonicalText(value.description,5000)&&['backlog','todo','in_progress','blocked','done'].includes(value.status)&&['low','normal','high','urgent'].includes(value.priority)&&identityList(value.owner_ids)&&list(value.owners,owner)&&unique(value.owners)&&value.owners.length===value.owner_ids.length&&value.owners.every((person:{id:string})=>value.owner_ids.includes(person.id))&&nullableId(value.area_id)&&canonicalTimeline(value.start_date,value.due_date)&&canonicalText(value.blocked_reason,500)&&integer(value.version,1);
const check=(value:unknown)=>object(value)&&validateCheck(value as CheckInput)===null&&id(value.created_by)&&stamp(value.created_at);
const factKeys=['parts_total','parts_done','components_total','components_available','tasks_total','tasks_done','tasks_blocked','checks_total','checks_passed','checks_failed','checks_blocked','checks_stale'] as const;
const facts=(value:unknown):value is ReadinessFacts=>object(value)&&Object.keys(value).length===factKeys.length&&factKeys.every(key=>integer(value[key],0,1000))&&value.parts_done<=value.parts_total&&value.components_available<=value.components_total&&value.tasks_done+value.tasks_blocked<=value.tasks_total&&value.checks_passed+value.checks_failed+value.checks_blocked+value.checks_stale===value.checks_total;
const snapshot=(value:unknown)=>object(value)&&id(value.id)&&id(value.board_id)&&id(value.created_by)&&stamp(value.created_at)&&text(value.notes,2000)&&facts(value.facts)&&nonblank(value.summary,8000);

/** Superseded observations stay visible in history, but never contribute to current facts. */
export function latestChecks(context:Pick<AssemblyContext,'checks'>):AssemblyCheck[]{
 const superseded=new Set(context.checks.flatMap(row=>row.supersedes_id?[row.supersedes_id]:[]));
 return context.checks.filter(row=>!superseded.has(row.id));
}
export function isStaleCheck(check:AssemblyCheck,context:Pick<AssemblyContext,'parts'|'revisions'>):boolean {
 if(check.revision_id===null)return false;
 const revision=context.revisions.find(row=>row.id===check.revision_id);
 return !revision||!context.parts.some(part=>part.id===revision.part_id&&part.current_revision_id===revision.id);
}
export function readinessFacts(context:Pick<AssemblyContext,'parts'|'revisions'|'components'|'tasks'|'linked_task_ids'|'checks'>):ReadinessFacts {
 const linked=new Set(context.linked_task_ids),tasks=context.tasks.filter(task=>linked.has(task.id)),latest=latestChecks(context),current=latest.filter(check=>!isStaleCheck(check,context));
 return {parts_total:context.parts.length,parts_done:context.parts.filter(part=>part.status==='done').length,components_total:context.components.length,components_available:context.components.filter(component=>['received','installed'].includes(component.status)).length,tasks_total:tasks.length,tasks_done:tasks.filter(task=>task.status==='done').length,tasks_blocked:tasks.filter(task=>task.status==='blocked').length,checks_total:latest.length,checks_passed:current.filter(check=>check.outcome==='passed').length,checks_failed:current.filter(check=>check.outcome==='failed').length,checks_blocked:current.filter(check=>check.outcome==='blocked').length,checks_stale:latest.length-current.length};
}
/** Reject malformed or cross-project references before any record reaches the UI. */
export function assertAssemblyContext(value:unknown,actorId:string,boardId:string):AssemblyContext {
 if(!object(value)||!id(actorId)||!id(boardId)||value.user_id!==actorId||value.board_id!==boardId||!integer(value.version)||typeof value.can_edit!=='boolean'||!stamp(value.loaded_at)||!list(value.components,component,200)||!list(value.parts,part)||!list(value.revisions,revision,10000)||!list(value.tasks,task,Number.MAX_SAFE_INTEGER)||!identityList(value.linked_task_ids,500)||!list(value.checks,check,1000)||!list(value.snapshots,snapshot,200)||!facts(value.facts))throw Error('Assembly & Testing returned an invalid response. Refresh to try again.');
 const context=value as AssemblyContext;
 if([context.components,context.parts,context.revisions,context.tasks,context.checks,context.snapshots].some(rows=>!unique(rows)))throw Error('Assembly & Testing returned duplicate records. Refresh to try again.');
 const parts=new Map(context.parts.map(row=>[row.id,row])),revisions=new Map(context.revisions.map(row=>[row.id,row])),tasks=new Map(context.tasks.map(row=>[row.id,row])),checks=new Map(context.checks.map(row=>[row.id,row]));
 const revisionNumbers=new Set(context.revisions.map(row=>`${row.part_id}:${row.revision_number}`)),superseded=context.checks.flatMap(row=>row.supersedes_id?[row.supersedes_id]:[]);
 if(context.tasks.some(row=>row.board_id!==boardId)||context.snapshots.some(row=>row.board_id!==boardId)||context.linked_task_ids.some(task=>!tasks.has(task))||context.revisions.some(row=>!parts.has(row.part_id))||revisionNumbers.size!==context.revisions.length||context.parts.some(row=>{const current=revisions.get(row.current_revision_id);return !current||current.part_id!==row.id||current.name!==row.name||current.revision_number!==row.revision_number||context.revisions.some(revision=>revision.part_id===row.id&&revision.revision_number>row.revision_number);})||new Set(superseded).size!==superseded.length||context.checks.some(row=>row.revision_id!==null&&!revisions.has(row.revision_id)||row.supersedes_id!==null&&(!checks.has(row.supersedes_id)||checks.get(row.supersedes_id)!.revision_id!==row.revision_id)))throw Error('This assembly no longer matches the selected project or linked records. Refresh to try again.');
 // Every chain must terminate. A cycle can otherwise hide every result in a chain.
 const complete=new Set<string>();
 for(const row of context.checks){const path=new Set<string>();let next:AssemblyCheck|undefined=row;while(next&&!complete.has(next.id)){if(path.has(next.id))throw Error('Assembly & Testing returned an invalid check history. Refresh to try again.');path.add(next.id);next=next.supersedes_id?checks.get(next.supersedes_id):undefined;}for(const id of path)complete.add(id);}
 const current=readinessFacts(context);if(factKeys.some(key=>current[key]!==context.facts[key]))throw Error('Assembly readiness facts could not be verified. Refresh to try again.');
 return context;
}
/** Export only the immutable, recorded snapshot; never substitute live counts. */
export function snapshotText(snapshot:AssemblySnapshot):string {return snapshot.summary;}
