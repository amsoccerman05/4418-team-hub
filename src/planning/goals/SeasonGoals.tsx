import {useEffect,useId,useRef,useState} from 'react';
import {Plus,Target} from 'lucide-react';
import {supabase} from '../../attendance/service';
import type {GoalsContext,SeasonGoal,GoalSavePayload,GoalUpdatePayload} from './types';
import {categories,statuses,goalRoute,latestUpdate,validateDefinition,validateUpdate} from './model';
import {GoalSession,pendingGoalOperation,rememberGoalOperation,finishGoalOperation,type PendingGoalOperation} from './session';
import {loadGoals,saveGoal,saveGoalUpdate,GoalServiceError,assertReceiptMatches} from './service';
import {GoalDetail,GoalList} from './GoalViews';
import {DefinitionDialog,UpdateDialog} from './GoalDialogs';
import './goals.css';

export type SeasonGoalsProps={actorId:string;seasonId:string;route:string;refreshKey?:number;onOpenTask:(id:string)=>void;onOpenMilestone:(id:string)=>void};
type Editor={kind:'definition';goal:SeasonGoal|null}|{kind:'update';goal:SeasonGoal};
// A changed actor/season/route never renders one frame of the old context or draft.
export function SeasonGoals(props:SeasonGoalsProps){return <GoalWorkspace key={`${props.actorId}:${props.seasonId}:${props.route}:${props.refreshKey||0}`} {...props}/>;}
function GoalWorkspace({actorId,seasonId,route,onOpenTask,onOpenMilestone}:SeasonGoalsProps){
 const filterId=useId();
 const [data,setData]=useState<GoalsContext|null>(null),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[editor,setEditor]=useState<Editor|null>(null),[busy,setBusy]=useState(false),[editorError,setEditorError]=useState(''),[receipt,setReceipt]=useState<PendingGoalOperation|null>(null);
 const [search,setSearch]=useState(''),[category,setCategory]=useState(''),[status,setStatus]=useState(''),[mine,setMine]=useState(false);
 const session=useRef(new GoalSession({actorId,seasonId,route})).current,saving=useRef(false),readGeneration=useRef(0),parsed=goalRoute(route);
 const actualRoute=()=>typeof location==='undefined'?route:location.hash;
 async function refresh(){const ticket=session.ticket(),generation=++readGeneration.current,controller=session.controller();setError('');setData(null);try{const context=await loadGoals(actorId,seasonId,controller.signal,undefined,()=>session.current(ticket,actualRoute()));if(session.current(ticket,actualRoute())&&generation===readGeneration.current){setData(context);setReceipt(pendingGoalOperation(actorId,seasonId));}}catch(e){if(session.current(ticket,actualRoute())&&generation===readGeneration.current)setError((e as Error).message);}finally{session.release(controller);}}
 useEffect(()=>{session.activate();if(parsed.valid)void refresh();const navigate=()=>{if(location.hash!==route){session.dispose();setData(null);setEditor(null);setEditorError('');}},receiptChanged=()=>{if(session.current(session.ticket(),actualRoute()))setReceipt(pendingGoalOperation(actorId,seasonId));};window.addEventListener('hashchange',navigate);window.addEventListener('goal-receipt-change',receiptChanged);const auth=supabase?.auth.onAuthStateChange((_event,next)=>{if(next?.user.id!==actorId){session.dispose();setData(null);setEditor(null);setEditorError('');setReceipt(null);}});return()=>{session.dispose();readGeneration.current++;window.removeEventListener('hashchange',navigate);window.removeEventListener('goal-receipt-change',receiptChanged);auth?.data.subscription.unsubscribe();};},[]);
 function open(next:Editor){if(saving.current||pendingGoalOperation(actorId,seasonId)||!data)return;const allowed=next.kind==='definition'?next.goal?next.goal.capabilities.can_edit:data.capabilities.can_create:next.goal.capabilities.can_update;if(!allowed)return;session.openEditor();setEditorError('');setFeedback('');setEditor(next);}
 function close(){session.closeEditor();setEditor(null);setEditorError('');setBusy(false);setReceipt(pendingGoalOperation(actorId,seasonId));}
 async function submit(payload:GoalSavePayload|GoalUpdatePayload,kind:'definition'|'update'){
  if(saving.current||!editor||!data||pendingGoalOperation(actorId,seasonId))return;
  const ticket=session.ticket();if(!session.current(ticket,actualRoute()))return;
  const allowed=kind==='definition'?editor.kind==='definition'&&(editor.goal?editor.goal.capabilities.can_edit:data.capabilities.can_create):editor.kind==='update'&&editor.goal.capabilities.can_update;
  if(!allowed)return;const issue=kind==='definition'?validateDefinition(payload as GoalSavePayload):validateUpdate(payload as GoalUpdatePayload);if(issue){setEditorError(issue);return;}
  const pending={actorId,seasonId,operationId:payload.operation_id,goalId:kind==='definition'?payload.id:(payload as GoalUpdatePayload).goal_id,expectedVersion:payload.expected_version,updateId:kind==='definition'?null:payload.id};
  try{rememberGoalOperation(pending);}catch(e){setEditorError((e as Error).message);return;}
  saving.current=true;setBusy(true);setEditorError('');setReceipt(pending);const controller=session.controller();
  try{
   const outcome=kind==='definition'?await saveGoal(actorId,payload as GoalSavePayload,controller.signal,undefined,()=>session.current(ticket,actualRoute())):await saveGoalUpdate(actorId,payload as GoalUpdatePayload,controller.signal,undefined,()=>session.current(ticket,actualRoute()));
   if(outcome.status==='not_found')throw new GoalServiceError('The save has not been confirmed. Check its status before trying again.','unknown');
   assertReceiptMatches(outcome,pending);if(session.current(ticket,actualRoute()))finishGoalOperation(pending);
   if(session.current(ticket,actualRoute())){close();setFeedback(outcome.status==='committed'?(kind==='definition'?'Goal saved.':'Weekly update saved. Earlier evidence is preserved.'):'The pending save was cancelled.');await refresh();}
  }catch(e){if(e instanceof GoalServiceError&&e.outcome==='rejected'&&session.current(ticket,actualRoute()))finishGoalOperation(pending);if(session.current(ticket,actualRoute())){if(pendingGoalOperation(actorId,seasonId)){close();setFeedback('The save may have completed. Check its status before starting another save.');}else setEditorError((e as Error).message);}}
  finally{session.release(controller);saving.current=false;if(session.current(ticket,actualRoute()))setBusy(false);}
 }
 if(!parsed.valid)return <p className="planning-error" role="alert">This goal link is invalid. <a href="#planning/goals">Open Season Goals</a></p>;
 const goal=data?.goals.find(g=>g.id===parsed.id),filtered=data?.goals.filter(g=>g.title.toLowerCase().includes(search.toLowerCase())&&(!category||g.category===category)&&(!status||(latestUpdate(g)?.status||'unreported')===status)&&(!mine||g.owner_id===actorId))||[];
 return <div className="season-goals">
  {error&&<p className="planning-error" role="alert">{error} {!data&&<button onClick={()=>void refresh()}>Retry goals</button>}</p>}
  {feedback&&<p className="goal-feedback" role="status">{feedback}</p>}
  {!data&&!error&&<p className="planning-loading" role="status">Loading season goals…</p>}
  {data&&<>
   {data.season?.status!=='active'&&<p className="goal-caption goal-readonly">{data.season?.status==='archived'?'This archived season is read only. Its goals and evidence remain available.':data.capabilities.can_manage?'This draft season is open for leadership preparation. Students can create goals when the season is active.':'This season is still a draft. Goals open for student updates when the season is active.'}</p>}
   {parsed.id?(goal?<GoalDetail goal={goal} data={data} disabled={!!receipt} onEdit={()=>open({kind:'definition',goal})} onUpdate={()=>open({kind:'update',goal})} onOpenTask={onOpenTask} onOpenMilestone={onOpenMilestone}/>:<div className="planning-card goal-empty"><Target size={25} aria-hidden="true"/><h2>Goal unavailable</h2><p>This goal is not available in the selected season.</p><a href="#planning/goals">All goals</a></div>):<>
    <div className="goal-list-toolbar"><p>Student-owned outcomes, checked one week at a time.</p>{data.capabilities.can_create&&data.goals.length>0&&<button className="planning-primary" disabled={!!receipt} onClick={()=>open({kind:'definition',goal:null})}><Plus size={16} aria-hidden="true"/>Create goal</button>}</div>
    {data.goals.length>0&&<><div className="planning-filters goal-filters"><label className="goal-filter-search">Search goals<input type="search" placeholder="Find a goal…" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="goal-filter-choice"><span id={`${filterId}-category`}>Category</span><select aria-labelledby={`${filterId}-category`} value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{Object.entries(categories).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="goal-filter-choice"><span id={`${filterId}-status`}>Status</span><select aria-labelledby={`${filterId}-status`} value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="unreported">No update yet</option></select></label><label className="goal-mine"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/><span>My goals</span></label></div><div className="goal-count"><span>{filtered.length} of {data.goals.length} goals</span><span>Status is manually reported</span></div></>}
    {data.goals.length>0&&!filtered.length?<p className="planning-empty">No goals match these filters. <button onClick={()=>{setSearch('');setCategory('');setStatus('');setMine(false);}}>Clear filters</button></p>:<GoalList goals={filtered} disabled={!!receipt} canCreate={data.capabilities.can_create} onCreate={()=>open({kind:'definition',goal:null})}/>}
   </>}
   {editor?.kind==='definition'&&<DefinitionDialog goal={editor.goal} data={data} busy={busy} error={editorError} onClose={close} onSave={p=>void submit(p,'definition')}/>}
   {editor?.kind==='update'&&<UpdateDialog goal={editor.goal} busy={busy} error={editorError} onClose={close} onSave={p=>void submit(p,'update')}/>}
  </>}
 </div>;
}
