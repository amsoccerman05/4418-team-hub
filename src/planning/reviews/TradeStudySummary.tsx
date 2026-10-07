import {ArrowUpRight,Link2} from 'lucide-react';
import type {DecisionOption,EngineeringTradeStudy} from './decision-types';
import {safeReferenceUrl} from './model';
import {formatTradeNumber,mustHaveLabels,tradeCriterionLimitText,tradeCriterionScaleText,tradeStudyResults} from './trade-study';
import type {MustHaveState,TradeOptionResult} from './trade-study';
import './trade-study.css';

const score=(value:number)=>value.toFixed(1).replace(/\.0$/,'');

export function MustHaveBadge({state}:{state:MustHaveState}){
 return state==='not-required'?null:<span className={`sr-trade-badge is-${state}`}>{mustHaveLabels[state]}</span>;
}

export function TradeOptionTotals({result}:{result:TradeOptionResult}){
 return <div className="sr-trade-totals">
  <p><strong>{result.total===null?'Weighted total unavailable':`${score(result.total)} / 100`}</strong>{result.total!==null&&<span> weighted total</span>}</p>
  <p>{result.known_count} of {result.criterion_count} measurements known. {result.weighted_criterion_count===0?'Set at least one positive weight to calculate a total.':`${result.weighted_known_count} of ${result.weighted_criterion_count} weighted criteria assessed (${score((result.weight_coverage||0)*100)}% weight coverage).`}</p>
  <MustHaveBadge state={result.must_have}/>
  {result.failed_must_have_count>0&&result.unknown_must_have_count>0&&<span className="sr-trade-badge is-unknown">{result.unknown_must_have_count} other must-have {result.unknown_must_have_count===1?'not verified':'limits not verified'}</span>}
  {result.out_of_scale_count>0&&<p>{result.out_of_scale_count} {result.out_of_scale_count===1?'value is':'values are'} outside the comparison range; desirability capped.</p>}
 </div>;
}

export function TradeStudySummary({value,options,compact=false}:{value:EngineeringTradeStudy;options:DecisionOption[];compact?:boolean}){
 const result=tradeStudyResults(value,options.map(option=>option.id));
 return <section className="sr-trade-summary" aria-label="Engineering trade study results">
  <h4>Engineering trade study</h4>
  {!compact&&<p className="sr-caption">Raw measurements use each criterion’s unit. The chosen low and high values map linearly to desirability from 0 to 100; direction sets which end is better. Values outside the range are capped at 0 or 100 and flagged. Weights are normalized by their sum.</p>}
  <p className="sr-caption">A total is shown only when every positive-weight criterion has a value. Must-have limits are checked against raw values independently of scores. Students choose the option and explain their reasoning.</p>
  {value.criteria.length===0?<p className="sr-empty-field">No engineering criteria added yet.</p>:<>
   {!compact&&<div className="sr-trade-scale-list" aria-label="Trade study criteria and scales">{value.criteria.map(criterion=><div key={criterion.id}>
    <h5>{criterion.label||'Unnamed criterion'} <span>({criterion.unit||'unit needed'})</span></h5>
    <p>{tradeCriterionScaleText(criterion)}</p>
    <p>Weight {formatTradeNumber(criterion.weight)}{result.weight_sum>0?` (${score(criterion.weight/result.weight_sum*100)}% of total weight)`:'; total weights are zero'}. {tradeCriterionLimitText(criterion)}.</p>
   </div>)}</div>}
   <div className="sr-trade-result-options">{options.map((option,index)=>{const optionResult=result.options[index];return <article key={option.id} className="sr-trade-result-option">
    <h5>{option.label||`Option ${index+1}`}</h5><TradeOptionTotals result={optionResult}/>
    <dl>{value.criteria.map((criterion,criterionIndex)=>{const measurement=optionResult.criteria[criterionIndex];if(compact&&!measurement.out_of_scale&&measurement.must_have!=='failed'&&measurement.must_have!=='unknown')return null;return <div key={criterion.id} className="sr-trade-measurement-summary">
     <dt>{criterion.label||`Criterion ${criterionIndex+1}`}</dt>
     <dd><strong>{measurement.raw_value===null?'Unknown':`${formatTradeNumber(measurement.raw_value)} ${criterion.unit}`}</strong><span>{measurement.score===null?' · desirability unknown':` · ${score(measurement.score)} / 100 desirability`}</span>
      {measurement.out_of_scale&&<span className="sr-trade-badge is-outside">Outside comparison range; score capped</span>}
      <MustHaveBadge state={measurement.must_have}/>
      {compact&&<p>{tradeCriterionLimitText(criterion)}.</p>}
      {!compact&&measurement.reason&&<p className="sr-trade-note">{measurement.reason}</p>}
      {!compact&&measurement.evidence.length>0&&<ul className="sr-references" aria-label={`${option.label} ${criterion.label} evidence`}>{measurement.evidence.map((source,sourceIndex)=>{const url=safeReferenceUrl(source.url);return <li key={sourceIndex}><Link2 size={13}/><div>{url?<a href={url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowUpRight size={12}/></a>:<span>{source.label} · link unavailable</span>}{source.reference_id&&<small>{source.reference_id}</small>}</div></li>;})}</ul>}
     </dd>
    </div>;})}</dl>
   </article>;})}</div>
  </>}
 </section>;
}
