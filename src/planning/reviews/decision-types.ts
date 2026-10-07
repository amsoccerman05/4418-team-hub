import type {ReviewReference} from './types';

/** A comparison inside one existing project review update, never a second architecture register. */
export type DecisionOption = {
 id:string;label:string;description:string;
 weight:string;space:string;cost:string;reliability:string;time:string;
 evidence:ReviewReference[];
 swot?:DecisionSwot|null;
};
export type DecisionSwot={strengths:string;weaknesses:string;opportunities:string;threats:string};
/** Raw engineering measurements, not ordinal scores. Bounds explain normalization. */
export type TradeCriterion={
 id:string;label:string;unit:string;weight:number;
 scale_min:number;scale_max:number;direction:'higher'|'lower';
 must_have:boolean;minimum:number|null;maximum:number|null;
};
export type TradeAssessment={option_id:string;criterion_id:string;value:number|null;reason:string;evidence:ReviewReference[]};
export type EngineeringTradeStudy={criteria:TradeCriterion[];assessments:TradeAssessment[]};
export type DecisionWorkflow = {
 schema_version:1;status:'comparing'|'recorded'|'reopened';
 owner_id:string|null;target_date:string|null;decided_on:string|null;
 requirements:ReviewReference[];options:DecisionOption[];
 chosen_option_id:string|null;reopen_criteria:string;
 trade_study?:EngineeringTradeStudy|null;
};
