import {useId} from 'react';
import {Link2,Plus,X} from 'lucide-react';
import type {DecisionOption,DecisionSwot,DecisionWorkflow} from './decision-types';
import type {ReviewPerson,ReviewReference} from './types';
import {TradeStudyEditor} from './TradeStudyEditor';
import {TradeStudySummary} from './TradeStudySummary';
import './decision.css';

const dimensions=['weight','space','cost','reliability','time'] as const;
const dimensionLabels={weight:'Weight',space:'Space',cost:'Cost',reliability:'Reliability',time:'Time'};
const examples={weight:'e.g. 0.7 kg; estimate',space:'e.g. fits 120 mm envelope',cost:'e.g. $35; supplier quote',reliability:'e.g. 18 / 20 successful runs',time:'e.g. 2 build sessions'};
const swotFields=['strengths','weaknesses','opportunities','threats'] as const;
const emptySwot=():DecisionSwot=>({strengths:'',weaknesses:'',opportunities:'',threats:''});
const swotPrompts={strengths:'What does this option already do well?',weaknesses:'What limitations does this option have?',opportunities:'What future improvement or advantage could it enable?',threats:'What outside change or risk could undermine it?'};

/** The same source shape is used throughout the weekly update. */
export function ReferencesEditor({label,rows,onChange}:{label:string;rows:ReviewReference[];onChange:(rows:ReviewReference[])=>void}){
 return <fieldset className="sr-reference-editor"><legend><Link2 size={14}/>{label}</legend>{rows.map((r,index)=><div className="sr-reference-row" key={index}>
  <label>Source label<input aria-label={`${label} ${index+1} label`} required maxLength={200} value={r.label} onChange={e=>onChange(rows.map((x,i)=>i===index?{...x,label:e.target.value}:x))}/></label>
  <label className="sr-reference-url">Link<input aria-label={`${label} ${index+1} link`} type="url" required maxLength={2000} value={r.url} placeholder="https://…" onChange={e=>onChange(rows.map((x,i)=>i===index?{...x,url:e.target.value}:x))}/></label>
  <label>Source ID <span className="sr-optional">(optional)</span><input aria-label={`${label} ${index+1} source ID`} maxLength={200} value={r.reference_id} placeholder="TEST-17, AD-12…" onChange={e=>onChange(rows.map((x,i)=>i===index?{...x,reference_id:e.target.value}:x))}/></label>
  <button type="button" className="sr-icon-button" aria-label={`Remove ${label.toLowerCase()} ${index+1}`} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}><X size={16}/></button>
 </div>)}<button type="button" disabled={rows.length>=20} onClick={()=>onChange([...rows,{label:'',url:'',reference_id:''}])}><Plus size={14}/>Add {label.toLowerCase()} link</button></fieldset>;
}

