import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import type {UpdateSave,ReviewSave,AssignmentSave,ReviewSavePayload,ReviewSaveAction,SprintReviewContext,ReviewMutationReceipt} from '../../src/planning/reviews/types';
export const reviewId=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const sprintReviewMigration=()=>readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(x=>x.endsWith('_sprint_review_v1.sql')),'utf8');
export const sprintReviewBaseSQL=readFileSync('tests/fixtures/sprint-review-base.sql','utf8');
export async function createReviewDatabase(){
 const db=new PGlite();await db.exec(sprintReviewBaseSQL);
 for(const x of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql'])await db.exec(readFileSync('supabase/migrations/'+x,'utf8'));
 const untouched=async()=>({
  functions:(await db.query("select p.oid,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='planning_private' or (n.nspname='public' and p.proname like 'planning_%') order by p.oid")).rows,
  relations:(await db.query("select c.oid,c.relname,c.relacl::text,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='planning_private' or n.nspname='public') order by c.oid")).rows,
 });
 const before=await untouched(),migration=sprintReviewMigration();
 await assert.rejects(db.exec(migration.replace(/commit;\s*$/,()=>"do $$begin raise exception 'synthetic migration rollback';end$$;commit;")),/synthetic migration rollback/);
 await db.exec('rollback');
 assert.deepEqual(await untouched(),before);
 assert.equal((await db.query<{id:unknown}>("select to_regnamespace('planning_review_private') id")).rows[0].id,null);
 await db.exec(migration);
 const after=await untouched();
 assert.deepEqual(after.functions,before.functions);
 assert.deepEqual(after.relations.filter((x:any)=>!['planning_sprint_reviews','planning_project_review_assignments','planning_project_review_supporters','planning_sprint_review_updates'].includes(x.relname)),before.relations);
 return db;
}
export async function asReviewUser(db:PGlite,n:number){await db.exec(`reset role;select set_config('test.uid','${reviewId(n)}',false);set role authenticated;`);}
export async function planningFixture(db:PGlite){
 await asReviewUser(db,1);
 const save=async(entity:string,p:Record<string,unknown>)=>(await db.query<{id:string}>('select planning_save($1,$2) id',[entity,JSON.stringify(p)])).rows[0].id;
 const season=await save('season',{id:reviewId(101),name:'Synthetic season',status:'active'});
 const draft=await save('season',{id:reviewId(102),name:'Draft season',status:'draft'});
 const board=await save('board',{id:reviewId(201),season_id:season,kind:'project',name:'Cross-functional robot project'});
 const otherBoard=await save('board',{id:reviewId(202),season_id:season,kind:'project',name:'Another project'});
 const draftBoard=await save('board',{id:reviewId(203),season_id:draft,kind:'project',name:'Private project'});
 const areaBoard=await save('board',{id:reviewId(204),kind:'area',name:'Persistent service board'});
 const task=await save('task',{id:reviewId(301),board_id:board,title:'Canonical next test',status:'todo',priority:'normal',owner_ids:[reviewId(3),reviewId(4)],due_date:'2026-10-10'});
 const areaTask=await save('task',{id:reviewId(302),board_id:areaBoard,title:'Shared support work',status:'todo',priority:'normal',owner_ids:[]});
 const privateTask=await save('task',{id:reviewId(303),board_id:draftBoard,title:'Private task secret',status:'todo',priority:'normal',owner_ids:[]});
 return{season,draft,board,otherBoard,draftBoard,areaBoard,task,areaTask,privateTask};
}
export const reviewPayload=(id=reviewId(401),season_id=reviewId(101)):ReviewSave=>({id,season_id,title:'Weekly Sprint Review',review_date:'2026-10-06',chair_id:reviewId(2),agenda:[{title:'Project discussion',presenter_id:reviewId(3),duration_minutes:12}],version:null});
export const assignmentPayload=(board_id=reviewId(201)):AssignmentSave=>({board_id,lead_id:reviewId(3),supporter_ids:[reviewId(4),reviewId(1)],version:null});
export const updatePayload=(id=reviewId(501),review_id=reviewId(401),board_id=reviewId(201)):UpdateSave=>({id,review_id,board_id,progress:'Tested the new prototype',blockers:'Need one repeat test',evidence:[{label:'Bench test results',url:'https://example.com/test-results',reference_id:'TEST-17'}],tradeoffs:'Weight against service access',decisions_needed:'Confirm the geometry after testing',decision_references:[{label:'Architecture register',url:'https://example.com/architecture',reference_id:'AD-12'}],reported_decision:'Students reported a provisional choice',decision_rationale:'Evidence favors a lighter prototype',reported_by_student_ids:[reviewId(2),reviewId(3)],next_test:'Repeat the loaded cycle',linked_task_id:reviewId(301),carry_from_update_id:null,unresolved:true,version:null});
let sequence=1000;
export async function saveReview(db:PGlite,action:ReviewSaveAction,p:ReviewSavePayload,actor=1,key=reviewId(++sequence)){
 return (await db.query<{r:ReviewMutationReceipt}>('select sprint_review_save($1,$2,$3,$4) r',[action,key,reviewId(actor),JSON.stringify(p)])).rows[0].r;
}
export async function reviewContext(db:PGlite,season:string|null=null,review:string|null=null){return(await db.query<{c:SprintReviewContext}>('select sprint_review_context($1,$2) c',[season,review])).rows[0].c;}
