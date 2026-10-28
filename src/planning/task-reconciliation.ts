import type {Task} from './service';
export const taskEditFields={title:'Title',description:'Description',status:'Status',priority:'Priority',owner_ids:'Owners',area_id:'Functional area',start_date:'Start date',due_date:'Due date',blocked_reason:'Blocked reason'} as const;
export type TaskEditField=keyof typeof taskEditFields;
export type TaskChoices=Partial<Record<TaskEditField,'draft'|'latest'>>;
type Draft=Record<string,unknown>;
const same=(key:TaskEditField,a:unknown,b:unknown)=>JSON.stringify(key==='owner_ids'?[...(a as string[]||[])].sort():a??'')===JSON.stringify(key==='owner_ids'?[...(b as string[]||[])].sort():b??'');
export function taskChanges(base:Draft,draft:Draft,latest:Task){
 return (Object.keys(taskEditFields) as TaskEditField[]).filter(key=>!same(key,base[key],draft[key])||!same(key,base[key],latest[key])).map(key=>({key,label:taskEditFields[key],draftChanged:!same(key,base[key],draft[key]),latestChanged:!same(key,base[key],latest[key]),conflict:!same(key,base[key],draft[key])&&!same(key,base[key],latest[key])&&!same(key,draft[key],latest[key])}));
}
/** Never rebase a draft until the user has chosen every overlapping change. */
export function reconcileTask(base:Draft,draft:Draft,latest:Task,choices:TaskChoices):Draft {
 if(base.id!==latest.id||draft.id!==latest.id||!Number.isSafeInteger(latest.version)||latest.version<Number(base.version))throw Error('This task version cannot be reviewed. Refresh the latest task again.');
 const result:Draft={...latest};
 for(const change of taskChanges(base,draft,latest)){
  if(change.conflict&&!choices[change.key])throw Error('Choose which version to keep for each conflicting field.');
  if(change.draftChanged&&(!change.conflict||choices[change.key]==='draft'))result[change.key]=draft[change.key];
 }
 return result;
}
export const isPlanningConflict=(error:unknown)=>error instanceof Error&&error.message==='Changed by another teammate. Refresh before saving.';
