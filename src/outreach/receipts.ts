import {uuidPattern} from './model';
/** Only opaque IDs persist. No drafts, contacts, financial amounts, or tokens. */
export type PendingReceipt={actorId:string;requestId:string;entityId:string;operation:string;expectedVersion:number};
const key='4418-outreach-pending-v1',listeners=new Set<()=>void>();
let memory:PendingReceipt[]=[];
const operations=['prospect','organization','contact','engagement','conversation','pledge','recognition','income_link'];
try {const stored=typeof sessionStorage==='undefined'?null:sessionStorage.getItem(key);const data:unknown=stored?JSON.parse(stored):[];if(Array.isArray(data))memory=data.filter((r):r is PendingReceipt=>!!r&&typeof r==='object'&&uuidPattern.test(r.actorId)&&uuidPattern.test(r.requestId)&&uuidPattern.test(r.entityId)&&operations.includes(r.operation)&&Number.isInteger(r.expectedVersion)&&r.expectedVersion>0).map(r=>({actorId:r.actorId,requestId:r.requestId,entityId:r.entityId,operation:r.operation,expectedVersion:r.expectedVersion}));}catch{/* An unavailable browser store falls back to this tab's memory. */}
let persistent=true;
function changed(){try{if(typeof sessionStorage!=='undefined')sessionStorage.setItem(key,JSON.stringify(memory));else persistent=false;}catch{persistent=false;}for(const listener of listeners)listener();}
export const receiptPersistenceAvailable=()=>persistent;
export const pendingReceipts=(actorId:string)=>memory.filter(receipt=>receipt.actorId===actorId);
export const subscribeReceipts=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function rememberReceipt(receipt:PendingReceipt){if(!memory.some(r=>r.requestId===receipt.requestId&&r.actorId===receipt.actorId)){memory=[...memory,receipt];changed();}}
export function settleReceipt(actorId:string,requestId:string){memory=memory.filter(receipt=>receipt.actorId!==actorId||receipt.requestId!==requestId);changed();}
