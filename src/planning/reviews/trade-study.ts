import type {EngineeringTradeStudy,TradeCriterion} from './decision-types';
import type {ReviewReference} from './types';
import {safeReferenceUrl,uuid} from './model';

export const tradeStudyLimits={criteria:8,assessments:48,rawValue:1e12,weight:1000} as const;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max;
const identity=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
const measurement=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=tradeStudyLimits.rawValue;
const bound=(value:unknown)=>value===null||measurement(value);
function references(value:unknown,reading:boolean){
 return Array.isArray(value)&&value.length<=20&&value.every(row=>object(row)&&exact(row,['label','url','reference_id'])&&text(row.label,200)&&!!row.label.trim()&&text(row.reference_id,200)&&text(row.url,2000)&&(!!safeReferenceUrl(row.url)||reading&&row.url===''));
}

/** Drafts may have no criteria or no measurements. They may never invent a score. */
export function tradeStudyIssue(value:unknown,optionIds:string[],reading=false):string|null{
 if(value===undefined||value===null)return null;
 if(!object(value)||!exact(value,['criteria','assessments']))return 'This engineering trade study has an unsupported format. Refresh before editing.';
 if(!Array.isArray(value.criteria)||value.criteria.length>tradeStudyLimits.criteria)return 'Keep at most eight engineering criteria in one trade study.';
 const criterionIds=new Set<string>(),canonicalIds=new Set<string>();
 for(const criterion of value.criteria){
  if(!object(criterion)||!exact(criterion,['id','label','unit','weight','scale_min','scale_max','direction','must_have','minimum','maximum'])||!identity(criterion.id)||canonicalIds.has(criterion.id.toLowerCase()))return 'Each engineering criterion needs its own valid identity. Refresh before saving.';
  criterionIds.add(criterion.id);canonicalIds.add(criterion.id.toLowerCase());
  if(!text(criterion.label,200)||!criterion.label.trim()||!text(criterion.unit,50)||!criterion.unit.trim())return 'Give every engineering criterion a name (up to 200 characters) and unit (up to 50 characters).';
  if(typeof criterion.weight!=='number'||!Number.isFinite(criterion.weight)||criterion.weight<0||criterion.weight>tradeStudyLimits.weight)return 'Criterion weights must be numbers from 0 to 1,000. Zero excludes a criterion from the weighted total.';
  if(!measurement(criterion.scale_min)||!measurement(criterion.scale_max)||criterion.scale_min>=criterion.scale_max||criterion.direction!=='higher'&&criterion.direction!=='lower')return 'Each criterion needs a numeric comparison range with the low end below the high end, and a higher-is-better or lower-is-better direction. Values must be between −1 trillion and 1 trillion.';
  if(typeof criterion.must_have!=='boolean'||!bound(criterion.minimum)||!bound(criterion.maximum))return 'Must-have limits must be numeric values between −1 trillion and 1 trillion, or left blank.';
  if(criterion.must_have){
   if(criterion.minimum===null&&criterion.maximum===null)return 'Add a minimum or maximum for every must-have criterion.';
   if(typeof criterion.minimum==='number'&&typeof criterion.maximum==='number'&&criterion.minimum>criterion.maximum)return 'A must-have minimum cannot exceed its maximum.';
  }else if(criterion.minimum!==null||criterion.maximum!==null)return 'Enable must-have before adding a hard minimum or maximum.';
 }
 if(!Array.isArray(value.assessments)||value.assessments.length>tradeStudyLimits.assessments)return 'Keep at most 48 engineering measurements in one trade study.';
 const optionSet=new Set(optionIds),pairs=new Set<string>();
 for(const assessment of value.assessments){
  if(!object(assessment)||!exact(assessment,['option_id','criterion_id','value','reason','evidence'])||!identity(assessment.option_id)||!identity(assessment.criterion_id)||!optionSet.has(assessment.option_id)||!criterionIds.has(assessment.criterion_id))return 'Every engineering measurement must refer to an option and criterion in this comparison.';
  const pair=assessment.option_id+'|'+assessment.criterion_id;
  if(pairs.has(pair))return 'Use one engineering measurement per option and criterion.';
  pairs.add(pair);
  if(assessment.value!==null&&!measurement(assessment.value))return 'Engineering measurements must be numeric values between −1 trillion and 1 trillion, or left blank when unknown.';
  if(!text(assessment.reason,2000))return 'Keep each engineering measurement note within 2,000 characters.';
  if(!references(assessment.evidence,reading))return 'Each engineering evidence link needs a label and safe http or https link.';
 }
 return null;
}

