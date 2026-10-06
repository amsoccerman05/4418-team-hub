import type {ReviewExportSnapshot} from '../../src/planning/reviews/export/snapshot';
/** Demonstration only. No historical people, robot values, or actual review records. */
export function syntheticReviewSnapshot():ReviewExportSnapshot{return {
 schemaVersion:1,reviewId:'synthetic-review',title:'Synthetic Sprint Review sample',reviewDate:'2026-10-06',season:'Synthetic season',chair:'Demo chair',asOf:'2026-10-06T12:00:00Z',
 agenda:[{title:'Synthetic project discussion',presenter:'Demo student',minutes:10},{title:'Next sprint discussion',presenter:null,minutes:5}],
 projects:[{id:'demo-project',name:'Example project',lead:'Demo student',supporters:['Demo supporter'],update:{
  progress:'Synthetic example: a team recorded a test plan. No test result is asserted.',blockers:'Synthetic example: supporting evidence is still missing.',
  evidence:[{label:'Synthetic evidence reference',referenceId:'DEMO-TEST',url:'https://example.com/evidence',missingReason:null}],
  tradeoffs:'Synthetic example: compare access for maintenance with available space.',decisionsNeeded:'No actual decision is requested by this sample.',
  reportedDecision:'No actual decision is recorded.',decisionRationale:'Not applicable to this demonstration.',
  decisionReferences:[{label:'Synthetic architecture register',referenceId:'DEMO-AD',url:'https://example.com/decisions',missingReason:null}],
  reportedBy:['Demo student'],nextTest:'Synthetic example: attach the next test procedure.',
  nextTask:{title:'Synthetic next task',status:'todo',owners:['Demo student'],dueDate:null,dateUnavailable:false,available:true},unresolved:true,carriedFrom:null}}],priorUnresolved:[]
};}
