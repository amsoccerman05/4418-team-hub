import type {SupabaseClient} from '@supabase/supabase-js';
import {supabase} from '../attendance/service';
import {localDate, taskStatuses, type Context} from '../planning/service';

export const assignmentPreviewLimit = 3;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Assignment = {id:string;title:string;href:string;detail:string;urgent:boolean};
export type AssignmentList = {total:number;items:Assignment[]};
export type AssignmentSource = {status:'loading'|'ready'|'error';data:AssignmentList};
export type PersonalAttention = {planning:AssignmentSource;pit:AssignmentSource};
export const emptyAssignments = ():AssignmentSource => ({status:'ready',data:{total:0,items:[]}});
export const loadingAssignments = ():PersonalAttention => ({planning:{...emptyAssignments(),status:'loading'},pit:{...emptyAssignments(),status:'loading'}});

// Extra client-side defense. Authorization remains with the existing actor-scoped
// Planning RPC and Pit RLS. No browser-supplied user ID is sent to Planning.
export function planningAssignments(data:Context,userId:string,today=localDate()):AssignmentList {
 if(!data || data.user_id!==userId || !Array.isArray(data.tasks) || !Array.isArray(data.boards) || !Array.isArray(data.seasons))throw new Error('Planning assignments unavailable');
 const season=data.seasons.find(s=>s.id===data.season_id);
 const boards=new Map(data.boards.filter(b=>b.active&&(b.kind==='area'||season?.status==='active'&&b.season_id===season.id)).map(b=>[b.id,b]));
 const tasks=[...new Map(data.tasks.filter(t=>uuidPattern.test(t.id)&&boards.has(t.board_id)&&t.owner_ids?.includes(userId)&&['backlog','todo','in_progress','blocked'].includes(t.status)).map(t=>[t.id,t])).values()];
 const rank=(t:typeof tasks[number])=>t.status==='blocked'?0:t.due_date&&t.due_date<today?1:t.due_date===today?2:3;
 tasks.sort((a,b)=>rank(a)-rank(b)||(a.due_date||'9999').localeCompare(b.due_date||'9999')||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
 return {total:tasks.length,items:tasks.slice(0,assignmentPreviewLimit).map(t=>({id:t.id,title:t.title,href:`#planning/my-work/${t.id}`,urgent:t.status==='blocked'||!!t.due_date&&t.due_date<today,detail:[boards.get(t.board_id)!.name,taskStatuses[t.status as keyof typeof taskStatuses],t.due_date?(t.due_date<today?'Overdue · ':t.due_date===today?'Due today · ':'Due ')+t.due_date:null].filter(Boolean).join(' · ')}))};
}
export async function fetchPlanningAssignments(userId:string,signal:AbortSignal,client:SupabaseClient|null=supabase):Promise<AssignmentList> {
 if(!client||!uuidPattern.test(userId))throw new Error('Team connection unavailable');
 const {data,error}=await client.rpc('planning_my_work_context',{selected_season:null}).abortSignal(signal);
 if(error)throw error;
 return planningAssignments(data,userId);
}
export type RepairAssignment = {id:string;issue_number:number;title:string;status:string;severity:string;assigned_to:string|null};
export function repairAssignments(rows:RepairAssignment[],count:number|null,userId:string):AssignmentList {
 // A failed/malformed or unexpectedly unfiltered result is never an empty queue.
 if(!Array.isArray(rows)||typeof count!=='number'||!Number.isSafeInteger(count)||count<0||count<rows.length||rows.some(r=>!uuidPattern.test(r.id)||r.assigned_to!==userId||!['OPEN','DIAGNOSING','REPAIRING','TESTING','DEFERRED'].includes(r.status)))throw new Error('Repair assignments unavailable');
 return {total:count,items:rows.slice(0,assignmentPreviewLimit).map(r=>({id:r.id,title:`Repair #${r.issue_number} · ${r.title}`,href:`https://pit.frc4418.org/#issue/${r.id}`,detail:`${r.status.toLowerCase().replaceAll('_',' ')} · ${r.severity.toLowerCase()}`,urgent:r.severity==='ROBOT DOWN'||r.severity==='HIGH'}))};
}
export async function fetchRepairAssignments(userId:string,signal:AbortSignal,client:SupabaseClient|null=supabase):Promise<AssignmentList> {
 if(!client||!uuidPattern.test(userId))throw new Error('Team connection unavailable');
 const {data,error,count}=await client.from('pit_issues')
  .select('id,issue_number,title,status,severity,assigned_to',{count:'exact'})
  .eq('assigned_to',userId).in('status',['OPEN','DIAGNOSING','REPAIRING','TESTING','DEFERRED'])
  .order('updated_at',{ascending:false}).order('id',{ascending:true}).limit(assignmentPreviewLimit).abortSignal(signal);
 if(error)throw error;
 return repairAssignments(data,count,userId);
}
