import type {GoalSavePayload,GoalUpdatePayload,GoalsContext,SeasonGoal,GoalUpdate} from './types';

export const categories={engineering:'Engineering',performance:'Performance',fundraising:'Fundraising',team_growth:'Team growth'} as const;
export const statuses={on_track:'On track',at_risk:'At risk',blocked:'Blocked',achieved:'Completed'} as const;
export const directions={increase:'Higher is better',decrease:'Lower is better',equal:'Maintain this value'} as const;
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function goalRoute(route:string):{valid:boolean;id:string|null}{
 if(route==='#planning/goals')return {valid:true,id:null};
 const match=/^#planning\/goals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(route);
 return {valid:!!match&&route.startsWith('#planning/goals/'),id:match?.[1].toLowerCase()||null};
}
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;}
export function finiteValue(value:string){if(!value.trim())return null;const n=Number(value);return Number.isFinite(n)&&Math.abs(n)<=1e12?n:null;}
export function validEvidenceUrl(value:string){try{if(typeof value!=='string'||/\s/.test(value)||!value.startsWith('https://'))return false;const u=new URL(value);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&u.href.length<=2000;}catch{return false;}}
const known=(x:unknown,choices:object)=>typeof x==='string'&&Object.hasOwn(choices,x);
const listValid=(list:string[])=>Array.isArray(list)&&list.length<=50&&list.every(x=>uuid.test(x))&&new Set(list).size===list.length;
export function validateDefinition(p:GoalSavePayload):string|null{
 if(!Number.isSafeInteger(p.expected_version)||p.expected_version<0)return 'Refresh this goal before saving its current version.';
 if(!p.title.trim()||p.title.length>200)return 'Enter a goal title of 200 characters or fewer.';
 if(p.description.length>5000)return 'Keep the description under 5,000 characters.';
 if(!uuid.test(p.owner_id)||!uuid.test(p.season_id)||!uuid.test(p.id)||!uuid.test(p.operation_id))return 'Choose a valid student owner and season.';
 if(!known(p.category,categories)||!known(p.direction,directions))return 'Choose a category and measurement direction.';
 if(!p.unit.trim()||p.unit.length>60)return 'Enter a unit of 60 characters or fewer.';
 if(![p.baseline,p.target].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e12))return 'Baseline and target must be finite numbers between −1 trillion and 1 trillion.';
 if(p.direction==='increase'&&p.target<=p.baseline||p.direction==='decrease'&&p.target>=p.baseline||p.direction==='equal'&&p.target!==p.baseline)return 'The target must match the selected direction. Choose “Maintain this value” for an unchanged target.';
 if(!validDate(p.deadline))return 'Choose a valid deadline.';
 if(p.category==='fundraising'&&!['pledged','received'].includes(p.fundraising_measure||''))return 'Choose pledged or received funds.';
 if(p.category!=='fundraising'&&p.fundraising_measure!==null)return 'Only fundraising goals have a funds measure.';
 if(![p.supporter_ids,p.task_ids,p.milestone_ids].every(listValid))return 'Choose up to 50 different records per list.';
 if(p.supporter_ids.includes(p.owner_id))return 'The owner is already responsible for this goal; choose other supporters.';
 if(p.next_milestone_id&&!uuid.test(p.next_milestone_id))return 'Choose a valid next milestone.';
 if(p.next_milestone_id&&!p.milestone_ids.includes(p.next_milestone_id))return 'The next milestone must also be linked to this goal.';
 return null;
}
export function validateUpdate(p:GoalUpdatePayload,maxDate=today()):string|null{
 if(!Number.isSafeInteger(p.expected_version)||p.expected_version<1)return 'Refresh this goal before saving an update.';
 if(!uuid.test(p.id)||!uuid.test(p.goal_id)||!uuid.test(p.operation_id))return 'This goal is unavailable. Refresh and try again.';
 if(!known(p.status,statuses)||!['weekly','measurement'].includes(p.kind))return 'Choose an update type and reported status.';
 if(!validDate(p.observed_on)||p.observed_on>maxDate)return 'Choose a valid observed date no later than today.';
 if(p.kind==='measurement'&&(p.measured_value===null||!Number.isFinite(p.measured_value)||Math.abs(p.measured_value)>1e12))return 'Enter a finite measured value between −1 trillion and 1 trillion.';
 if(p.kind==='weekly'&&p.measured_value!==null)return 'Weekly notes do not change the measured value.';
 if(!p.evidence.trim()||p.evidence.length>5000)return 'Describe what you observed, in 5,000 characters or fewer.';
 if(!p.next_step.trim()||p.next_step.length>2000)return 'Add the next step, or explain why no further action is needed.';
 if(p.evidence_url&&(p.evidence_url.length>2000||!validEvidenceUrl(p.evidence_url)))return 'Use an HTTPS evidence link without sign-in details.';
 return null;
}
export function assertContext(data:GoalsContext,actor:string,season:string):GoalsContext{
 const fail=()=>{throw Error('Season goals could not be verified for this session. Refresh to try again.');};
 const text=(x:unknown,max=5000)=>typeof x==='string'&&Array.from(x).length<=max;
 const id=(x:unknown)=>typeof x==='string'&&uuid.test(x);
 const numeric=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e12;
 const time=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(x)&&Number.isFinite(Date.parse(x));
 const bools=(x:unknown,keys:string[])=>!!x&&typeof x==='object'&&keys.every(k=>typeof (x as Record<string,unknown>)[k]==='boolean');
 const person=(x:unknown):boolean=>!!x&&typeof x==='object'&&id((x as any).id)&&text((x as any).name,200)&&typeof (x as any).active==='boolean';
 const unique=(xs:unknown[],get:(x:any)=>unknown)=>new Set(xs.map(get)).size===xs.length;
 const ids=(xs:unknown)=>Array.isArray(xs)&&xs.every(id)&&unique(xs,x=>x);
 if(!data||!id(actor)||!id(season)||data.user_id!==actor||data.season_id!==season||data.season?.id!==season||!text(data.season.name,200)||!['draft','active','archived'].includes(data.season.status)||!bools(data.capabilities,['can_create','can_manage','can_reassign'])||!['goals','members','eligible_owners','tasks','milestones'].every(k=>Array.isArray(data[k as keyof GoalsContext])))return fail();
 if(!data.members.every(person)||!data.eligible_owners.every(person)||!data.members.every(p=>p.active)||!data.eligible_owners.every(p=>p.active)||![data.members,data.eligible_owners,data.goals,data.tasks,data.milestones].every(xs=>unique(xs,x=>x?.id)))return fail();
 if(data.season.status==='archived'&&(data.capabilities.can_create||data.capabilities.can_reassign))return fail();
 for(const goal of data.goals){
  if(!goal||!id(goal.id)||goal.season_id!==season||!text(goal.title,200)||!goal.title.trim()||!text(goal.description)||!id(goal.owner_id)||!person(goal.owner)||goal.owner.id!==goal.owner_id||!id(goal.created_by)||!numeric(goal.baseline)||!numeric(goal.target)||!text(goal.unit,60)||!goal.unit.trim()||!known(goal.category,categories)||!known(goal.direction,directions)||!validDate(goal.deadline)||!Number.isSafeInteger(goal.version)||goal.version<1||!time(goal.created_at)||!time(goal.updated_at)||!bools(goal.capabilities,['can_edit','can_update','can_reassign'])||typeof goal.measurement_locked!=='boolean'||!Array.isArray(goal.updates)||!ids(goal.supporter_ids)||!ids(goal.task_ids)||!ids(goal.milestone_ids)||!Array.isArray(goal.supporters)||!goal.supporters.every(person)||!unique(goal.supporters,p=>p.id)||goal.supporters.length!==goal.supporter_ids.length||goal.supporters.some(p=>!goal.supporter_ids.includes(p.id))||goal.supporter_ids.includes(goal.owner_id)||goal.next_milestone_id!==null&&!id(goal.next_milestone_id))return fail();
  if(goal.category==='fundraising'?!['pledged','received'].includes(goal.fundraising_measure||''):goal.fundraising_measure!==null)return fail();
  if(goal.direction==='increase'&&goal.target<=goal.baseline||goal.direction==='decrease'&&goal.target>=goal.baseline||goal.direction==='equal'&&goal.target!==goal.baseline)return fail();
  if([goal.supporter_ids,goal.task_ids,goal.milestone_ids].some(xs=>xs.length>50)||goal.next_milestone_id!==null&&!goal.milestone_ids.includes(goal.next_milestone_id))return fail();
  if(goal.measurement_locked!==(goal.updates.length>0)||!unique(goal.updates,u=>u?.id)||!unique(goal.updates,u=>u?.goal_version)||data.season.status==='archived'&&Object.values(goal.capabilities).some(Boolean))return fail();
  for(const update of goal.updates){
   if(!update||!id(update.id)||update.goal_id!==goal.id||!['measurement','weekly'].includes(update.kind)||!known(update.status,statuses)||!text(update.evidence)||!update.evidence.trim()||!text(update.next_step,2000)||!update.next_step.trim()||!validDate(update.observed_on)||!id(update.author_id)||!person(update.author)||update.author.id!==update.author_id||!time(update.created_at)||!Number.isSafeInteger(update.goal_version)||update.goal_version<2||update.goal_version>goal.version||update.evidence_url!==null&&!text(update.evidence_url,2000)||update.kind==='measurement'&&!numeric(update.measured_value)||update.kind==='weekly'&&update.measured_value!==null)return fail();
  }
 }
 for(const task of data.tasks){if(!task||!id(task.id)||!text(task.title,200)||typeof task.available!=='boolean'||!ids(task.owner_ids)||!['backlog','todo','in_progress','blocked','done','unavailable'].includes(task.status)||task.board_id!==null&&!id(task.board_id)||task.available&&(task.board_id===null||task.status==='unavailable'))return fail();if(!task.available&&!data.capabilities.can_manage&&(task.title!=='Unavailable task'||task.status!=='unavailable'||task.board_id!==null||task.owner_ids.length!==0))return fail();}
 for(const item of data.milestones){if(!item||!id(item.id)||!text(item.title,200)||typeof item.available!=='boolean')return fail();if(item.start_date===null){if(item.available||item.title!=='Unavailable milestone'||item.status!=='unavailable')return fail();}else if(!validDate(item.start_date)||!['not_started','in_progress','blocked','done'].includes(item.status))return fail();}
 return data;
}
export function latestUpdate(goal:SeasonGoal):GoalUpdate|undefined{return [...goal.updates].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))[0];}
export function latestMeasurement(goal:SeasonGoal):GoalUpdate|undefined{return [...goal.updates].filter(u=>u.kind==='measurement'&&u.measured_value!==null).sort((a,b)=>b.observed_on.localeCompare(a.observed_on)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))[0];}
export function measurementSummary(goal:SeasonGoal){const m=latestMeasurement(goal);const value=m?.measured_value??null;return {value,observedOn:m?.observed_on||null,reached:value===null?false:goal.direction==='decrease'?value<=goal.target:goal.direction==='increase'?value>=goal.target:value===goal.target};}
export const numberLabel=(n:number)=>new Intl.NumberFormat(undefined,{maximumSignificantDigits:15}).format(n);
