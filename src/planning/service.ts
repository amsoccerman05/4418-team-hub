import {supabase} from '../attendance/service';
export type Named={id:string;name:string};
export type Season=Named&{start_date:string|null;end_date:string|null;status:'draft'|'active'|'archived';version:number};
export type Group=Named&{season_id:string;display_order:number;active:boolean;version:number};
export type Board=Named&{season_id:string|null;description:string;kind:'project'|'area';area_id:string|null;active:boolean;display_order:number;version:number};
export type Item={id:string;season_id:string;title:string;description:string;kind:'work'|'milestone';start_date:string;end_date:string;status:string;group_id:string|null;board_id:string|null;owner_id:string|null;area_id:string|null;predecessor_id:string|null;display_order:number;version:number};
export type Owner=Named&{active?:boolean};
export type Task={id:string;board_id:string;title:string;description:string;status:string;priority:string;owner_ids:string[];owners:Owner[];area_id:string|null;start_date:string|null;due_date:string|null;blocked_reason:string;version:number};
export type Step={id:string;task_id:string;text:string;done:boolean;display_order:number;version:number};
export type Detail={steps:Step[];comments:{id:string;text:string;author_id:string;created_at:string}[];history:{id:number;entity:string;action:string;actor_id:string;created_at:string;before_data:Record<string,unknown>|null;after_data:Record<string,unknown>}[]};
export type Dependency={id:string;board_id:string;predecessor_task_id:string;successor_task_id:string};
export const changeDependency=(action:'add'|'remove',p:{predecessor?:string;successor?:string;dependency_id?:string})=>rpc<string>('planning_dependency_save',{action,...p});
export type Context={user_id:string;can_manage:boolean;season_id:string|null;seasons:Season[];members:Named[];areas:Named[];groups:Group[];items:Item[];boards:Board[];tasks:Task[];dependency_tasks?:Pick<Task,'id'|'board_id'|'title'|'status'>[];dependencies?:Dependency[]};
async function rpc<T>(name:string,args:Record<string,unknown>){if(!supabase)throw new Error('Team connection unavailable.');const {data,error}=await supabase.rpc(name,args).abortSignal(AbortSignal.timeout(15000));if(error)throw new Error(error.message.includes('planning_one_active')?'Another planning season is active. Archive it before activating this one.':error.message);return data as T;}
export const loadPlanning=(selected_season:string|null=null,myWork=false)=>rpc<Context>(myWork?'planning_my_work_context':'planning_context',{selected_season});
export const savePlanning=(entity:string,p:Record<string,unknown>)=>rpc<string>('planning_save',{entity,p});
export const taskDetail=(task:string)=>rpc<Detail>('planning_task_detail',{task});
export const taskStatuses={backlog:'Backlog',todo:'To Do',in_progress:'In Progress',blocked:'Blocked',done:'Done'};
export const planStatuses={not_started:'Not started',in_progress:'In progress',blocked:'Blocked',done:'Done'};
export const priorities={low:'Low',normal:'Normal',high:'High',urgent:'Urgent'};
export const localDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function workGroup(t:Task,today=localDate()){if(t.status==='blocked')return 'Blocked';if(!t.due_date)return 'Later';if(t.due_date<today)return 'Overdue';if(t.due_date===today)return 'Today';const end=new Date(`${today}T12:00:00`);end.setDate(end.getDate()+((7-end.getDay())%7));return t.due_date<=localDate(end)?'This week':'Later';}
