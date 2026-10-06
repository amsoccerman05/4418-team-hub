import type {SprintReviewContext, ProjectReviewUpdate, ReviewReference, ReviewTask} from '../types';

export type ExportReference = {label:string;referenceId:string;url:string|null;missingReason:string|null};
export type ExportTask = {title:string;status:string;owners:string[];dueDate:string|null;dateUnavailable:boolean;available:boolean};
export type ExportUpdate = {
 progress:string;blockers:string;tradeoffs:string;decisionsNeeded:string;evidence:ExportReference[];
 reportedDecision:string;decisionRationale:string;decisionReferences:ExportReference[];reportedBy:string[];
 nextTest:string;nextTask:ExportTask|null;unresolved:boolean;
 carriedFrom:{reviewTitle:string;reviewDate:string}|null;
};
export type ReviewExportSnapshot = {
 schemaVersion:1;reviewId:string;title:string;reviewDate:string;season:string;chair:string|null;asOf:string;
 agenda:{title:string;presenter:string|null;minutes:number}[];
 projects:{id:string;name:string;lead:string|null;supporters:string[];update:ExportUpdate|null}[];
 priorUnresolved:{project:string;reviewTitle:string;reviewDate:string;blockers:string;decisionsNeeded:string;nextTest:string}[];
};

/** Only ordinary HTTP(S) links without credentials can become actionable PPTX hyperlinks. No fetch occurs. */
export function safeReferenceUrl(raw:string):string|null {
 if(!raw||/[\s\\\u0000-\u001f\u007f]/u.test(raw))return null;
 try {const u=new URL(raw);return (u.protocol==='https:'||u.protocol==='http:')&&!u.username&&!u.password ? u.href : null;} catch {return null;}
}
function reference(r:ReviewReference):ExportReference {
 const url=safeReferenceUrl(r.url);
 return {label:r.label,referenceId:r.reference_id,url,missingReason:url?null:'Link missing or unavailable'};
}
function task(t:ReviewTask|null):ExportTask|null {
 if(!t)return null;
 // An inaccessible task must never disclose a cached title, date, owner or status.
 if(!t.available)return {title:'Planning task unavailable',status:'Unavailable',owners:[],dueDate:null,dateUnavailable:true,available:false};
 return {title:t.title,status:t.status||'Status not recorded',owners:t.owners.map(p=>p.name),dueDate:t.due_date,dateUnavailable:t.due_date_unavailable,available:true};
}
function update(u:ProjectReviewUpdate):ExportUpdate {
 return {progress:u.progress,blockers:u.blockers,tradeoffs:u.tradeoffs,decisionsNeeded:u.decisions_needed,
 evidence:u.evidence.map(reference),reportedDecision:u.reported_decision,decisionRationale:u.decision_rationale,
 decisionReferences:u.decision_references.map(reference),reportedBy:u.reported_students.map(p=>p.name),
 nextTest:u.next_test,nextTask:task(u.linked_task),unresolved:u.unresolved,
 carriedFrom:u.carried_from?{reviewTitle:u.carried_from.review_title,reviewDate:u.carried_from.review_date}:null};
}

/** Detached, read-only export of the selected, loaded review. No database calls and no draft/credential fields. */
export function createReviewExportSnapshot(context:SprintReviewContext,reviewId=context.selected_review_id):ReviewExportSnapshot {
 if(!reviewId||reviewId!==context.selected_review_id)throw new Error('Export the loaded review. Open the requested review and wait for it to load before exporting.');
 const review=context.reviews.find(r=>r.id===reviewId&&r.season_id===context.season_id);
 if(!review)throw new Error('Select an available Sprint Review before exporting.');
 const person=(id:string|null)=>id?context.members.find(p=>p.id===id)?.name??null:null;
 const boards=context.boards.filter(b=>b.season_id===review.season_id);
 const updates=context.updates.filter(u=>u.review_id===review.id);
 const projects=boards.map(b=>({id:b.id,name:b.name,lead:b.assignment?.lead?.name??null,
  supporters:b.assignment?.supporters.map(p=>p.name)??[],update:updates.find(u=>u.board_id===b.id)?update(updates.find(u=>u.board_id===b.id)!):null}));
 const priorUnresolved=context.previous_updates.filter(u=>u.unresolved&&boards.some(b=>b.id===u.board_id)&&!updates.some(v=>v.board_id===u.board_id))
 .map(u=>({project:boards.find(b=>b.id===u.board_id)!.name,reviewTitle:context.reviews.find(r=>r.id===u.review_id&&r.season_id===review.season_id)?.title??'Previous review',
 reviewDate:context.reviews.find(r=>r.id===u.review_id&&r.season_id===review.season_id)?.review_date??'Date unavailable',blockers:u.blockers,decisionsNeeded:u.decisions_needed,nextTest:u.next_test}));
 return {schemaVersion:1,reviewId:review.id,title:review.title,reviewDate:review.review_date,
 season:context.seasons.find(s=>s.id===review.season_id)?.name??'Season unavailable',chair:person(review.chair_id),asOf:context.loaded_at,
 agenda:review.agenda.map(a=>({title:a.title,presenter:person(a.presenter_id),minutes:a.duration_minutes})),projects,priorUnresolved};
}
