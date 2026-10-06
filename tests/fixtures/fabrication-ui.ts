import type {FabricationAction,FabricationContext,FabricationPart,FabricationRevision,FabricationStatus} from '../../src/fabrication/types';
export const fabId=(n:number)=>`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const fabActor=fabId(1),fabSeason=fabId(100),fabProject=fabId(200),fabPart=fabId(300);
/** Synthetic fixtures only. No real team accounts, records or design files. */
export const syntheticDxf='0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n40\n21\n20\n0\nENDSEC\n0\nEOF\n';
export function fixtureActions(part:FabricationPart,actorId:string,enabled=true,supervisor=false):FabricationAction[]{
 if(!enabled)return [];const own=part.claimed_by===actorId,out:FabricationAction[]=[];
 if(!part.claimed_by&&part.status!=='done')out.push('claim');
 if(part.claimed_by&&(own||supervisor))out.push('release');
 if(own&&part.status!=='done'&&part.acknowledged_revision_id!==part.current_revision_id)out.push('acknowledge');
 if((own||supervisor)&&part.status==='needs_review')out.push('ready');
 if(own&&part.status==='ready'&&part.reviewed_revision_id===part.current_revision_id&&part.acknowledged_revision_id===part.current_revision_id)out.push('start');
 if(own&&part.status==='in_progress'&&part.reviewed_revision_id===part.current_revision_id&&part.acknowledged_revision_id===part.current_revision_id)out.push('done');
 if((own||supervisor)&&!['on_hold','done'].includes(part.status))out.push('hold');
 if((own||supervisor||part.can_revise)&&part.status!=='needs_review')out.push('rework');
 return out;
}
export function fabricationUIFixture():FabricationContext{
 const revision=(n:number,part:number,name:string,changes:Partial<FabricationRevision>={}):FabricationRevision=>({id:fabId(n),part_id:fabId(part),revision_number:1,name,material:'6061-T6 aluminum',thickness:3.175,thickness_unit:'mm',drawing_unit:'mm',quantity:2,needed_date:'2026-10-12',onshape_url:'https://cad.onshape.com/documents/syntheticdesign/w/syntheticworkspace/e/syntheticelement',notes:'Synthetic drawing for interface testing only.',dxf:{name:`synthetic-part-${part}-r1.dxf`,size:syntheticDxf.length,sha256:'a'.repeat(64)},pdf:{name:`synthetic-part-${part}-r1.pdf`,size:150,sha256:'b'.repeat(64)},created_by:fabActor,created_at:'2026-10-06T10:00:00Z',...changes});
 const old=revision(400,300,'Intake side plate, left',{quantity:1,notes:'Initial synthetic layout.'}),current=revision(401,300,'Intake side plate, left',{revision_number:2,notes:'Moved mounting holes 6 mm and added clearance for the shaft.',dxf:{name:'synthetic-intake-left-r2.dxf',size:syntheticDxf.length,sha256:'a'.repeat(64)},created_at:'2026-10-06T12:00:00Z'});
 const revisions=[old,current,revision(402,301,'Intake side plate, right',{pdf:null}),revision(403,302,'Roller spacer',{material:'Acetal',thickness:0.25,thickness_unit:'in',drawing_unit:'in',quantity:8,needed_date:'2026-10-09'}),revision(404,303,'Elevator carriage mount',{quantity:4,needed_date:'2026-10-08'}),revision(405,304,'Shaft support bracket',{material:'5052 aluminum',thickness:2,quantity:2,needed_date:'2026-10-14'})];
 const part=(n:number,board:number,revision:FabricationRevision,status:FabricationStatus,claim:boolean,ack:boolean):FabricationPart=>{const p:FabricationPart={id:fabId(n),board_id:fabId(board),status,status_note:'',version:2,current_revision_id:revision.id,current_revision:revision,claimed_by:claim?fabActor:null,claimant:claim?{id:fabActor,name:'Alex Builder',active:true}:null,acknowledged_revision_id:ack?revision.id:null,reviewed_revision_id:['ready','in_progress','done'].includes(status)?revision.id:null,created_by:fabActor,created_at:'2026-10-06T10:00:00Z',updated_at:'2026-10-06T12:00:00Z',can_revise:true,allowed_actions:[]};p.allowed_actions=fixtureActions(p,fabActor);return p;};
 return {user_id:fabActor,can_manage:false,is_operator:true,season_id:fabSeason,selected_project_id:null,loaded_at:'2026-10-06T13:00:00Z',seasons:[{id:fabSeason,name:'Synthetic 2026–27 season',status:'active'}],projects:[{id:fabProject,season_id:fabSeason,name:'Intake',active:true,can_submit:true,can_review:true,can_operate:true},{id:fabId(201),season_id:fabSeason,name:'Elevator',active:true,can_submit:true,can_review:true,can_operate:true},{id:fabId(202),season_id:fabSeason,name:'Drive practice rig',active:true,can_submit:false,can_review:true,can_operate:true}],parts:[part(300,200,current,'needs_review',true,false),part(301,200,revisions[2],'ready',false,false),part(302,200,revisions[3],'done',true,true),part(303,201,revisions[4],'ready',false,false),part(304,201,revisions[5],'in_progress',true,true)],revisions,parts_limit_reached:false};
}
