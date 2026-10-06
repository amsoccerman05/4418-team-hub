import {useEffect,useRef,useState} from 'react';
import {ArrowRight,CheckCircle2,Pause,Plus,RefreshCw} from 'lucide-react';
import {createInvitationRow,updateInvitationRow,reviewInvitationBatch,validateInvitationBatch,createInvitationBatchRunner,INVITATION_BATCH_LIMIT,INVITATION_ROLES,INVITATION_REGISTRATIONS,type InvitationRow,type InvitationDraft,type InvitationBatchRunner,type InvitationValidationContext,type InvitationOutcome,type InvitationPayload} from './invitation-batch';
import {submitReviewedInvitation} from './invitation-client';
import {invitationSetup,invitationDirectory,attendanceRegistration,linkedInvitationMember,type OnboardingMember,type OnboardingInvitation} from './onboarding-status';
import {parseInvitationList} from './onboarding-input';
import './onboarding.css';
export type OnboardingData={members:OnboardingMember[];invitations?:OnboardingInvitation[];areas:{id:string;name:string;active:boolean}[]};
type Props={actorId:string;identitySignal:AbortSignal;isCurrentIdentity:()=>boolean;data:OnboardingData;active:boolean;busy:boolean;existingEmails:InvitationValidationContext['existingEmails'];refresh:(isCurrent:()=>boolean)=>Promise<OnboardingData>;onBusyChange:(busy:boolean)=>void;onBlock:(entry:{id:string;email:string;kind:'review'|'invitation'|'member'})=>void;onActivity:()=>void;onMember:(id:string)=>void};
const statusLabel=(row:InvitationRow)=>({draft:'Needs review',ready:'Reviewed · not sent',sending:'Sending',accepted:row.outcome?.status==='accepted'&&row.outcome.alreadyInvited?'Already accepted':'Accepted by service',not_sent:'Not sent',review:'Result needs review'}[row.status]);
const editable=(row:InvitationRow)=>['draft','ready','not_sent'].includes(row.status);
const safeDate=(value:string)=>Number.isNaN(Date.parse(value))?'Date unavailable':new Date(value).toLocaleDateString();

