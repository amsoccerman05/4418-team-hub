/** Additive Season Goals contract. These scoped capabilities do not grant task or Finance rights. */
export type GoalCategory = 'engineering' | 'performance' | 'fundraising' | 'team_growth';
export type GoalDirection = 'increase' | 'decrease' | 'equal';
export type GoalStatus = 'on_track' | 'at_risk' | 'blocked' | 'achieved';
export type FundraisingMeasure = 'pledged' | 'received';
export type GoalPerson = {id:string;name:string;active:boolean};
export type GoalCapabilities = {can_edit:boolean;can_update:boolean;can_reassign:boolean};
export type GoalUpdate = {
 id:string;goal_id:string;kind:'measurement'|'weekly';measured_value:number|null;status:GoalStatus;
 evidence:string;evidence_url:string|null;next_step:string;observed_on:string;
 author_id:string;author:GoalPerson;created_at:string;goal_version:number;
};
export type SeasonGoal = {
 id:string;season_id:string;title:string;description:string;category:GoalCategory;owner_id:string;
 owner:GoalPerson;baseline:number;target:number;unit:string;direction:GoalDirection;deadline:string;
 fundraising_measure:FundraisingMeasure|null;next_milestone_id:string|null;
 supporter_ids:string[];supporters:GoalPerson[];task_ids:string[];milestone_ids:string[];
 version:number;created_by:string;created_at:string;updated_at:string;
 capabilities:GoalCapabilities;measurement_locked:boolean;updates:GoalUpdate[];
};
export type GoalTaskChoice = {id:string;board_id:string|null;title:string;status:string;owner_ids:string[];available:boolean};
export type GoalMilestoneChoice = {id:string;title:string;start_date:string|null;status:string;available:boolean};
export type GoalsContext = {
 user_id:string;season_id:string|null;season:{id:string;name:string;status:'draft'|'active'|'archived'}|null;
 capabilities:{can_create:boolean;can_manage:boolean;can_reassign:boolean};
 eligible_owners:GoalPerson[];members:GoalPerson[];goals:SeasonGoal[];
 tasks:GoalTaskChoice[];milestones:GoalMilestoneChoice[];
};
export type GoalSavePayload = {
 operation_id:string;id:string;expected_version:number;season_id:string;title:string;description:string;
 category:GoalCategory;owner_id:string;baseline:number;target:number;unit:string;direction:GoalDirection;
 deadline:string;fundraising_measure:FundraisingMeasure|null;supporter_ids:string[];
 task_ids:string[];milestone_ids:string[];next_milestone_id:string|null;
};
export type GoalUpdatePayload = {
 operation_id:string;id:string;goal_id:string;expected_version:number;kind:'measurement'|'weekly';
 measured_value:number|null;status:GoalStatus;evidence:string;evidence_url:string|null;
 next_step:string;observed_on:string;
};
export type GoalOperationResult = {goal_id:string;version:number;update_id:string|null};
export type GoalOperationReceipt =
 | {status:'committed';operation_id:string;result:GoalOperationResult}
 | {status:'cancelled';operation_id:string;result:null}
 | {status:'not_found';operation_id:string;result:null};
// RPCs: planning_goals_context({selected_season}), planning_goal_save({p,expected_actor}),
// planning_goal_update({p,expected_actor}), planning_goal_operation_status({operation_id,expected_actor}),
// planning_goal_operation_cancel({operation_id,expected_actor}). expected_version is 0 for create.
// expected_actor must equal auth.uid(); it protects a delayed request from a changed session.
// Uncertain transport is never retried automatically. Status is observational; not_found
// is not a promise that a delayed request cannot apply. Cancel establishes a tombstone
// or returns the original committed receipt before editing/replacing an uncertain request.
