import type {FabricationContext,FabricationFile,FabricationMetadata,FabricationPart,FabricationRevision,FabricationSubmission} from './types';
import {FABRICATION_DXF_MAX_BYTES,FABRICATION_PDF_MAX_BYTES} from './types';

export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const fabricationStatuses={needs_review:'Needs review',ready:'Ready',in_progress:'In progress',done:'Done',on_hold:'On hold'} as const;
export const fabricationActions=['claim','release','acknowledge','ready','start','done','hold','rework'] as const;
export function fabricationRoute(route:string){const m=/^#fabrication(?:\/projects\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?$/.exec(route);return {valid:!!m,id:m?.[1]?.toLowerCase()||null};}
export function validDate(v:unknown):v is string {if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000'))return false;const d=new Date(v+'T12:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;}
/** Reference only. No automatic Onshape fetch or shared-link permission change. */
export function safeOnshapeUrl(value:string):string|null {if(value.length>2000||/[\s\\\u0000-\u001f\u007f]/.test(value))return null;try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='cad.onshape.com'&&!u.port&&!u.username&&!u.password&&/^\/documents\/[a-zA-Z0-9]+(?:\/|$)/.test(u.pathname)?u.href:null;}catch{return null;}}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const nullableId=(v:unknown)=>v===null||id(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
const nonblank=(v:unknown,max:number)=>text(v,max)&&!!v.trim();
const bool=(v:unknown)=>typeof v==='boolean';
const version=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const stamp=(v:unknown)=>text(v,100)&&Number.isFinite(Date.parse(v));
const list=(v:unknown,predicate:(entry:any)=>boolean,max=5000)=>Array.isArray(v)&&v.length<=max&&v.every(predicate);
const unique=(values:{id:string}[])=>new Set(values.map(v=>v.id)).size===values.length;
const person=(p:unknown)=>object(p)&&id(p.id)&&text(p.name,150)&&bool(p.active);
export function validFileMetadata(v:unknown,kind:'dxf'|'pdf'):v is FabricationFile {return object(v)&&nonblank(v.name,200)&&!/[\\/\u0000-\u001f\u007f]/.test(v.name)&&v.name.toLowerCase().endsWith('.'+kind)&&Number.isSafeInteger(v.size)&&v.size>0&&v.size<=(kind==='dxf'?FABRICATION_DXF_MAX_BYTES:FABRICATION_PDF_MAX_BYTES)&&typeof v.sha256==='string'&&/^[0-9a-f]{64}$/.test(v.sha256);}
export function validateFabricationMetadata(p:FabricationMetadata):string|null {
 if(!nonblank(p.name,200)||!nonblank(p.material,120))return 'Add a part name and material, within 200 and 120 characters.';
 if(!Number.isFinite(p.thickness)||p.thickness<=0||p.thickness>1000||!['mm','in'].includes(p.thickness_unit))return 'Enter a positive stock thickness and its units.';
 if(!['mm','in'].includes(p.drawing_unit))return 'Choose the DXF drawing units. Confirm them in the Onshape export.';
 if(!Number.isSafeInteger(p.quantity)||p.quantity<1||p.quantity>100000)return 'Quantity must be a whole number between 1 and 100,000.';
 if(!validDate(p.needed_date))return 'Choose a valid needed-by date.';
 if(!text(p.onshape_url,2000)||p.onshape_url!==''&&!safeOnshapeUrl(p.onshape_url))return 'Use an HTTPS cad.onshape.com document link without credentials.';
 if(!text(p.notes,2000))return 'Keep notes within 2,000 characters.';
 return null;
}
export function validateFabricationSubmission(p:FabricationSubmission):string|null {if(![p.part_id,p.board_id,p.revision_id].every(id)||p.version!==null&&!version(p.version))return 'The part version or project is unavailable. Refresh before saving.';return validateFabricationMetadata(p);}
const revision=(r:unknown)=>object(r)&&id(r.id)&&id(r.part_id)&&version(r.revision_number)&&validateFabricationMetadata(r as FabricationRevision)===null&&validFileMetadata(r.dxf,'dxf')&&(r.pdf===null||validFileMetadata(r.pdf,'pdf'))&&id(r.created_by)&&stamp(r.created_at);
const part=(p:unknown)=>object(p)&&id(p.id)&&id(p.board_id)&&Object.hasOwn(fabricationStatuses,p.status)&&version(p.version)&&id(p.current_revision_id)&&revision(p.current_revision)&&p.current_revision.id===p.current_revision_id&&p.current_revision.part_id===p.id&&nullableId(p.claimed_by)&&(p.claimant===null||person(p.claimant)&&p.claimant.id===p.claimed_by)&&nullableId(p.acknowledged_revision_id)&&nullableId(p.reviewed_revision_id)&&id(p.created_by)&&stamp(p.created_at)&&stamp(p.updated_at)&&text(p.status_note,2000)&&bool(p.can_revise)&&list(p.allowed_actions,a=>fabricationActions.includes(a),8)&&new Set(p.allowed_actions).size===p.allowed_actions.length;
function sameRevision(a:FabricationRevision,b:FabricationRevision){return ['id','part_id','revision_number','name','material','thickness','thickness_unit','drawing_unit','quantity','needed_date','onshape_url','notes','created_by','created_at'].every(k=>a[k as keyof FabricationRevision]===b[k as keyof FabricationRevision])&&['name','size','sha256'].every(k=>a.dxf[k as keyof FabricationFile]===b.dxf[k as keyof FabricationFile])&&(a.pdf===null?b.pdf===null:b.pdf!==null&&['name','size','sha256'].every(k=>a.pdf![k as keyof FabricationFile]===b.pdf![k as keyof FabricationFile]));}
/** Fail closed on actor, selected project, membership and revision inconsistencies. */
export function assertFabricationContext(v:unknown,actorId:string,seasonId:string|null=null,projectId:string|null=null):FabricationContext {
 if(!object(v)||v.user_id!==actorId||!id(v.user_id)||!bool(v.can_manage)||!bool(v.is_operator)||!nullableId(v.season_id)||!nullableId(v.selected_project_id)||!stamp(v.loaded_at)||!bool(v.parts_limit_reached)||!list(v.seasons,s=>object(s)&&id(s.id)&&nonblank(s.name,150)&&['draft','active','archived'].includes(s.status))||!list(v.projects,p=>object(p)&&id(p.id)&&id(p.season_id)&&nonblank(p.name,150)&&bool(p.active)&&bool(p.can_submit)&&bool(p.can_review)&&bool(p.can_operate))||!list(v.parts,part,200)||!list(v.revisions,revision,10000))throw Error('Fabrication returned an invalid response. Refresh to try again.');
 const c=v as FabricationContext;
 if(seasonId!==null&&c.season_id!==seasonId||c.selected_project_id!==projectId||c.season_id!==null&&!c.seasons.some(s=>s.id===c.season_id)||projectId!==null&&!c.projects.some(p=>p.id===projectId)||[c.seasons,c.projects,c.parts,c.revisions].some(rows=>!unique(rows))||c.projects.some(p=>p.season_id!==c.season_id)||c.parts.some(p=>!c.projects.some(b=>b.id===p.board_id)||projectId!==null&&p.board_id!==projectId)||c.revisions.some(r=>!c.parts.some(p=>p.id===r.part_id))||c.parts.some(p=>!c.revisions.some(r=>r.id===p.current_revision_id&&sameRevision(r,p.current_revision)))||c.season_id===null&&(c.projects.length>0||c.parts.length>0||c.revisions.length>0))throw Error('This queue no longer matches the selected account or project. Reload Fabrication.');
 return c;
}
export function projectProgress(parts:FabricationPart[],boardId:string){const rows=parts.filter(p=>p.board_id===boardId),done=rows.filter(p=>p.status==='done').length;return {total:rows.length,done,percent:rows.length?Math.round(done/rows.length*100):0};}
export function readyQueue(parts:FabricationPart[]){return parts.filter(p=>p.status==='ready').sort((a,b)=>a.current_revision.needed_date.localeCompare(b.current_revision.needed_date)||a.current_revision.name.localeCompare(b.current_revision.name)||a.id.localeCompare(b.id));}