export function Onboarding(props:Props){
 const latest=useRef(props);latest.current=props;
 const workspaceRequests=useRef(new AbortController());
 const mounted=useRef(true),operation=useRef(false),pauseRequested=useRef(false),runner=useRef<InvitationBatchRunner|null>(null);
 const [rows,setRows]=useState<readonly InvitationRow[]>([]),[paste,setPaste]=useState(''),[reason,setReason]=useState(''),[step,setStep]=useState<'draft'|'review'>('draft'),[acknowledged,setAcknowledged]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[past,setPast]=useState<InvitationRow[]>([]),[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[directoryView,setDirectoryView]=useState<'open'|'history'>('open'),[batchOpen,setBatchOpen]=useState(false);
 const currentWorkspace=()=>mounted.current&&latest.current.active&&latest.current.isCurrentIdentity()&&location.hash==='#team-management';
 const context=(data=latest.current.data):InvitationValidationContext=>({areas:data.areas,existingEmails:[...latest.current.existingEmails,...data.members.filter(member=>member.email).map(member=>({email:member.email!,kind:'member' as const})),...(data.invitations||[]).map(invitation=>({email:invitation.email,kind:'invitation' as const}))]});
 function makeRunner(initial:readonly InvitationRow[]=[]):InvitationBatchRunner{
  return createInvitationBatchRunner({rows:initial,sender:async(payload:InvitationPayload):Promise<InvitationOutcome>=>{
   if(!currentWorkspace())return {status:'not_sent',stage:'before_reservation',code:'invalid_request',message:'Not sent. The onboarding workspace was left before this request started.'};
   return submitReviewedInvitation(payload,{actorId:latest.current.actorId,isCurrent:currentWorkspace,signal:AbortSignal.any([latest.current.identitySignal,workspaceRequests.current.signal])});
  },onRow:(row,snapshot)=>{
   if(!mounted.current||!latest.current.isCurrentIdentity())return;
   setRows(snapshot);
   if(row.status==='review'||row.status==='accepted')latest.current.onBlock({id:row.id,email:row.draft.email,kind:row.status==='review'?'review':'invitation'});
   if(row.outcome?.status==='not_sent'&&row.outcome.code==='existing_account')latest.current.onBlock({id:row.id,email:row.draft.email,kind:'member'});
   if(!currentWorkspace())runner.current?.pause();
  }});
 }
 if(!runner.current)runner.current=makeRunner();
 useEffect(()=>{
  mounted.current=true;workspaceRequests.current=new AbortController();
  const leave=()=>{if(location.hash!=='#team-management')runner.current?.pause();};
  window.addEventListener('hashchange',leave);
  return()=>{mounted.current=false;runner.current?.pause();workspaceRequests.current.abort();window.removeEventListener('hashchange',leave);};
 },[]);
 useEffect(()=>{if(props.active){setDirectoryView('open');setStatus('all');setSearch('');}},[props.active]);
 useEffect(()=>{if(!props.active&&running){pauseRequested.current=true;runner.current?.pause();setNotice('Paused after the current request because you left Onboarding. Nothing else will start automatically.');}},[props.active,running]);
 useEffect(()=>{
  if(!running||!rows.length)return;
  const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);
 },[running,rows.length]);
 function replace(next:readonly InvitationRow[]){if(operation.current)return;runner.current!.replaceRows(next);setRows(runner.current!.snapshot());setAcknowledged(false);setError('');}
 function edit(id:string,patch:Partial<InvitationDraft>){replace(rows.map(row=>row.id===id?updateInvitationRow(row,patch):row));}
 function addRows(drafts:Partial<InvitationDraft>[]){
  if(rows.length+drafts.length>INVITATION_BATCH_LIMIT){setError(`Keep each reviewed batch to ${INVITATION_BATCH_LIMIT} recipients or fewer. This is a UI limit, not an email quota.`);return;}
  replace([...rows,...drafts.map(draft=>createInvitationRow({reason,...draft}))]);setStep('draft');
 }
 function preparePaste(){const parsed=parseInvitationList(paste);if(parsed.errors.length){setError(parsed.errors.join(' '));return;}if(rows.length+parsed.recipients.length>INVITATION_BATCH_LIMIT){setError(`This list is too large. Prepare at most ${INVITATION_BATCH_LIMIT} recipients in one batch.`);return;}addRows(parsed.recipients);setPaste('');}
 function review(){const reviewed=reviewInvitationBatch(rows,context());replace(reviewed.rows);if(reviewed.issues.length){setError('Fix the marked recipients before reviewing this batch.');return;}setStep('review');setNotice('Review every recipient, role, and registration choice before sending.');}
 async function refreshStatus(){
  if(props.busy||running||operation.current)return;props.onBusyChange(true);setError('');
  try{const data=await props.refresh(currentWorkspace);runner.current!.reconcile(data.invitations||[]);setRows(runner.current!.snapshot());setNotice('Account and invitation status refreshed. No invitations were sent.');}
  catch{if(mounted.current)setError('Status could not be refreshed. Existing results are preserved; no invitation was sent.');}
  finally{props.onBusyChange(false);}
 }
 async function sendReviewed(){
  if(!currentWorkspace()||operation.current||running||props.busy||!acknowledged||step!=='review'||!rows.some(row=>row.status==='ready'))return;
  operation.current=true;pauseRequested.current=false;setRunning(true);props.onBusyChange(true);setError('');setNotice('Checking the latest team list before sending…');
  try{
   const fresh=await props.refresh(currentWorkspace);
   if(!currentWorkspace()||pauseRequested.current){if(mounted.current)setNotice('Paused before sending. Return to Onboarding and review again.');return;}
   const issues=validateInvitationBatch(runner.current!.snapshot(),context(fresh));
   if(issues.length){setStep('draft');setError('The team list changed or a recipient needs attention. Review the marked rows before sending.');return;}
   setNotice('Sending one reviewed invitation at a time. Pause stops after the current request settles.');
   const result=await runner.current!.start();
   if(!mounted.current)return;
   setRows(result.rows);setNotice(result.status==='completed'?'This batch has finished. Service acceptance does not confirm inbox delivery or completed account setup.':result.status==='paused'?'Paused. The current request has settled; remaining recipients have not been sent.':'Stopped at a recipient that needs attention. Nothing else will send automatically.');
   try{const refreshed=await props.refresh(currentWorkspace);runner.current!.reconcile(refreshed.invitations||[]);setRows(runner.current!.snapshot());}catch{setError('Results are saved in this view, but the team list could not be refreshed. Refresh status before continuing.');}
  }catch{if(mounted.current)setError('The latest team list could not be loaded. No batch was started. Refresh status and review again.');}
  finally{operation.current=false;props.onBusyChange(false);if(mounted.current){setRunning(false);setAcknowledged(false);}}
 }
 function pause(){pauseRequested.current=true;runner.current!.pause();setNotice('Pausing after the current request. It may already have sent; do not resend it.');}
 function newBatch(){
  if(running||rows.some(row=>row.status==='draft'||row.status==='ready'))return;
  setPast(old=>[...old,...rows]);runner.current=makeRunner();setRows([]);setStep('draft');setAcknowledged(false);setError('');setNotice('Start a new reviewed batch. Earlier outcomes are retained below.');
 }
 const issues=rows.length?validateInvitationBatch(rows,context()):[];
 const ready=rows.filter(row=>row.status==='ready').length,attempted=rows.filter(row=>['accepted','review','sending','not_sent'].includes(row.status)).length;
 const directory=invitationDirectory(props.data.invitations||[]);
 const invitations=directory[directoryView].filter(invitation=>(directoryView==='history'||status==='all'||invitationSetup(invitation).tone===status)&&`${invitation.display_name} ${invitation.email}`.toLowerCase().includes(search.trim().toLowerCase()));
 const reviewCount=directory.open.filter(invitation=>invitationSetup(invitation).tone==='review').length;
 const filtered=!!search.trim()||(directoryView==='open'&&status!=='all');
 function switchDirectory(view:'open'|'history'){setDirectoryView(view);setStatus('all');}
 if(!props.active)return null;
 return <section className="onboarding" hidden={!props.active} aria-label="Team onboarding">
  <div className="onboarding-heading"><div><h2>Onboarding</h2><p>Track invitations and help teammates get started.</p></div><button disabled={props.busy||running} onClick={()=>void refreshStatus()}><RefreshCw size={16} aria-hidden="true"/>Refresh status</button></div>
  {error&&<p className="onboarding-error" role="alert">{error}</p>}{notice&&<p className="onboarding-notice" role="status">{notice}</p>}
  <details className="onboarding-compose" open={batchOpen} onToggle={event=>setBatchOpen(event.currentTarget.open)}><summary onClick={event=>{if(batchOpen&&running){event.preventDefault();pause();setBatchOpen(false);}}}><span>Invite a group</span><span className="onboarding-compose-summary">{rows.length?`${rows.length} recipients · ${running?'Sending':step==='review'?'Review and send':'Draft in progress'}`:'Paste a list, review, then send'}</span></summary>
  <section className="onboarding-batch" aria-labelledby="batch-heading"><div className="onboarding-heading"><div><span className="workspace-eyebrow">{step==='draft'?'1 · Prepare':'2 · Review and send'}</span><h3 id="batch-heading">Reviewed batch invitations</h3></div><span className="team-badge">{rows.length} / {INVITATION_BATCH_LIMIT} recipients</span></div>
   <p className="team-form-hint">This is a {INVITATION_BATCH_LIMIT}-recipient review limit, not an email allowance. Provider limits are unknown. Sending pauses on any rejection or uncertain result; nothing retries automatically.</p>
   {step==='draft'&&<>
    <div className="onboarding-paste"><label>Names and emails<textarea aria-label="Names and emails" aria-describedby="onboarding-paste-hint" rows={4} value={paste} disabled={props.busy||running} onChange={event=>setPaste(event.target.value)} placeholder={'Alex Rivera, alex@example.com\nJordan Lee, jordan@example.com'}/><small id="onboarding-paste-hint">One Name, email pair per line. Two spreadsheet columns also work. Roles are chosen below.</small></label><label>Reason for these invitations<input aria-label="Reason for these invitations" aria-describedby="onboarding-reason-hint" value={reason} disabled={props.busy||running} maxLength={2000} onChange={event=>setReason(event.target.value)} placeholder="Why are these teammates joining?"/><small id="onboarding-reason-hint">Copied into new draft rows; each reason stays editable.</small></label></div>
    <div className="onboarding-actions"><button disabled={props.busy||running||!paste.trim()} onClick={preparePaste}>Add pasted recipients</button><button disabled={props.busy||running||rows.length>=INVITATION_BATCH_LIMIT} onClick={()=>addRows([{}])}><Plus size={16} aria-hidden="true"/>Add one recipient</button></div>
   </>}
   {rows.length>0&&<ol className="onboarding-recipients">{rows.map((row,index)=>{
    const canEdit=step==='draft'&&editable(row)&&!running&&!props.busy,rowIssues=issues.filter(issue=>issue.rowId===row.id);
    return <li key={row.id} className={`onboarding-recipient is-${row.status}`}><div className="onboarding-row-heading"><h4>Recipient {index+1}{!canEdit&&row.draft.display_name?` · ${row.draft.display_name}`:''}</h4><span className="team-badge">{statusLabel(row)}</span></div>
     {canEdit?<><div className="team-fields"><label>Name<input aria-label={`Name for recipient ${index+1}`} value={row.draft.display_name} maxLength={150} onChange={event=>edit(row.id,{display_name:event.target.value})}/></label><label>Email<input aria-label={`Email for recipient ${index+1}`} type="email" value={row.draft.email} maxLength={254} onChange={event=>edit(row.id,{email:event.target.value})}/></label><label>Account role<select aria-label={`Role for recipient ${index+1}`} value={row.draft.role} onChange={event=>edit(row.id,{role:event.target.value})}>{INVITATION_ROLES.map(role=><option key={role}>{role}</option>)}</select></label><label>Invitation reason<input aria-label={`Reason for recipient ${index+1}`} value={row.draft.reason} maxLength={2000} onChange={event=>edit(row.id,{reason:event.target.value})}/></label></div>
      <details><summary>Optional area and attendance registration</summary><div className="team-fields"><label>Functional area<select aria-label={`Area for recipient ${index+1}`} value={row.draft.area_id} onChange={event=>edit(row.id,{area_id:event.target.value})}><option value="">Unassigned</option>{props.data.areas.filter(area=>area.active).map(area=><option value={area.id} key={area.id}>{area.name}</option>)}</select></label><label>Attendance registration<select aria-label={`Registration for recipient ${index+1}`} value={row.draft.member_status} onChange={event=>edit(row.id,{member_status:event.target.value})}>{INVITATION_REGISTRATIONS.map(registration=><option value={registration} key={registration}>{registration||'Not tracked'}</option>)}</select></label></div></details>
      <button className="onboarding-remove" onClick={()=>replace(rows.filter(candidate=>candidate.id!==row.id))}>Remove recipient {index+1}</button>
     </>:<dl className="onboarding-review-values"><div><dt>Email</dt><dd>{row.draft.email}</dd></div><div><dt>Account role</dt><dd>{row.draft.role}{['mentor','admin','lead'].includes(row.draft.role)&&<strong className="onboarding-access-warning"> · elevated access</strong>}</dd></div><div><dt>Reason</dt><dd>{row.draft.reason}</dd></div><div><dt>Area / attendance registration</dt><dd>{props.data.areas.find(area=>area.id===row.draft.area_id)?.name||'Unassigned'} · {row.draft.member_status||'Not tracked'}</dd></div></dl>}
     {rowIssues.length>0&&editable(row)&&<ul className="onboarding-row-issues">{rowIssues.map((issue,i)=><li key={`${issue.field}-${i}`}>{issue.message}</li>)}</ul>}
     {row.outcome?.message&&<p className="onboarding-result">{row.outcome.message}</p>}
    </li>;
   })}</ol>}
   {step==='review'&&ready>0&&!running&&<label className="onboarding-confirm"><input type="checkbox" checked={acknowledged} disabled={props.busy} onChange={event=>setAcknowledged(event.target.checked)}/><span>I reviewed all {ready} remaining recipients, their account roles, reasons, and attendance registration choices.</span></label>}
   <div className="onboarding-actions onboarding-batch-controls">
    {running?<button onClick={pause}><Pause size={16} aria-hidden="true"/>Pause after current invitation</button>:step==='draft'?<button className="primary" disabled={props.busy||!rows.length} onClick={review}>Review batch<ArrowRight size={16} aria-hidden="true"/></button>:<><button disabled={props.busy} onClick={()=>{setStep('draft');setAcknowledged(false);}}>Edit remaining recipients</button><button className="primary" disabled={props.busy||!acknowledged||ready===0} onClick={()=>void sendReviewed()}>{attempted?'Resume':'Send'} {ready} reviewed {ready===1?'invitation':'invitations'}</button></>}
    {!running&&rows.length>0&&!rows.some(row=>row.status==='draft'||row.status==='ready')&&<button disabled={props.busy} onClick={newBatch}>Start a new batch</button>}
   </div><p className="team-form-hint">Drafts and pause/resume state stay while Team Management remains open. Leaving or reloading does not undo a request already sent. Refresh the team directory before starting again.</p>
  </section></details>
  {past.length>0&&<details className="onboarding-history"><summary>Earlier batch outcomes ({past.length})</summary><ul>{past.map(row=><li key={row.id}><strong>{row.draft.display_name}</strong> · {row.draft.email} · {statusLabel(row)}<p>{row.outcome?.message}</p></li>)}</ul></details>}
  <section className="onboarding-directory" aria-labelledby="setup-heading"><div className="onboarding-heading"><div><h3 id="setup-heading">Invitations</h3><p>Open invitations stay here until the server confirms an active account.</p></div><button onClick={props.onActivity}>View Activity</button></div>
   <div className="onboarding-views" role="group" aria-label="Invitation views"><button aria-pressed={directoryView==='open'} onClick={()=>switchDirectory('open')}>In progress <span className="team-count">{directory.open.length}</span></button><button aria-pressed={directoryView==='history'} onClick={()=>switchDirectory('history')}>Account history <span className="team-count">{directory.history.length}</span></button></div>
   <div className="onboarding-directory-filters"><label><span className="team-control-label">Find an invitation</span><input type="search" placeholder="Search name or email…" value={search} onChange={event=>setSearch(event.target.value)}/></label>{directoryView==='open'&&<label><span className="team-control-label">Account setup status</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="all">All in progress</option><option value="pending">Awaiting setup</option><option value="review">Needs review ({reviewCount})</option></select></label>}</div>
   {directoryView==='history'&&<p className="team-form-hint">These invitation records are retained for reference. Account active confirms a verified email and sign-in, not completion of password setup.</p>}
   <div className="onboarding-status-list">{invitations.map(invitation=>{
    const setup=invitationSetup(invitation),member=linkedInvitationMember(invitation,props.data.members),registration=attendanceRegistration(member);
    return <article className="onboarding-status-row" key={invitation.id}><div className="onboarding-invite-identity"><h4>{invitation.display_name||'Invited member'}</h4><p>{invitation.email}</p><small>Requested {safeDate(invitation.created_at)}</small></div><div className="onboarding-invite-status"><span className={`team-badge onboarding-${setup.tone}`}>{setup.label}</span><p>{setup.description}</p><details className="onboarding-registration"><summary>Attendance registration</summary><p><strong>Attendance: {registration.label}</strong> · {registration.description}</p>{member&&<button disabled={props.busy||running} onClick={()=>props.onMember(member.id)}>Manage {member.display_name||'member'}</button>}</details></div></article>;
   })}</div>{!invitations.length&&<div className="team-empty onboarding-empty">{filtered?<><p>No invitations match this view.</p><button onClick={()=>{setSearch('');setStatus('all');}}>Clear invitation filters</button></>:directoryView==='history'?<p>No account history yet. Invitations move here when an active account is confirmed.</p>:<><CheckCircle2 size={24} aria-hidden="true"/><h4>No invitations in progress</h4><p>{directory.history.length?'Active accounts are in Members; their invitation records are in Account history.':'Invite a member from the directory or open Invite a group above.'}</p></>}</div>}
   <p className="team-form-hint onboarding-registration-note">Team attendance registration does not confirm FIRST registration or school forms. Account access and attendance registration are separate.</p>
  </section>
 </section>;
}
