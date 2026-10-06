import type {Context,Task} from './service';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function personalTaskFromRoute(route:string,data:Context):Task|null {
 const match=/^#planning\/my-work\/([^/]+)$/.exec(route);
 if(!match||!uuid.test(match[1]))return null;
 const task=data.tasks.find(t=>t.id.toLowerCase()===match[1].toLowerCase()&&t.owner_ids.includes(data.user_id));
 const board=task&&data.boards.find(b=>b.id===task.board_id&&b.active);
 return task&&board&&(board.kind==='area'||data.seasons.some(s=>s.id===board.season_id&&s.status==='active'))?task:null;
}
