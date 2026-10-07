import {Plus,X} from 'lucide-react';
import type {DecisionOption,EngineeringTradeStudy,TradeAssessment,TradeCriterion} from './decision-types';
import {ReferencesEditor} from './DecisionEditor';
import {MustHaveBadge,TradeOptionTotals} from './TradeStudySummary';
import {blankTradeCriterion,engineeringCriterionStarters,tradeCriterionLimitText,tradeCriterionScaleText,tradeStudyIssue,tradeStudyLimits,tradeStudyResults} from './trade-study';
import './trade-study.css';

const numeric=(value:number|null)=>value===null||!Number.isFinite(value)?'':value;
const numberBounds={min:-tradeStudyLimits.rawValue,max:tradeStudyLimits.rawValue,step:'any'};

export function TradeStudyEditor({value,options,onChange}:{value:EngineeringTradeStudy|null|undefined;options:DecisionOption[];onChange:(value:EngineeringTradeStudy|null)=>void}){
 if(!value)return <section className="sr-comparison-invite sr-trade-invite" aria-label="Engineering trade study">
  <h3>Engineering trade study</h3><p>Compare measured or estimated values in shared units, with weights, explicit scales and must-have limits. Leave anything untested unknown.</p>
  <button type="button" onClick={()=>onChange({criteria:[],assessments:[]})}><Plus size={14}/>Add engineering trade study</button>
 </section>;
 const study=value,results=tradeStudyResults(study,options.map(option=>option.id)),issue=tradeStudyIssue(study,options.map(option=>option.id));
 function changeCriterion(id:string,patch:Partial<TradeCriterion>){onChange({...study,criteria:study.criteria.map(criterion=>criterion.id===id?{...criterion,...patch}:criterion)});}
 function removeCriterion(id:string){onChange({...study,criteria:study.criteria.filter(criterion=>criterion.id!==id),assessments:study.assessments.filter(assessment=>assessment.criterion_id!==id)});}
 function addCriterion(criterion=blankTradeCriterion()){if(study.criteria.length<tradeStudyLimits.criteria)onChange({...study,criteria:[...study.criteria,criterion]});}
 function changeAssessment(optionId:string,criterionId:string,patch:Partial<TradeAssessment>){
  const existing=study.assessments.find(assessment=>assessment.option_id===optionId&&assessment.criterion_id===criterionId);
  const next:TradeAssessment={option_id:optionId,criterion_id:criterionId,value:null,reason:'',evidence:[],...existing,...patch};
  onChange({...study,assessments:existing?study.assessments.map(assessment=>assessment===existing?next:assessment):[...study.assessments,next]});
 }
 return <section className="sr-trade-editor" aria-label="Engineering trade study editor">
  <header className="sr-trade-heading"><div><h3>Engineering trade study</h3><p className="sr-caption">Agree on criteria and units first, then enter each option’s raw values and evidence.</p></div><button type="button" className="sr-icon-button" aria-label="Remove engineering trade study" onClick={()=>onChange(null)}><X size={16}/></button></header>
  <p className="sr-caption">Scores map the comparison range linearly to 0–100 and are capped outside it. Higher or lower is better sets the direction. Weights are divided by their sum; a zero weight excludes a criterion from the total. Unknown values stay unknown.</p>
  <div className="sr-decision-option-heading"><h4>1. Criteria and comparison scales</h4><span>{study.criteria.length} of {tradeStudyLimits.criteria}</span></div>
  {study.criteria.length===0&&<p className="sr-empty-field">Add a criterion that matters to this design choice.</p>}
  <div className="sr-trade-criteria">{study.criteria.map((criterion,index)=><fieldset key={criterion.id} className="sr-trade-criterion"><legend>Criterion {index+1}</legend>
   <div className="sr-trade-criterion-heading"><label>Criterion {index+1} name<input required maxLength={200} value={criterion.label} placeholder="e.g. Mass" onChange={event=>changeCriterion(criterion.id,{label:event.target.value})}/></label><button type="button" className="sr-icon-button" aria-label={`Remove criterion ${index+1}`} onClick={()=>removeCriterion(criterion.id)}><X size={16}/></button></div>
   <div className="sr-trade-field-grid">
    <label>Unit<input aria-label={`Criterion ${index+1} unit`} required maxLength={50} value={criterion.unit} placeholder="kg, s, mm…" onChange={event=>changeCriterion(criterion.id,{unit:event.target.value})}/></label>
    <label>Weight<input aria-label={`Criterion ${index+1} weight`} type="number" min={0} max={tradeStudyLimits.weight} step="any" required value={numeric(criterion.weight)} onChange={event=>changeCriterion(criterion.id,{weight:event.target.valueAsNumber})}/></label>
    <label>Direction<select aria-label={`Criterion ${index+1} direction`} value={criterion.direction} onChange={event=>changeCriterion(criterion.id,{direction:event.target.value as TradeCriterion['direction']})}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></label>
    <label>Comparison range low<input aria-label={`Criterion ${index+1} comparison range low`} type="number" {...numberBounds} required value={numeric(criterion.scale_min)} onChange={event=>changeCriterion(criterion.id,{scale_min:event.target.valueAsNumber})}/></label>
    <label>Comparison range high<input aria-label={`Criterion ${index+1} comparison range high`} type="number" {...numberBounds} required value={numeric(criterion.scale_max)} onChange={event=>changeCriterion(criterion.id,{scale_max:event.target.valueAsNumber})}/></label>
   </div>
   <p className="sr-trade-scale-explanation">{tradeCriterionScaleText(criterion)} {results.weight_sum>0?`${(criterion.weight/results.weight_sum*100).toFixed(1)}% of total weight.`:'No weighted total until at least one weight is positive.'}</p>
   <label className="sr-trade-checkbox"><input type="checkbox" checked={criterion.must_have} onChange={event=>changeCriterion(criterion.id,{must_have:event.target.checked,...(!event.target.checked?{minimum:null,maximum:null}:{})})}/>Criterion {index+1} is a must-have</label>
   {criterion.must_have&&<div className="sr-trade-constraints"><p className="sr-caption">Set at least one hard limit in {criterion.unit||'the criterion’s unit'}. Limits are independent of the comparison scale and weighted total.</p><div className="sr-trade-field-grid">
    <label>Must-have minimum<input aria-label={`Criterion ${index+1} must-have minimum`} type="number" {...numberBounds} value={numeric(criterion.minimum)} placeholder="No minimum" onChange={event=>changeCriterion(criterion.id,{minimum:event.target.value===''?null:event.target.valueAsNumber})}/></label>
    <label>Must-have maximum<input aria-label={`Criterion ${index+1} must-have maximum`} type="number" {...numberBounds} value={numeric(criterion.maximum)} placeholder="No maximum" onChange={event=>changeCriterion(criterion.id,{maximum:event.target.value===''?null:event.target.valueAsNumber})}/></label>
   </div></div>}
  </fieldset>)}</div>
  <div className="sr-trade-add-controls"><button type="button" disabled={study.criteria.length>=tradeStudyLimits.criteria} onClick={()=>addCriterion()}><Plus size={14}/>Add criterion</button><label>Optional engineering starter<select aria-label="Optional engineering starter" value="" disabled={study.criteria.length>=tradeStudyLimits.criteria} onChange={event=>{const starter=engineeringCriterionStarters[Number(event.target.value)];if(event.target.value!==''&&starter)addCriterion({...starter,id:crypto.randomUUID()});}}><option value="">Choose a criterion…</option>{engineeringCriterionStarters.map((starter,index)=><option key={starter.label} value={index}>{starter.label} ({starter.unit})</option>)}</select></label></div>
  <p className="sr-caption">Starter scales are editable examples, not project requirements. Set meaningful ranges with the team before comparing.</p>
  {issue&&<p className="sr-trade-validation" role="status">{issue}</p>}
  {study.criteria.length>0&&<>
   <h4>2. Measurements, uncertainty and evidence</h4><p className="sr-caption">Use the same unit for every option. Changing a criterion’s unit does not convert existing values; update the measurements to match. Leave a value blank until known. Record the test method, estimate or uncertainty in its notes.</p>
   <div className="sr-trade-assessment-options">{options.map((option,optionIndex)=>{const optionName=option.label||`Option ${optionIndex+1}`,result=results.options[optionIndex];return <fieldset key={option.id} className="sr-trade-assessment-option"><legend>{optionName}</legend>
    {study.criteria.map((criterion,criterionIndex)=>{const assessment=study.assessments.find(row=>row.option_id===option.id&&row.criterion_id===criterion.id),measurement=result.criteria[criterionIndex],criterionName=criterion.label||`Criterion ${criterionIndex+1}`;return <div key={criterion.id} className="sr-trade-assessment">
     <div className="sr-trade-measurement-row"><label>{criterionName} ({criterion.unit||'unit needed'})<input aria-label={`${optionName} ${criterionName} raw value`} type="number" {...numberBounds} value={numeric(assessment?.value??null)} placeholder="Unknown" onChange={event=>changeAssessment(option.id,criterion.id,{value:event.target.value===''?null:event.target.valueAsNumber})}/></label><div className="sr-trade-score"><span>{measurement.score===null?'Desirability unknown':`${measurement.score.toFixed(1).replace(/\.0$/,'')} / 100 desirability`}</span>{measurement.out_of_scale&&<span className="sr-trade-badge is-outside">Outside comparison range; score capped</span>}<MustHaveBadge state={measurement.must_have}/></div></div>
     {criterion.must_have&&<p className="sr-caption">{tradeCriterionLimitText(criterion)}.</p>}
     <details className="sr-trade-evidence"><summary>{`${optionName} ${criterionName} notes and evidence`}</summary><label>Method, estimate or uncertainty<textarea aria-label={`${optionName} ${criterionName} measurement notes`} rows={2} maxLength={2000} value={assessment?.reason||''} onChange={event=>changeAssessment(option.id,criterion.id,{reason:event.target.value})} placeholder="Measured on the bench, supplier spec, untested estimate…"/></label><ReferencesEditor label={`${optionName} ${criterionName} evidence`} rows={assessment?.evidence||[]} onChange={evidence=>changeAssessment(option.id,criterion.id,{evidence})}/></details>
    </div>;})}
    <TradeOptionTotals result={result}/>
   </fieldset>;})}</div>
   <p className="sr-caption">Totals support discussion; they do not select an option. A high score cannot remove a failed or unverified must-have. Record the students’ choice and reasoning in Student decision.</p>
  </>}
 </section>;
}