/** Strip unsafe link actions on read, preserving source labels, IDs, and malformed structure for validation. */
export function normalizeTradeStudy(value:unknown):unknown{
 if(!object(value))return value;
 return {...value,assessments:Array.isArray(value.assessments)?value.assessments.map(row=>object(row)?{...row,evidence:Array.isArray(row.evidence)?row.evidence.map(reference=>object(reference)&&typeof reference.url==='string'?{...reference,url:safeReferenceUrl(reference.url)?reference.url:''}:reference):row.evidence}:row):value.assessments};
}

export type MustHaveState='not-required'|'met'|'failed'|'unknown';
export type TradeCriterionResult={
 criterion_id:string;raw_value:number|null;score:number|null;normalized_weight:number|null;
 out_of_scale:boolean;must_have:MustHaveState;reason:string;evidence:ReviewReference[];
};
export type TradeOptionResult={
 option_id:string;criteria:TradeCriterionResult[];known_count:number;criterion_count:number;
 weighted_known_count:number;weighted_criterion_count:number;weight_coverage:number|null;total:number|null;
 must_have:MustHaveState;failed_must_have_count:number;unknown_must_have_count:number;out_of_scale_count:number;
};
export type TradeStudyResults={weight_sum:number;weighted_criterion_count:number;options:TradeOptionResult[]};

function mustHave(criterion:TradeCriterion,value:number|null):MustHaveState{
 if(!criterion.must_have)return 'not-required';
 if(value===null||!bound(criterion.minimum)||!bound(criterion.maximum)||criterion.minimum===null&&criterion.maximum===null||criterion.minimum!==null&&criterion.maximum!==null&&criterion.minimum>criterion.maximum)return 'unknown';
 return criterion.minimum!==null&&value<criterion.minimum||criterion.maximum!==null&&value>criterion.maximum?'failed':'met';
}

/** Results retain option order. No ranking, selected option, recommendation, or partial weighted total. */
export function tradeStudyResults(value:EngineeringTradeStudy,optionIds:string[]):TradeStudyResults{
 const weightsValid=value.criteria.every(criterion=>Number.isFinite(criterion.weight)&&criterion.weight>=0&&criterion.weight<=tradeStudyLimits.weight);
 const weightSum=weightsValid?value.criteria.reduce((sum,criterion)=>sum+criterion.weight,0):0;
 const weightedCount=value.criteria.filter(criterion=>criterion.weight>0).length;
 const assessments=new Map(value.assessments.map(row=>[row.option_id+'|'+row.criterion_id,row]));
 return {weight_sum:weightSum,weighted_criterion_count:weightedCount,options:optionIds.map(optionId=>{
  const criteria=value.criteria.map(criterion=>{
   const assessment=assessments.get(optionId+'|'+criterion.id),raw=measurement(assessment?.value)?assessment!.value:null;
   const validScale=measurement(criterion.scale_min)&&measurement(criterion.scale_max)&&criterion.scale_min<criterion.scale_max&&(criterion.direction==='higher'||criterion.direction==='lower');
   const position=raw!==null&&validScale?(raw-criterion.scale_min)/(criterion.scale_max-criterion.scale_min):null;
   const desirability=position===null?null:100*Math.max(0,Math.min(1,criterion.direction==='higher'?position:1-position));
   return {criterion_id:criterion.id,raw_value:raw,score:desirability,normalized_weight:weightSum>0?criterion.weight/weightSum:null,out_of_scale:raw!==null&&validScale&&(raw<criterion.scale_min||raw>criterion.scale_max),must_have:mustHave(criterion,raw),reason:assessment?.reason||'',evidence:assessment?.evidence||[]} satisfies TradeCriterionResult;
  });
  const weighted=criteria.filter((_,index)=>value.criteria[index].weight>0),knownWeighted=weighted.filter(row=>row.score!==null);
  const failed=criteria.filter(row=>row.must_have==='failed').length,unknown=criteria.filter(row=>row.must_have==='unknown').length;
  const total=weightSum>0&&knownWeighted.length===weightedCount?Math.max(0,Math.min(100,weighted.reduce((sum,row)=>sum+row.score!*row.normalized_weight!,0))):null;
  return {option_id:optionId,criteria,known_count:criteria.filter(row=>row.raw_value!==null).length,criterion_count:criteria.length,weighted_known_count:knownWeighted.length,weighted_criterion_count:weightedCount,weight_coverage:weightSum>0?knownWeighted.reduce((sum,row)=>sum+row.normalized_weight!,0):null,total,must_have:failed?'failed':unknown?'unknown':criteria.some(row=>row.must_have==='met')?'met':'not-required',failed_must_have_count:failed,unknown_must_have_count:unknown,out_of_scale_count:criteria.filter(row=>row.out_of_scale).length};
 })};
}

