import {uuid} from './model';
export type AssemblyRecovery={request_id:string;expected_actor:string};
const key='4418-assembly-receipts-v1';
// A local change is authoritative for its actor even if storage keeps returning
// an older value. Null is a cleared-receipt tombstone, not a missing cache entry.
const local=new Map<string,AssemblyRecovery|null>();
let stored=new Map<string,AssemblyRecovery>();
let storageAvailable=true;
const valid=(r:unknown):r is AssemblyRecovery=>!!r&&typeof r==='object'&&'request_id' in r&&typeof r.request_id==='string'&&uuid.test(r.request_id)&&'expected_actor' in r&&typeof r.expected_actor==='string'&&uuid.test(r.expected_actor);
const plain=(r:AssemblyRecovery):AssemblyRecovery=>({request_id:r.request_id,expected_actor:r.expected_actor});
function readStored(){try{const value=JSON.parse(sessionStorage.getItem(key)||'[]');stored=new Map((Array.isArray(value)?value.filter(valid):[]).map(r=>[r.expected_actor,plain(r)]));return true;}catch{storageAvailable=false;return false;}}
function currentReceipts(){const rows=new Map(stored);for(const [actor,receipt] of local){if(receipt)rows.set(actor,receipt);else rows.delete(actor);}return [...rows.values()];}
function receipts():AssemblyRecovery[]{readStored();return currentReceipts();}
function persist(actor:string,receipt:AssemblyRecovery|null){
 local.set(actor,receipt?plain(receipt):null);
 // Read before replacing the shared array so another actor's receipt survives.
 // If reading fails, retain the last snapshot and do not overwrite unknown data.
 if(readStored()){const rows=currentReceipts();try{sessionStorage.setItem(key,JSON.stringify(rows.map(plain)));stored=new Map(rows.map(r=>[r.expected_actor,plain(r)]));storageAvailable=true;}catch{storageAvailable=false;}}
 if(typeof window!=='undefined')window.dispatchEvent(new Event('assembly-receipt-change'));
}
export function pendingAssemblySave(actorId:string){return receipts().find(r=>r.expected_actor===actorId)||null;}
export function rememberAssemblySave(r:AssemblyRecovery){if(!valid(r))throw Error('Invalid save receipt.');const current=pendingAssemblySave(r.expected_actor);if(current&&current.request_id!==r.request_id)throw Error('Check the pending save before starting another.');persist(r.expected_actor,r);}
export function finishAssemblySave(r:AssemblyRecovery){
 if(!valid(r))return;const current=pendingAssemblySave(r.expected_actor);
 // A repeated finish may flush a previously failed removal once storage returns.
 // A different live request always wins over the older completion callback.
 if(current?.request_id===r.request_id||!current&&local.get(r.expected_actor)===null)persist(r.expected_actor,null);
}
export const assemblyStorageAvailable=()=>storageAvailable;
export type AssemblyScope={actorId:string;route:string;boardId:string|null};
export type AssemblyTicket=AssemblyScope&{generation:number;editor:object|null};
export class AssemblySession{
 private generation=0;private live=true;private editor:object|null=null;private requests=new Set<AbortController>();
 constructor(readonly scope:AssemblyScope){}
 activate(){this.live=true;this.invalidate();}
 ticket():AssemblyTicket{return {...this.scope,generation:this.generation,editor:this.editor};}
 current(t:AssemblyTicket,route=this.scope.route){return this.live&&t.actorId===this.scope.actorId&&t.route===this.scope.route&&route===t.route&&t.boardId===this.scope.boardId&&t.generation===this.generation&&t.editor===this.editor;}
 openEditor(){this.invalidate();this.editor={};return this.ticket();}
 closeEditor(){this.invalidate();this.editor=null;}
 controller(){const controller=new AbortController();this.requests.add(controller);return controller;}
 release(controller:AbortController){this.requests.delete(controller);}
 invalidate(){this.generation++;this.requests.forEach(c=>c.abort());this.requests.clear();}
 dispose(){this.live=false;this.closeEditor();}
}
