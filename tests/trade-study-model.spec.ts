import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import type {DecisionOption,EngineeringTradeStudy,TradeAssessment,TradeCriterion} from '../src/planning/reviews/decision-types';

const id=(value:number)=>`dddddddd-dddd-dddd-dddd-${String(value).padStart(12,'0')}`;
const optionIds=[id(1),id(2)];
const criterion=(patch:Partial<TradeCriterion>={}):TradeCriterion=>({id:id(10),label:'Mass',unit:'kg',weight:3,scale_min:0,scale_max:10,direction:'lower',must_have:false,minimum:null,maximum:null,...patch});
const assessment=(patch:Partial<TradeAssessment>={}):TradeAssessment=>({option_id:optionIds[0],criterion_id:id(10),value:2,reason:'Bench measurement ±0.1 kg',evidence:[{label:'Bench log',url:'https://example.com/bench',reference_id:'TEST-17'}],...patch});
const study=():EngineeringTradeStudy=>({criteria:[criterion(),criterion({id:id(11),label:'Capacity',unit:'pieces',weight:1,scale_min:0,scale_max:20,direction:'higher'})],assessments:[assessment(),assessment({criterion_id:id(11),value:10})]});
const options:DecisionOption[]=optionIds.map((optionId,index)=>({id:optionId,label:`Option ${index+1}`,description:'',weight:'',space:'',cost:'',reliability:'',time:'',evidence:[]}));
let directory='',api:any;
test.beforeAll(()=>{
 directory=mkdtempSync(join(tmpdir(),'trade-study-model-'));
 const outfile=join(directory,'model.cjs');
 buildSync({stdin:{contents:`export * from './src/planning/reviews/trade-study';export * from './src/planning/reviews/TradeStudyEditor';export * from './src/planning/reviews/TradeStudySummary';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',jsx:'automatic',loader:{'.css':'empty'},outfile,logLevel:'silent'});
 api=createRequire(import.meta.url)(outfile);
});
test.afterAll(()=>rmSync(directory,{recursive:true,force:true}));

test('optional and empty studies remain valid drafts with no manufactured total',()=>{
 for(const value of [null,undefined,{criteria:[],assessments:[]}])expect(api.tradeStudyIssue(value,optionIds)).toBeNull();
 const result=api.tradeStudyResults({criteria:[],assessments:[]},optionIds);
 expect(result).toMatchObject({weight_sum:0,weighted_criterion_count:0});
 for(const option of result.options)expect(option).toMatchObject({total:null,known_count:0,criterion_count:0,weight_coverage:null,must_have:'not-required'});
 expect(api.tradeStudyIssue(study(),optionIds)).toBeNull();
});

test('strict shape, bounded names, units, weights, scales and identities are enforced',()=>{
 const edits=[
  (value:any)=>value.unrequested='extra',
  (value:any)=>delete value.assessments,
  (value:any)=>value.criteria[0].score=100,
  (value:any)=>delete value.criteria[0].unit,
  (value:any)=>value.criteria[0].id='mass',
  (value:any)=>value.criteria[1].id=value.criteria[0].id,
  (value:any)=>value.criteria[1].id=value.criteria[0].id.toUpperCase(),
  (value:any)=>value.criteria[0].label=' ',
  (value:any)=>value.criteria[0].label='m'.repeat(201),
  (value:any)=>value.criteria[0].unit='\n',
  (value:any)=>value.criteria[0].unit='m'.repeat(51),
  ...[-1,1001,NaN,Infinity,'3',null].map(weight=>(value:any)=>value.criteria[0].weight=weight),
  ...[NaN,Infinity,-Infinity,-1e12-1,1e12+1,'5',null].map(scale=>(value:any)=>value.criteria[0].scale_min=scale),
  (value:any)=>value.criteria[0].scale_max=0,
  (value:any)=>value.criteria[0].scale_max=-1,
  (value:any)=>value.criteria[0].direction='highest',
  (value:any)=>value.criteria[0].direction=['higher'],
  (value:any)=>value.criteria[0].must_have='true',
 ];
 for(const edit of edits){const value=study();edit(value);expect(api.tradeStudyIssue(value,optionIds)).not.toBeNull();}
 const edge={criteria:[criterion({label:'m'.repeat(200),unit:'m'.repeat(50),weight:1000,scale_min:-1e12,scale_max:1e12})],assessments:[]};
 expect(api.tradeStudyIssue(edge,optionIds)).toBeNull();
});

test('eight criteria and 48 unique option/criterion measurements are accepted but not exceeded',()=>{
 const ids=Array.from({length:6},(_,index)=>id(index+1));
 const criteria=Array.from({length:8},(_,index)=>criterion({id:id(10+index)}));
 const assessments=ids.flatMap(option_id=>criteria.map(({id:criterion_id})=>assessment({option_id,criterion_id})));
 expect(api.tradeStudyIssue({criteria,assessments},ids)).toBeNull();
 expect(api.tradeStudyIssue({criteria:[...criteria,criterion({id:id(18)})],assessments},ids)).toContain('eight');
 expect(api.tradeStudyIssue({criteria,assessments:[...assessments,assessments[0]]},ids)).toContain('48');
});

test('measurements have exact existing references, nullable finite values and unique pairs',()=>{
 const edits=[
  (value:any)=>value.assessments.push(value.assessments[0]),
  (value:any)=>value.assessments[0].option_id=id(99),
  (value:any)=>value.assessments[0].criterion_id=id(99),
  (value:any)=>value.assessments[0].option_id=optionIds[0].toUpperCase(),
  (value:any)=>value.assessments[0].weighted_score=10,
  (value:any)=>delete value.assessments[0].reason,
  (value:any)=>value.assessments[0].reason='x'.repeat(2001),
  ...[NaN,Infinity,-Infinity,-1e12-1,1e12+1,'2',undefined].map(raw=>(value:any)=>value.assessments[0].value=raw),
 ];
 for(const edit of edits){const value=study();edit(value);expect(api.tradeStudyIssue(value,optionIds)).not.toBeNull();}
 for(const raw of [null,-1e12,0,1e12]){const value=study();value.assessments[0].value=raw;expect(api.tradeStudyIssue(value,optionIds)).toBeNull();}
});

test('must-have constraints require explicit bounds, reject conflicts, and allow inclusive equal limits',()=>{
 const invalid=[
  {minimum:1},
  {maximum:4},
  {must_have:true},
  {must_have:true,minimum:4,maximum:2},
  {must_have:true,minimum:Infinity},
  {must_have:true,minimum:'2'},
  {must_have:true,minimum:-1e12-1},
  {must_have:true,maximum:1e12+1},
 ];
 for(const patch of invalid)expect(api.tradeStudyIssue({criteria:[criterion(patch as any)],assessments:[]},optionIds)).not.toBeNull();
 const equal={criteria:[criterion({must_have:true,minimum:2,maximum:2})],assessments:[assessment()]};
 expect(api.tradeStudyIssue(equal,optionIds)).toBeNull();
 expect(api.tradeStudyResults(equal,optionIds).options[0].must_have).toBe('met');
 expect(api.tradeStudyResults(equal,optionIds).options[1].must_have).toBe('unknown');
 const invalidDraft={criteria:[criterion({must_have:true,minimum:4,maximum:2})],assessments:[assessment()]};
 expect(api.tradeStudyResults(invalidDraft,optionIds).options[0].must_have).toBe('unknown');
});

test('linear desirability uses raw units, direction and normalized weights',()=>{
 const value=study(),before=structuredClone(value),result=api.tradeStudyResults(value,optionIds);
 expect(result.weight_sum).toBe(4);
 expect(result.options[0]).toMatchObject({known_count:2,criterion_count:2,weighted_known_count:2,weighted_criterion_count:2,weight_coverage:1,total:72.5,must_have:'not-required'});
 expect(result.options[0].criteria[0]).toMatchObject({raw_value:2,score:80,normalized_weight:.75,out_of_scale:false});
 expect(result.options[0].criteria[1]).toMatchObject({raw_value:10,score:50,normalized_weight:.25});
 expect(result.options[1]).toMatchObject({known_count:0,total:null,weight_coverage:0});
 expect(value).toEqual(before);
 const signed={criteria:[criterion({scale_min:-10,scale_max:10,direction:'higher'})],assessments:[assessment({value:0})]};
 expect(api.tradeStudyResults(signed,optionIds).options[0].total).toBe(50);
});

test('out-of-scale values retain their raw measurement, clamp desirability, and visibly flag both directions',()=>{
 for(const direction of ['lower','higher'])for(const raw of [-4,15]){
  const value={criteria:[criterion({direction:direction as 'lower'|'higher'})],assessments:[assessment({value:raw})]};
  const result=api.tradeStudyResults(value,optionIds).options[0];
  const expected=direction==='lower'?(raw<0?100:0):(raw<0?0:100);
  expect(result).toMatchObject({total:expected,out_of_scale_count:1});
  expect(result.criteria[0]).toMatchObject({raw_value:raw,score:expected,out_of_scale:true});
 }
 for(const raw of [0,10])expect(api.tradeStudyResults({criteria:[criterion()],assessments:[assessment({value:raw})]},optionIds).options[0].criteria[0].out_of_scale).toBe(false);
});

test('unknown values suppress partial totals while retaining explicit counts and weight coverage',()=>{
 const value=study();value.assessments[1].value=null;
 const result=api.tradeStudyResults(value,optionIds).options[0];
 expect(result).toMatchObject({total:null,known_count:1,weighted_known_count:1,weighted_criterion_count:2,weight_coverage:.75});
 expect(result.criteria[1]).toMatchObject({raw_value:null,score:null});
 value.assessments=value.assessments.slice(0,1);
 expect(api.tradeStudyResults(value,optionIds).options[0]).toMatchObject({total:null,known_count:1,weighted_known_count:1,weighted_criterion_count:2,weight_coverage:.75});
});

test('zero weights do not require measurements, but zero total weight cannot manufacture a total',()=>{
 const value=study();value.criteria[1].weight=0;value.assessments=value.assessments.slice(0,1);
 expect(api.tradeStudyResults(value,optionIds).options[0]).toMatchObject({total:80,known_count:1,criterion_count:2,weighted_criterion_count:1,weight_coverage:1});
 value.criteria[0].weight=0;
 expect(api.tradeStudyIssue(value,optionIds)).toBeNull();
 expect(api.tradeStudyResults(value,optionIds).options[0]).toMatchObject({total:null,weight_coverage:null,weighted_criterion_count:0});
});

test('hard failures and unknown hard constraints are independent of totals including zero-weight criteria',()=>{
 const value=study();value.criteria[0]={...value.criteria[0],must_have:true,maximum:1};
 expect(api.tradeStudyResults(value,optionIds).options[0]).toMatchObject({total:72.5,must_have:'failed',failed_must_have_count:1});
 value.criteria[1]={...value.criteria[1],must_have:true,minimum:5,weight:0};value.assessments[1].value=null;
 expect(api.tradeStudyResults(value,optionIds).options[0]).toMatchObject({total:80,must_have:'failed',failed_must_have_count:1,unknown_must_have_count:1});
 value.criteria[0].maximum=3;
 expect(api.tradeStudyResults(value,optionIds).options[0]).toMatchObject({total:80,must_have:'unknown',failed_must_have_count:0,unknown_must_have_count:1});
 const outsideLimit={criteria:[criterion({direction:'higher',must_have:true,minimum:95})],assessments:[assessment({value:11})]};
 expect(api.tradeStudyResults(outsideLimit,optionIds).options[0]).toMatchObject({total:100,must_have:'failed',out_of_scale_count:1});
});

test('results retain caller order without ranking or choosing an option even when one score is higher',()=>{
 const value=study();value.assessments.push(assessment({option_id:optionIds[1],value:0}),assessment({option_id:optionIds[1],criterion_id:id(11),value:20}));
 const result=api.tradeStudyResults(value,optionIds);
 expect(result.options.map((option:any)=>option.option_id)).toEqual(optionIds);
 expect(result.options.map((option:any)=>option.total)).toEqual([72.5,100]);
 expect(api.tradeStudyResults(value,[...optionIds].reverse()).options.map((option:any)=>option.option_id)).toEqual([...optionIds].reverse());
 expect(JSON.stringify(result)).not.toMatch(/winner|recommend|chosen|rank/);
});

test('evidence validates bounded safe references and read sanitation preserves history without mutating input',()=>{
 const unsafe=['javascript:alert(1)','https://user:password@example.com','https://example.com:bad','https://example.com/a\nb','https://example.com\\evil','ftp://example.com'];
 for(const url of unsafe){
  const value=study();value.assessments[0].evidence[0].url=url;
  expect(api.tradeStudyIssue(value,optionIds)).toContain('evidence');
  expect(api.tradeStudyIssue(value,optionIds,true)).toContain('evidence');
  const read=api.normalizeTradeStudy(value);
  expect(read.assessments[0].evidence[0]).toEqual({label:'Bench log',reference_id:'TEST-17',url:''});
  expect(value.assessments[0].evidence[0].url).toBe(url);
  expect(api.tradeStudyIssue(read,optionIds,true)).toBeNull();
  expect(api.tradeStudyIssue(read,optionIds)).toContain('evidence');
 }
 const invalid=[
  (reference:any)=>reference.extra='secret',
  (reference:any)=>delete reference.reference_id,
  (reference:any)=>reference.label=' ',
  (reference:any)=>reference.label='x'.repeat(201),
  (reference:any)=>reference.reference_id='x'.repeat(201),
  (reference:any)=>reference.url='https://example.com/'+'x'.repeat(2000),
 ];
 for(const edit of invalid){const value=study();edit(value.assessments[0].evidence[0]);expect(api.tradeStudyIssue(value,optionIds)).not.toBeNull();}
 const value=study();value.assessments[0].evidence=Array(20).fill(value.assessments[0].evidence[0]);expect(api.tradeStudyIssue(value,optionIds)).toBeNull();value.assessments[0].evidence.push(value.assessments[0].evidence[0]);expect(api.tradeStudyIssue(value,optionIds)).not.toBeNull();
 const malformed={...study(),secret:'unexpected'};expect(api.tradeStudyIssue(api.normalizeTradeStudy(malformed),optionIds,true)).not.toBeNull();
});

test('read-only summary exposes units, scoring rules, unknowns and hard failures without unsafe actions',()=>{
 const value=study();value.criteria[0]={...value.criteria[0],must_have:true,maximum:1};value.assessments[0].reason='<script>do not run</script>';
 value.assessments[0].evidence[0].url='javascript:alert(1)';
 const html=api.renderToStaticMarkup(api.createElement(api.TradeStudySummary,{value,options}));
 expect(html).toContain('2 kg');expect(html).toContain('72.5 / 100');expect(html).toContain('Does not meet must-have');expect(html).toContain('Must-have not verified');expect(html).toContain('Weighted total unavailable');expect(html).toContain('0 of 2 measurements known');expect(html).toContain('Lower is better');expect(html).toContain('100');expect(html).toContain('Weights are normalized by their sum');
 expect(html).toContain('&lt;script&gt;do not run&lt;/script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('href="javascript:');expect(html).toContain('Bench log · link unavailable');expect(html).not.toMatch(/Recommended option|Winner|Best option/);
});

test('compact final-choice summary retains failed, unverified and out-of-range warnings',()=>{
 const value=study();value.criteria[0]={...value.criteria[0],must_have:true,maximum:1};value.assessments[0].value=12;
 const html=api.renderToStaticMarkup(api.createElement(api.TradeStudySummary,{value,options,compact:true}));
 expect(html).toContain('Does not meet must-have');expect(html).toContain('Must-have not verified');expect(html).toContain('Outside comparison range; score capped');expect(html).toContain('at most 1 kg');expect(html).toContain('12 kg');expect(html).not.toContain('Trade study criteria and scales');
});

test('editor starts opt-in and exposes bounded, labelled controls and optional engineering starters',()=>{
 let html=api.renderToStaticMarkup(api.createElement(api.TradeStudyEditor,{value:null,options,onChange:()=>{}}));
 expect(html).toContain('Add engineering trade study');expect(html).not.toContain('Criterion 1 name');
 html=api.renderToStaticMarkup(api.createElement(api.TradeStudyEditor,{value:study(),options,onChange:()=>{}}));
 for(const label of ['Criterion 1 name','Criterion 1 unit','Criterion 1 comparison range low','Criterion 1 comparison range high','Criterion 1 weight','Criterion 1 direction','Option 1 Mass raw value','Option 1 Mass measurement notes','Optional engineering starter'])expect(html).toContain(label);
 expect(html).toContain('Starter scales are editable examples');expect(html).toContain('placeholder="Unknown"');expect(html).toContain('max="1000000000000"');expect(html).toContain('maxLength="2000"');
 for(const name of ['Mass','Cycle time','Capacity','Packaging dimension','Manufacturing effort','Reliability'])expect(api.engineeringCriterionStarters.some((starter:any)=>starter.label===name)).toBe(true);
 expect(api.engineeringCriterionStarters.every((starter:any)=>starter.must_have===false&&starter.minimum===null&&starter.maximum===null)).toBe(true);
});

test('raw display preserves very small measured values rather than rounding them to zero',()=>{
 expect(api.formatTradeNumber(.000000000001)).not.toBe('0');
 expect(api.formatTradeNumber(Number.MIN_VALUE)).not.toBe('0');
 for(const raw of [1e-9,Number.MIN_VALUE,1e12,-1e-14,1.2345678901234567])expect(Number(api.formatTradeNumber(raw))).toBe(raw);
 expect(api.tradeCriterionScaleText(criterion())).toBe('Lower is better. 0 kg = 100; 10 kg = 0.');
 expect(api.tradeCriterionLimitText(criterion({must_have:true,minimum:2,maximum:4}))).toBe('Must have: at least 2 kg and at most 4 kg');
});
