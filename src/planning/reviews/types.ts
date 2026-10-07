import type {DecisionWorkflow} from './decision-types';
/** Sprint Review is a meeting record. Planning remains authoritative for work/owners/dates. */
export type ReviewPerson = {id:string;name:string;active:boolean;is_student:boolean;can_write:boolean};
export type ReviewSeason = {id:string;name:string;status:'draft'|'active'|'archived'};
export type ReviewReference = {label:string;url:string;reference_id:string};
export type ReviewAgendaItem = {title:string;presenter_id:string|null;duration_minutes:number};
export type SprintReview = {
  id:string;season_id:string;title:string;review_date:string;chair_id:string|null;
  agenda:ReviewAgendaItem[];version:number;recorded_by:string;recorded_at:string;
};
export type ProjectReviewAssignment = {
  board_id:string;lead_id:string|null;supporter_ids:string[];version:number;
  lead:ReviewPerson|null;supporters:ReviewPerson[];
};
export type ReviewBoard = {id:string;season_id:string;name:string;active:boolean;can_edit_update:boolean;assignment:ProjectReviewAssignment|null};
export type ReviewTask = {
  id:string;board_id:string|null;title:string;status:string|null;available:boolean;
  owner_ids:string[];owners:ReviewPerson[];due_date:string|null;due_date_unavailable:boolean;
};
export type ProjectReviewUpdate = {
  id:string;review_id:string;board_id:string;decision_workflow?:DecisionWorkflow|null;decision_owner?:ReviewPerson|null;progress:string;blockers:string;
  evidence:ReviewReference[];tradeoffs:string;decisions_needed:string;
  decision_references:ReviewReference[];reported_decision:string;decision_rationale:string;
  reported_by_student_ids:string[];reported_students:ReviewPerson[];
  next_test:string;linked_task_id:string|null;linked_task:ReviewTask|null;
  carry_from_update_id:string|null;
  carried_from:{update_id:string;review_id:string;review_title:string;review_date:string}|null;
  unresolved:boolean;version:number;recorded_by:string;recorded_at:string;
};
export type SprintReviewContext = {
  user_id:string;can_manage:boolean;season_id:string|null;selected_review_id:string|null;
  loaded_at:string;seasons:ReviewSeason[];members:ReviewPerson[];boards:ReviewBoard[];
  reviews:SprintReview[];reviews_limit_reached:boolean;updates:ProjectReviewUpdate[];
  previous_updates:ProjectReviewUpdate[];tasks:ReviewTask[];
};
export type ReviewSave = Pick<SprintReview,'id'|'season_id'|'title'|'review_date'|'chair_id'|'agenda'> & {version:number|null};
export type AssignmentSave = Pick<ProjectReviewAssignment,'board_id'|'lead_id'|'supporter_ids'> & {version:number|null};
export type UpdateSave = Pick<ProjectReviewUpdate,
  'id'|'review_id'|'board_id'|'decision_workflow'|'progress'|'blockers'|'evidence'|'tradeoffs'|'decisions_needed'|
  'decision_references'|'reported_decision'|'decision_rationale'|'reported_by_student_ids'|
  'next_test'|'linked_task_id'|'carry_from_update_id'|'unresolved'> & {version:number|null};
export type ReviewSaveAction = 'review'|'assignment'|'update';
export type ReviewSavePayload = ReviewSave|AssignmentSave|UpdateSave;
export type ReviewMutation = {action:ReviewSaveAction;request_id:string;expected_actor:string;p:ReviewSavePayload};
/** Safe to retain after closing an editor: no draft content or bearer credentials. */
export type ReviewRecovery = {request_id:string;expected_actor:string};
/** unknown means there is no committed receipt; do not assume a timed-out save failed. */
export type ReviewMutationReceipt = {
  request_id:string;status:'applied'|'cancelled'|'unknown';action:ReviewSaveAction|null;
  entity_id:string|null;version:number|null;
};
