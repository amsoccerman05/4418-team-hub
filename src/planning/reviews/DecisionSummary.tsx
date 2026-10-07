import {ArrowUpRight,Check,Link2} from 'lucide-react';
import type {DecisionWorkflow} from './decision-types';
import type {ReviewPerson,ReviewReference} from './types';
import {safeReferenceUrl} from './model';
import {TradeStudySummary} from './TradeStudySummary';
import './decision.css';

function SourceLinks({rows,label}:{rows:ReviewReference[];label:string}){
 return rows.length?<ul className="sr-references" aria-label={label}>{rows.map((source,index)=>{const url=safeReferenceUrl(source.url);return <li key={index}><Link2 size={13}/><div>{url?<a href={url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowUpRight size={12}/></a>:<span>{source.label} · link unavailable</span>}{source.reference_id&&<small>{source.reference_id}</small>}</div></li>;})}</ul>:<p className="sr-empty-field">No {label.toLowerCase()} linked yet.</p>;
}

export function DecisionSummary({workflow,people=[],owner:historicalOwner}:{workflow:DecisionWorkflow;people?:ReviewPerson[];owner?:ReviewPerson|null}){
 const owner=historicalOwner===undefined?people.find(p=>p.id===workflow.owner_id):historicalOwner?.id===workflow.owner_id?historicalOwner:null,chosen=workflow.options.find(option=>option.id===workflow.chosen_option_id),reopened=workflow.status==='reopened';
 const status={comparing:'Comparing options',recorded:'Decision recorded',reopened:'Reopened for comparison'}[workflow.status];
 return <section className="sr-decision-summary" aria-label="Design decision comparison">
  <header><h4>Design comparison</h4><span className={`sr-status sr-decision-state is-${workflow.status}`}>{status}</span></header>
  <dl className="sr-decision-meta"><div><dt>Decision owner</dt><dd>{owner?`${owner.name}${owner.active?'':' · inactive'}`:workflow.owner_id?'Student owner unavailable':'Owner not assigned'}</dd></div><div><dt>Target decision date</dt><dd>{workflow.target_date||'Not set'}</dd></div><div><dt>{reopened?'Previous decision date':'Actual decision date'}</dt><dd>{workflow.decided_on||'Not recorded'}</dd></div><div><dt>{reopened?'Previous chosen option':'Chosen option'}</dt><dd>{chosen?.label||'No option chosen yet'}</dd></div></dl>
  <h5>Requirement sources</h5><SourceLinks rows={workflow.requirements} label="Requirement sources"/>
  {workflow.trade_study&&<TradeStudySummary value={workflow.trade_study} options={workflow.options}/>}
  <div className="sr-decision-comparison-grid">{workflow.options.map(option=><article key={option.id} className={`sr-decision-option-summary${option.id===workflow.chosen_option_id?' is-chosen':''}`}><header><h5>{option.label}</h5>{option.id===workflow.chosen_option_id&&<span className="sr-decision-chosen"><Check size={12}/>{reopened?'Previous choice':'Chosen'}</span>}</header>{option.description&&<p>{option.description}</p>}<dl>{(['weight','space','cost','reliability','time'] as const).map(dimension=><div key={dimension}><dt>{dimension[0].toUpperCase()+dimension.slice(1)}</dt><dd>{option[dimension].trim()||'Not compared yet'}</dd></div>)}</dl><SourceLinks rows={option.evidence} label={`${option.label} evidence`}/>{option.swot&&Object.values(option.swot).some(value=>value.trim())&&<details className="sr-decision-notes"><summary>SWOT for {option.label}</summary><dl>{(['strengths','weaknesses','opportunities','threats'] as const).map(field=><div key={field}><dt>{field[0].toUpperCase()+field.slice(1)}</dt><dd>{option.swot?.[field].trim()||'Not noted yet'}</dd></div>)}</dl></details>}</article>)}</div>
  <div className="sr-update-field"><h4>Reopen criteria</h4>{workflow.reopen_criteria.trim()?<p>{workflow.reopen_criteria}</p>:<p className="sr-empty-field">Not recorded yet.</p>}</div>
 </section>;
}
