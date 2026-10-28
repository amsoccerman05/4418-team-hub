import {test,expect} from '@playwright/test';
import {taskChanges,reconcileTask,isPlanningConflict} from '../src/planning/task-reconciliation';
import type {Task} from '../src/planning/service';
const base:Task={id:'task',board_id:'board',title:'Cut shafts',description:'Measure first',status:'todo',priority:'normal',owner_ids:['member'],owners:[{id:'member',name:'Member'}],area_id:null,start_date:null,due_date:null,blocked_reason:'',version:1};
test('task review keeps typed fields and teammate-only changes with a fresh save version',()=>{
 const draft={...base,title:'My title',description:'My notes'},latest={...base,status:'in_progress',version:2};
 expect(taskChanges(base,draft,latest).map(c=>[c.key,c.conflict])).toEqual([['title',false],['description',false],['status',false]]);
 expect(reconcileTask(base,draft,latest,{})).toMatchObject({title:'My title',description:'My notes',status:'in_progress',version:2});
 expect(draft.version).toBe(1);expect(latest.title).toBe('Cut shafts');
});
test('overlapping changes require an explicit choice and never replace the draft automatically',()=>{
 const draft={...base,title:'My title',description:'My notes'},latest={...base,title:'Their title',description:'Their notes',priority:'high',version:2};
 expect(()=>reconcileTask(base,draft,latest,{})).toThrow(/Choose/);
 expect(()=>reconcileTask(base,draft,latest,{title:'draft'})).toThrow(/Choose/);
 expect(reconcileTask(base,draft,latest,{title:'draft',description:'latest'})).toMatchObject({title:'My title',description:'Their notes',priority:'high',version:2});
 expect(draft).toMatchObject({title:'My title',description:'My notes',version:1});
});
test('same changes, owner ordering, empty dates and a second conflict remain deterministic',()=>{
 const draft={...base,owner_ids:['other','member'],title:'Agreed'},latest={...base,owner_ids:['member','other'],title:'Agreed',version:2};
 expect(taskChanges(base,draft,latest).every(c=>!c.conflict)).toBe(true);
 const merged=reconcileTask(base,draft,latest,{});const newest={...latest,status:'done',version:3};
 expect(reconcileTask(latest,{...merged,description:'Still mine'},newest,{})).toMatchObject({description:'Still mine',status:'done',version:3});
 expect(taskChanges({...base,due_date:undefined},{...base,due_date:''},base)).toEqual([]);
});
test('wrong task, stale version and non-conflict errors cannot authorize a rebase',()=>{
 for(const latest of [{...base,id:'other'},{...base,version:0},{...base,version:NaN}])expect(()=>reconcileTask(base,base,latest,{})).toThrow(/cannot be reviewed/);
 expect(isPlanningConflict(new Error('Changed by another teammate. Refresh before saving.'))).toBe(true);
 for(const e of [new Error('Network unavailable'),new Error('Permission denied'),new Error('Changed by another teammate?'),null])expect(isPlanningConflict(e)).toBe(false);
});
