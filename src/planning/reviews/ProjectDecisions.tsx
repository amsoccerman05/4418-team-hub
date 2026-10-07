import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,RefreshCw} from 'lucide-react';
import {loadReview} from './service';
import {supabase} from '../../attendance/service';
import type {SprintReviewContext} from './types';
import {ReferenceList,TaskReference} from './ReviewViews';
import {decisionStatusLabels} from './decision-model';
import './reviews.css';

/** A read-through entry point. The editable record still lives in the existing Sprint Review. */
export function ProjectDecisions({actorId,boardId,seasonId,route}:{actorId:string;boardId:string;seasonId:string;route:string}){
 const [data,setData]=useState<SprintReviewContext|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),generation=useRef(0);
 useEffect(()=>{const ticket=++generation.current,controller=new AbortController();let current=true;setData(null);setError('');const isCurrent=()=>current&&generation.current===ticket&&location.hash===route;
  const clear=()=>{if(!isCurrent()){current=false;controller.abort();setData(null);setError('');}};
  window.addEventListener('hashchange',clear);const subscription=supabase?.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==actorId){current=false;controller.abort();setData(null);setError('');}}).data.subscription;
  void loadReview(actorId,seasonId,null,controller.signal,undefined,isCurrent).then(value=>{if(isCurrent())setData(value);}).catch(e=>{if(isCurrent())setError((e as Error).message);});
  return()=>{current=false;controller.abort();generation.current++;window.removeEventListener('hashchange',clear);subscription?.unsubscribe();};
 },[actorId,boardId,seasonId,route,refresh]);
 const review=data?.reviews.find(r=>r.id===data.selected_review_id),board=data?.boards.find(b=>b.id===boardId),entry=data?.updates.find(u=>u.board_id===boardId),workflow=entry?.decision_workflow;
 const link=review?`#planning/reviews/${review.id}/project/${boardId}`:'#planning/reviews';
 return <section className="sprint-review" aria-label="Project design decisions"><header className="sr-page-heading"><div><span className="sr-eyebrow">This project · Sprint Review</span><h2>Design decisions</h2><p>Compare options, link the evidence, and record the students’ choice in the project’s weekly update.</p></div><button onClick={()=>setRefresh(n=>n+1)} aria-label="Refresh project decisions"><RefreshCw size={15}/>Refresh</button></header>
 <p className="sr-caption">Existing requirement IDs and the architecture register remain authoritative. This view uses the same Sprint Review record and Planning tasks.</p>
 {error?<p role="alert" className="sr-error">{error}</p>:!data?<p role="status">Loading project decisions…</p>:!board?<p className="sr-empty">This project is not available in Sprint Review.</p>:!review?<div className="sr-empty"><h3>No Sprint Review yet</h3><p>A facilitator can create the first review and assign the project’s student lead and supporters.</p><a href={link}>Open Sprint Review <ArrowUpRight size={14}/></a></div>:<article className="sr-project-card"><header className="sr-project-heading"><div><span className="sr-eyebrow">Latest review · {review.review_date}</span><h3>{review.title}</h3></div><a className="sr-primary" href={link}>{board.can_edit_update?'Open decision workflow':'View review record'} <ArrowUpRight size={14}/></a></header>
 {workflow?<><p className="sr-status">{decisionStatusLabels[workflow.status]}</p><h3>{entry?.decisions_needed||'Project comparison'}</h3><p>{workflow.options.length} options · {workflow.owner_id?entry?.decision_owner?.name||data.members.find(p=>p.id===workflow.owner_id)?.name||'Student owner unavailable':'Student owner needed'}{workflow.target_date?` · Target ${workflow.target_date}`:''}</p><ul>{workflow.options.map(option=><li key={option.id}>{option.label}{workflow.chosen_option_id===option.id?' · selected option':''}</li>)}</ul>{entry?.reported_decision&&<p>{entry.reported_decision}</p>}{workflow.reopen_criteria&&<p><strong>Reopen if:</strong> {workflow.reopen_criteria}</p>}</>:<p>No structured comparison in this review yet. Add one inside the project’s weekly update when there’s a choice to discuss.</p>}
 {entry&&<><ReferenceList rows={entry.decision_references} label="Architecture references"/><TaskReference task={entry.linked_task}/><p className="sr-caption">Review version {entry.version}. Task owners and dates come from current Planning records.</p></>}
 </article>}
 </section>;
}
