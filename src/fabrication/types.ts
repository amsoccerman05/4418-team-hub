/** Fabrication references canonical Planning project boards. */
export type FabricationStatus='needs_review'|'ready'|'in_progress'|'done'|'on_hold';
export type FabricationAction='claim'|'release'|'acknowledge'|'ready'|'start'|'done'|'hold'|'rework';
export type FabricationFileKind='dxf'|'pdf';
export type FabricationPerson={id:string;name:string;active:boolean};
export type FabricationSeason={id:string;name:string;status:'draft'|'active'|'archived'};
export type FabricationProject={id:string;season_id:string;name:string;active:boolean;can_submit:boolean;can_review:boolean;can_operate:boolean};
export type FabricationFile={name:string;size:number;sha256:string};
export type FabricationManifest={dxf:FabricationFile;pdf:FabricationFile|null};
export type FabricationMetadata={name:string;material:string;thickness:number;thickness_unit:'mm'|'in';drawing_unit:'mm'|'in';quantity:number;needed_date:string;onshape_url:string;notes:string};
export type FabricationRevision=FabricationMetadata & {id:string;part_id:string;revision_number:number;dxf:FabricationFile;pdf:FabricationFile|null;created_by:string;created_at:string};
export type FabricationPart={id:string;board_id:string;status:FabricationStatus;status_note:string;version:number;current_revision_id:string;current_revision:FabricationRevision;claimed_by:string|null;claimant:FabricationPerson|null;acknowledged_revision_id:string|null;reviewed_revision_id:string|null;created_by:string;created_at:string;updated_at:string;can_revise:boolean;allowed_actions:FabricationAction[]};
export type FabricationContext={user_id:string;can_manage:boolean;is_operator:boolean;season_id:string|null;selected_project_id:string|null;loaded_at:string;seasons:FabricationSeason[];projects:FabricationProject[];parts:FabricationPart[];revisions:FabricationRevision[];parts_limit_reached:boolean};
export type FabricationSubmission=FabricationMetadata & {part_id:string;board_id:string;version:number|null;revision_id:string};
export type FabricationActionPayload={part_id:string;version:number;revision_id:string;note:string};
export type FabricationMutation={action:FabricationAction;request_id:string;expected_actor:string;p:FabricationActionPayload};
export type FabricationUpload={request_id:string;expected_actor:string;p:FabricationSubmission};
/** Only opaque recovery IDs may survive editor close/account changes. */
export type FabricationRecovery={request_id:string;expected_actor:string};
export type FabricationReceipt={request_id:string;status:'applied'|'cancelled'|'unknown'|'pending';action:FabricationAction|'revision'|null;entity_id:string|null;version:number|null};
/** Service-only ingress contract. Paths/leases must never be accepted from the browser. */
export type FabricationReservation={receipt:FabricationReceipt;reservation:null|{lease_id:string;revision_id:string;bucket:'fabrication-private';dxf_path:string;pdf_path:string|null;manifest:FabricationManifest}};
export const FABRICATION_DXF_MAX_BYTES=20*1024*1024;
export const FABRICATION_PDF_MAX_BYTES=10*1024*1024;
