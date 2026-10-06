/** Local V2 contract. Production rollout remains held. */
export type OutreachEntity = 'prospect' | 'organization' | 'contact' | 'engagement' | 'conversation' | 'pledge' | 'recognition';
export type Named = {id:string; name:string};
export type Versioned = {id:string; version:number; created_at:string; updated_at:string; created_by:string};
export type Season = Named & {status:'draft'|'active'|'closed'; starts_on:string|null; ends_on:string|null};
export type PrivateNotes = {notes:string|null; notes_redacted:boolean};
export type Organization = Versioned & PrivateNotes & {kind:'organization'|'person'; name:string; website:string; active:boolean; can_edit:boolean; can_add_contact:boolean; can_create_engagement:boolean};
export type Contact = Versioned & PrivateNotes & {organization_id:string; name:string; title:string; email:string; phone:string; active:boolean; can_edit:boolean};
export type EngagementStage = 'prospect'|'contacted'|'discussing'|'committed'|'closed';
export type Engagement = Versioned & PrivateNotes & {organization_id:string; season_id:string; stage:EngagementStage; owner_id:string|null; next_follow_up_on:string|null; can_edit:boolean; can_log:boolean; can_assign:boolean};
export type Conversation = Versioned & {engagement_id:string; contact_id:string|null; occurred_on:string; channel:'email'|'phone'|'meeting'|'other'; summary:string|null; summary_redacted:boolean; author_name:string; can_edit:false};
export type Pledge = Versioned & {engagement_id:string; kind:'cash'|'in_kind'; amount:number|null; description:string; promised_on:string; expected_on:string|null; status:'pledged'|'canceled'};
export type Recognition = Versioned & {engagement_id:string; pledge_id:string|null; owner_id:string|null; kind:'logo'|'recognition'|'thank_you'|'other'; description:string; due_on:string|null; status:'promised'|'fulfilled'|'waived'; fulfilled_on:string|null; fulfillment_note:string};
/** Finance owns the amount/status/date. This is a restricted read-only projection. */
export type Income = {id:string; season_id:string; source:string; income_type:string; amount:number; status:'expected'|'received'|'canceled'; expected_on:string|null; received_on:string|null; reference:string};
export type IncomeLink = {id:string; pledge_id:string; income_id:string; created_by:string; created_at:string};
export type OutreachContext = {contract_version:2; user_id:string; can_manage:boolean; can_create_prospect:boolean; can_link_finance:boolean; financials_redacted:boolean; season_id:string|null; seasons:Season[]; owners:Named[]; organizations:Organization[]; contacts:Contact[]; engagements:Engagement[]; conversations:Conversation[]; pledges:Pledge[]; recognition:Recognition[]; income:Income[]; income_links:IncomeLink[]};
export type SaveResult = {id:string; version:number};
export type CancelResult = {status:'applied'; result:SaveResult}|{status:'canceled'};
export type RequestStatus = CancelResult|{status:'not_found'};
export type SavePayload = Record<string,unknown> & {id:string; version:number};