export const mustHaveLabels:Record<MustHaveState,string>={'not-required':'No must-have limits',met:'Meets must-have limits',failed:'Does not meet must-have',unknown:'Must-have not verified'};
/** Preserve raw values exactly, including tiny nonzero limits; only desirability is rounded for display. */
export function formatTradeNumber(value:number):string{return Number.isFinite(value)?String(value):'Not set';}
export function tradeCriterionScaleText(criterion:TradeCriterion):string{
 const low=formatTradeNumber(criterion.scale_min),high=formatTradeNumber(criterion.scale_max);
 return `${criterion.direction==='lower'?'Lower':'Higher'} is better. ${low} ${criterion.unit} = ${criterion.direction==='lower'?'100':'0'}; ${high} ${criterion.unit} = ${criterion.direction==='lower'?'0':'100'}.`;
}
export function tradeCriterionLimitText(criterion:TradeCriterion):string{
 if(!criterion.must_have)return 'No must-have limit';
 const limits=[criterion.minimum===null?'':`at least ${formatTradeNumber(criterion.minimum)} ${criterion.unit}`,criterion.maximum===null?'':`at most ${formatTradeNumber(criterion.maximum)} ${criterion.unit}`].filter(Boolean);
 return limits.length?'Must have: '+limits.join(' and '):'Must-have limit needed';
}

export function blankTradeCriterion():TradeCriterion{return {id:crypto.randomUUID(),label:'',unit:'',weight:1,scale_min:0,scale_max:100,direction:'higher',must_have:false,minimum:null,maximum:null};}
/** Optional starting points only. These editable example ranges are never project requirements. */
export const engineeringCriterionStarters:Omit<TradeCriterion,'id'>[]=[
 {label:'Mass',unit:'kg',weight:1,scale_min:0,scale_max:10,direction:'lower',must_have:false,minimum:null,maximum:null},
 {label:'Cycle time',unit:'s',weight:1,scale_min:0,scale_max:60,direction:'lower',must_have:false,minimum:null,maximum:null},
 {label:'Capacity',unit:'pieces',weight:1,scale_min:0,scale_max:10,direction:'higher',must_have:false,minimum:null,maximum:null},
 {label:'Packaging dimension',unit:'mm',weight:1,scale_min:0,scale_max:500,direction:'lower',must_have:false,minimum:null,maximum:null},
 {label:'Manufacturing effort',unit:'h',weight:1,scale_min:0,scale_max:100,direction:'lower',must_have:false,minimum:null,maximum:null},
 {label:'Reliability',unit:'%',weight:1,scale_min:0,scale_max:100,direction:'higher',must_have:false,minimum:null,maximum:null},
];