export function DecisionEditor({workflow,people,decisionOwner,onChange}:{workflow:DecisionWorkflow;people:ReviewPerson[];decisionOwner?:ReviewPerson|null;onChange:(workflow:DecisionWorkflow)=>void}){
 const id=useId(),eligible=people.filter(p=>p.active&&p.can_write&&p.is_student),owner=people.find(p=>p.id===workflow.owner_id)||(decisionOwner?.id===workflow.owner_id?decisionOwner:null);
 const change=<K extends keyof DecisionWorkflow>(key:K,value:DecisionWorkflow[K])=>onChange({...workflow,[key]:value});
 function optionChange(optionId:string,patch:Partial<DecisionOption>){change('options',workflow.options.map(option=>option.id===optionId?{...option,...patch}:option));}
 function removeOption(optionId:string){onChange({...workflow,options:workflow.options.filter(option=>option.id!==optionId),chosen_option_id:workflow.chosen_option_id===optionId?null:workflow.chosen_option_id,...(workflow.trade_study?{trade_study:{...workflow.trade_study,assessments:workflow.trade_study.assessments.filter(assessment=>assessment.option_id!==optionId)}}:{})});}
 return <section className="sr-decision-editor" aria-label="Design option comparison">
  <p className="sr-caption">Compare one focused design choice for this project and review. Use an engineering trade study for measurable criteria and constraints, with optional observations and SWOT for context. Students make the final choice.</p>
  <div className="sr-form-grid">
   <div className="sr-field"><label htmlFor={`${id}-owner`}>Decision owner</label><select id={`${id}-owner`} value={workflow.owner_id||''} onChange={e=>change('owner_id',e.target.value||null)}><option value="">Choose later</option>{eligible.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}{workflow.owner_id&&!eligible.some(p=>p.id===workflow.owner_id)&&<option value={workflow.owner_id}>{owner?.name||'Previously selected person'} · no longer active</option>}</select></div>
   <label>Target decision date<input type="date" value={workflow.target_date||''} onChange={e=>change('target_date',e.target.value||null)}/></label>
  </div>
  <ReferencesEditor label="Requirement" rows={workflow.requirements} onChange={requirements=>change('requirements',requirements)}/>
  <p className="sr-caption">Link the existing requirement or constraint and keep its source ID. Architecture decisions stay in the authoritative record linked in Student decision.</p>
  <div className="sr-decision-option-heading"><h3>Options to compare</h3><span>{workflow.options.length} of 6</span></div>
  <div className="sr-decision-options">{workflow.options.map((option,index)=><fieldset key={option.id} className="sr-decision-option"><legend>Option {index+1}</legend>
   <div className="sr-decision-option-toolbar"><label>Option {index+1} name<input required maxLength={200} value={option.label} placeholder="A specific design alternative" onChange={e=>optionChange(option.id,{label:e.target.value})}/></label><button type="button" className="sr-icon-button" aria-label={`Remove option ${index+1}`} disabled={workflow.options.length<=1} onClick={()=>removeOption(option.id)}><X size={16}/></button></div>
   <label>Option {index+1} description<textarea rows={2} maxLength={2000} value={option.description} placeholder="How does this option work?" onChange={e=>optionChange(option.id,{description:e.target.value})}/></label>
   <details className="sr-decision-notes"><summary>Qualitative observations and evidence</summary><div className="sr-decision-notes-body"><div className="sr-decision-dimensions">{dimensions.map(dimension=><label key={dimension}>{dimensionLabels[dimension]}<input aria-label={`Option ${index+1} ${dimension}`} maxLength={1000} value={option[dimension]} placeholder={examples[dimension]} onChange={e=>optionChange(option.id,{[dimension]:e.target.value})}/></label>)}</div><ReferencesEditor label={`Option ${index+1} evidence`} rows={option.evidence} onChange={evidence=>optionChange(option.id,{evidence})}/></div></details>
   <details className="sr-decision-notes"><summary>SWOT (optional)</summary><div className="sr-decision-notes-body"><p className="sr-caption">Strengths and weaknesses describe this option. Opportunities and threats describe its wider context.</p><div className="sr-decision-swot">{swotFields.map(field=><label key={field}>{field[0].toUpperCase()+field.slice(1)}<textarea aria-label={`Option ${index+1} ${field}`} rows={2} maxLength={2000} value={option.swot?.[field]||''} placeholder={swotPrompts[field]} onChange={e=>optionChange(option.id,{swot:{...(option.swot||emptySwot()),[field]:e.target.value}})}/></label>)}</div>{option.swot&&<button type="button" onClick={()=>optionChange(option.id,{swot:null})}>Clear option {index+1} SWOT</button>}</div></details>
  </fieldset>)}</div>
  <button className="sr-add-option" type="button" disabled={workflow.options.length>=6} onClick={()=>change('options',[...workflow.options,{id:crypto.randomUUID(),label:'',description:'',weight:'',space:'',cost:'',reliability:'',time:'',evidence:[]}])}><Plus size={14}/>Add option</button>
  <TradeStudyEditor value={workflow.trade_study} options={workflow.options} onChange={value=>change('trade_study',value)}/>
 </section>;
}

export function DecisionRecordFields({workflow,onChange}:{workflow:DecisionWorkflow;onChange:(workflow:DecisionWorkflow)=>void}){
 const id=useId();
 const change=<K extends keyof DecisionWorkflow>(key:K,value:DecisionWorkflow[K])=>onChange({...workflow,[key]:value});
 return <section className="sr-decision-record" aria-label="Decision record status">
  <div className="sr-form-grid"><div className="sr-field"><label htmlFor={`${id}-status`}>Decision status</label><select id={`${id}-status`} value={workflow.status} onChange={e=>change('status',e.target.value as DecisionWorkflow['status'])}><option value="comparing">Comparing options</option><option value="recorded">Decision recorded</option><option value="reopened">Reopened for comparison</option></select></div><label>{workflow.status==='reopened'?'Previous decision date':'Actual decision date'}<input type="date" value={workflow.decided_on||''} onChange={e=>change('decided_on',e.target.value||null)}/></label></div>
  <div className="sr-field"><label htmlFor={`${id}-chosen`}>{workflow.status==='reopened'?'Previous chosen option':'Chosen option'}</label><select id={`${id}-chosen`} value={workflow.chosen_option_id||''} onChange={e=>change('chosen_option_id',e.target.value||null)}><option value="">No option chosen yet</option>{workflow.options.map((option,index)=><option key={option.id} value={option.id}>{option.label.trim()||`Option ${index+1} · name needed`}</option>)}</select></div>
  {workflow.trade_study&&<TradeStudySummary value={workflow.trade_study} options={workflow.options} compact/>}
  <label>Reopen criteria<textarea rows={3} maxLength={2000} value={workflow.reopen_criteria} placeholder="What new evidence, failed test or changed constraint would make students revisit this choice?" onChange={e=>change('reopen_criteria',e.target.value)}/></label>
  <p className="sr-caption">Save unfinished work as Comparing options or Reopened. Recording a decision needs an owner, actual date, chosen option, reported student decision, rationale, student participants and reopen criteria.</p>
  {workflow.status==='reopened'&&<p className="sr-carry-note">The previous selection and outcome stay visible while you compare again. Update them when the students record the new choice.</p>}
 </section>;
}
