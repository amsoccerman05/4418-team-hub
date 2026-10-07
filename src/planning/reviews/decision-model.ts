import {tradeStudyIssue} from './trade-study';
import type {DecisionOption,DecisionWorkflow} from './decision-types';
import type {UpdateSave} from './types';
import {safeReferenceUrl,uuid,validDate} from './model';

export const decisionDimensions=['weight','space','cost','reliability','time'] as const;
export const decisionStatusLabels={comparing:'Comparing options',recorded:'Decision recorded',reopened:'Reopened for discussion'};
export function blankDecisionOption():DecisionOption{return {id:crypto.randomUUID(),label:'',description:'',weight:'',space:'',cost:'',reliability:'',time:'',evidence:[]};}
export function blankDecisionWorkflow():DecisionWorkflow{return {schema_version:1,status:'comparing',owner_id:null,target_date:null,decided_on:null,requirements:[],options:[blankDecisionOption(),blankDecisionOption()],chosen_option_id:null,reopen_criteria:''};}
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
const identity=(v:unknown)=>typeof v==='string'&&uuid.test(v);
const nullableId=(v:unknown)=>v===null||identity(v);
const date=(v:unknown)=>v===null||validDate(v);
const exact=(v:Record<string,unknown>,keys:string[],optional:string[]=[])=>keys.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>keys.includes(k)||optional.includes(k));
function references(v:unknown,reading:boolean){return Array.isArray(v)&&v.length<=20&&v.every(r=>obj(r)&&exact(r,['label','url','reference_id'])&&text(r.label,200)&&!!r.label.trim()&&text(r.reference_id,200)&&text(r.url,2000)&&(!!safeReferenceUrl(r.url)||reading&&r.url===''));}
/** The server repeats these bounds; incomplete comparisons may be saved before recording an outcome. */
export function decisionWorkflowIssue(value:unknown,update?:Pick<UpdateSave,'reported_decision'|'decision_rationale'|'reported_by_student_ids'>,reading=false):string|null{
 if(value===undefined||value===null)return null;
 if(!obj(value)||!exact(value,['schema_version','status','owner_id','target_date','decided_on','requirements','options','chosen_option_id','reopen_criteria'],['trade_study'])||value.schema_version!==1||(typeof value.status!=='string'||!Object.hasOwn(decisionStatusLabels,value.status)))return 'This comparison has an unsupported format. Refresh before editing.';
 if(!nullableId(value.owner_id)||!date(value.target_date)||!date(value.decided_on))return 'Choose a student owner and valid calendar dates.';
 if(!references(value.requirements,reading))return 'Each requirement needs a source label and safe http or https link. Preserve its existing source ID.';
 if(!Array.isArray(value.options)||value.options.length<1||value.options.length>6)return 'Keep between one and six options in this comparison.';
 const ids=new Set<string>(),canonicalIds=new Set<string>();
 for(const option of value.options){
  if(!obj(option)||!exact(option,['id','label','description',...decisionDimensions,'evidence'],['swot'])||!identity(option.id)||canonicalIds.has(option.id.toLowerCase()))return 'Each option needs its own valid identity. Refresh before saving.';
  ids.add(option.id);canonicalIds.add(option.id.toLowerCase());
  if(!text(option.label,200)||!option.label.trim()||!text(option.description,2000))return 'Give every option a name of up to 200 characters and a description of up to 2,000 characters.';
  if(!decisionDimensions.every(k=>text(option[k],1000)))return 'Keep each weight, space, cost, reliability, and time note within 1,000 characters.';
  if(option.swot!==undefined&&option.swot!==null&&(!obj(option.swot)||!exact(option.swot,['strengths','weaknesses','opportunities','threats'])||!['strengths','weaknesses','opportunities','threats'].every(k=>text(option.swot[k],2000))))return 'Keep each optional SWOT note within 2,000 characters.';
  if(!references(option.evidence,reading))return 'Each option evidence link needs a label and safe http or https link.';
 }
 const tradeIssue=tradeStudyIssue(value.trade_study,[...ids],reading);if(tradeIssue)return tradeIssue;
 if(!nullableId(value.chosen_option_id)||value.chosen_option_id!==null&&!ids.has(value.chosen_option_id))return 'Choose an option from this comparison.';
 if(!text(value.reopen_criteria,2000))return 'Keep reopen criteria within 2,000 characters.';
 if(value.status==='recorded'&&(!value.owner_id||!value.decided_on||!value.chosen_option_id||!value.reopen_criteria.trim()||update&&(!update.reported_decision.trim()||!update.decision_rationale.trim()||!update.reported_by_student_ids.length)))return 'To record the decision, add the student owner, decision date, chosen option, reported choice, rationale, student participants, and reopen criteria. You can save as Comparing options meanwhile.';
 return null;
}
export function normalizeDecisionWorkflow(value:unknown):unknown{
 if(!obj(value))return value;
 const refs=(rows:unknown)=>Array.isArray(rows)?rows.map(r=>obj(r)&&typeof r.url==='string'?{...r,url:safeReferenceUrl(r.url)?r.url:''}:r):rows;
 return {...value,...(typeof value.owner_id==='string'&&uuid.test(value.owner_id)?{owner_id:value.owner_id.toLowerCase()}:{}),...(obj(value.trade_study)?{trade_study:{...value.trade_study,assessments:Array.isArray(value.trade_study.assessments)?value.trade_study.assessments.map(a=>obj(a)?{...a,evidence:refs(a.evidence)}:a):value.trade_study.assessments}}:{}),requirements:refs(value.requirements),options:Array.isArray(value.options)?value.options.map(o=>obj(o)?{...o,evidence:refs(o.evidence)}:o):value.options};
}
export function cloneDecisionWorkflow(value:DecisionWorkflow|null|undefined):DecisionWorkflow|null|undefined{return value==null?value:structuredClone(value);}
