import {uuid} from './model';
export type GoalScope={actorId:string;seasonId:string;route:string};
export type GoalTicket=GoalScope&{generation:number;editor:object|null};
/** Only opaque identifiers survive closing a draft. Never persist goal content. */
export type PendingGoalOperation={actorId:string;seasonId:string;operationId:string;goalId:string;expectedVersion:number;updateId:string|null};
const key='4418-season-goal-receipts-v1';
const fallback=new Map<string,PendingGoalOperation>();
const receiptKey=(r:PendingGoalOperation)=>r.actorId+':'+r.seasonId;
let storageAvailable=true;
function stored():PendingGoalOperation[]{try{const rows=JSON.parse(sessionStorage.getItem(key)||'[]');return Array.isArray(rows)?rows.filter(r=>r&&uuid.test(r.actorId)&&uuid.test(r.seasonId)&&uuid.test(r.operationId)&&uuid.test(r.goalId)&&Number.isSafeInteger(r.expectedVersion)&&r.expectedVersion>=0&&(r.updateId===null||uuid.test(r.updateId))).map(r=>({actorId:r.actorId,seasonId:r.seasonId,operationId:r.operationId,goalId:r.goalId,expectedVersion:r.expectedVersion,updateId:r.updateId})):[];}catch{storageAvailable=false;return [];}}
function receipts(){return [...new Map([...stored(),...fallback.values()].map(r=>[receiptKey(r),r])).values()];}
function persist(rows:PendingGoalOperation[]){fallback.clear();rows.forEach(r=>fallback.set(receiptKey(r),r));try{sessionStorage.setItem(key,JSON.stringify(rows));storageAvailable=true;}catch{storageAvailable=false;}if(typeof window!=='undefined')window.dispatchEvent(new Event('goal-receipt-change'));}
export const goalReceiptStorageAvailable=()=>storageAvailable;
export function pendingGoalOperation(actorId:string,seasonId:string){return receipts().find(r=>r.actorId===actorId&&r.seasonId===seasonId)||null;}
export function pendingGoalOperations(actorId:string){return receipts().filter(r=>r.actorId===actorId);}
export function rememberGoalOperation(receipt:PendingGoalOperation){if(![receipt.actorId,receipt.seasonId,receipt.operationId,receipt.goalId].every(x=>uuid.test(x))||!Number.isSafeInteger(receipt.expectedVersion)||receipt.expectedVersion<0||receipt.updateId!==null&&!uuid.test(receipt.updateId))throw Error('Invalid save receipt.');const existing=pendingGoalOperation(receipt.actorId,receipt.seasonId);if(existing&&existing.operationId!==receipt.operationId)throw Error('Check the pending save before starting another.');persist([...receipts().filter(r=>receiptKey(r)!==receiptKey(receipt)),{actorId:receipt.actorId,seasonId:receipt.seasonId,operationId:receipt.operationId,goalId:receipt.goalId,expectedVersion:receipt.expectedVersion,updateId:receipt.updateId}]);}
export function finishGoalOperation(receipt:PendingGoalOperation){persist(receipts().filter(r=>receiptKey(r)!==receiptKey(receipt)||r.operationId!==receipt.operationId));}
export class GoalSession {
 private generation=0;private live=true;private editor:object|null=null;private requests=new Set<AbortController>();
 constructor(readonly scope:GoalScope){}
 activate(){this.live=true;this.invalidate();}
 ticket():GoalTicket{return {...this.scope,generation:this.generation,editor:this.editor};}
 current(ticket:GoalTicket,actualRoute=this.scope.route){return this.live&&ticket.actorId===this.scope.actorId&&ticket.seasonId===this.scope.seasonId&&ticket.route===this.scope.route&&actualRoute===ticket.route&&ticket.generation===this.generation&&ticket.editor===this.editor;}
 openEditor(){this.invalidate();this.editor={};return this.ticket();}
 closeEditor(){this.invalidate();this.editor=null;}
 controller(){const controller=new AbortController();this.requests.add(controller);return controller;}
 release(controller:AbortController){this.requests.delete(controller);}
 invalidate(){this.generation++;this.requests.forEach(c=>c.abort());this.requests.clear();}
 dispose(){this.live=false;this.closeEditor();}
}
