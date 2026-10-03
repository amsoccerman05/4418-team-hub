import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
test.describe.configure({mode:'serial'});
let db:PGlite,season:string,board:string,areaBoard:string,a:string,b:string,c:string,empty:string;
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const as=async(n:number)=>{await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated`);};
const save=async(entity:string,p:any)=>(await db.query<any>('select planning_save($1,$2) id',[entity,JSON.stringify(p)])).rows[0].id;
const context=async(mine=false)=>(await db.query<any>(`select ${mine?'planning_my_work_context':'planning_context'}($1) c`,[season])).rows[0].c;
const task=async(t:string)=>(await context()).tasks.find((x:any)=>x.id===t);
const detail=async(t:string)=>(await db.query<any>('select planning_task_detail($1) d',[t])).rows[0].d;
async function rejects(fn:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint attempt');await expect(fn()).rejects.toThrow(pattern);await db.exec('rollback to attempt');}
let before:any,after:any,rollbackVerified=false;
const tables=['planning_tasks','planning_boards','planning_steps','planning_comments','planning_task_dependencies','planning_private.history'];
async function snapshot(){const result:any={};for(const table of tables)result[table]=(await db.query<any>(`select to_jsonb(t) j from ${table} t order by id`)).rows.map(r=>r.j);return result;}
test.beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
 create table public.areas(id uuid primary key,name text,active boolean);
 create table public.team_positions(key text primary key,active boolean);
 create table public.team_member_positions(user_id uuid references profiles(id),position_key text references team_positions(key),revoked_at timestamptz);
 insert into profiles values('${id(1)}','Mentor','mentor',true),('${id(2)}','Leader','student',true),('${id(3)}','Owner','student',true),('${id(4)}','Unrelated','lead',true),('${id(5)}','Inactive','mentor',false);
 insert into areas values('${id(10)}','Software',true);insert into team_positions values('software_lead',true);insert into team_member_positions values('${id(2)}','software_lead',null);`);
 // Supabase may inherit broad default table/function grants. The migration must
 // revoke these explicitly; RLS alone does not prevent TRUNCATE.
 await db.exec(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);

 await db.exec(`insert into profiles values('${id(6)}','Mira','student',true);update profiles set display_name='Miles' where id='${id(3)}';update profiles set display_name='Zach' where id='${id(4)}';`);
 for(const file of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 await as(1);season=await save('season',{name:'Owners',status:'active'});board=await save('board',{season_id:season,kind:'project',name:'Robot'});areaBoard=await save('board',{kind:'area',name:'Ongoing'});
 const base={board_id:board,status:'todo',priority:'normal',start_date:'2027-01-01',due_date:'2027-02-01'};
 a=await save('task',{...base,title:'Task A',owner_id:id(3)});b=await save('task',{...base,title:'Task B',owner_id:id(3)});c=await save('task',{...base,title:'Task C',owner_id:id(4)});empty=await save('task',{...base,title:'Unassigned'});
 await save('step',{task_id:b,text:'Shared step'});await save('comment',{task_id:b,text:'Shared thread'});
 await db.query("select planning_dependency_save('add',$1,$2)",[a,b]);
 await db.exec(`reset role;insert into planning_tasks(id,board_id,title,status,priority,owner_id,created_by) values('${id(21)}','${board}','Historical inactive owner','done','normal','${id(5)}','${id(1)}')`);before=await snapshot();
 const migration=readFileSync('supabase/migrations/202610040001_planning_task_assignees.sql','utf8');
 const oldFunction=(await db.query<any>("select pg_get_functiondef('planning_save(text,jsonb)'::regprocedure) body")).rows[0].body;
 await expect(db.exec(migration.replace('commit;',()=>"do $$begin raise exception 'forced migration failure';end$$;commit;"))).rejects.toThrow(/forced migration failure/);
 await db.exec('rollback');expect(await snapshot()).toEqual(before);
 expect((await db.query<any>("select to_regclass('public.planning_task_assignees') relation, to_regprocedure('planning_private.context(uuid,boolean)') helper, pg_get_functiondef('planning_save(text,jsonb)'::regprocedure) body")).rows[0]).toEqual({relation:null,helper:null,body:oldFunction});rollbackVerified=true;
 await db.exec(migration);after=await snapshot();
});
test.afterAll(async()=>{await db.close();});
test.beforeEach(async()=>{await as(1);await db.exec('begin');});
test.afterEach(async()=>{await db.exec('rollback');});

test('migration retains every original identity/value and backfills exactly one relation per owner without fake audit',async()=>{
 expect(after.planning_tasks).toEqual(before.planning_tasks.map(({owner_id,...t}:any)=>t));
 for(const table of tables.filter(t=>t!=='planning_tasks'))expect(after[table]).toEqual(before[table]);
 await db.exec('reset role');const rows=(await db.query<any>('select task_id,user_id,assigned_by,assigned_at from planning_task_assignees order by task_id')).rows;
 expect(rows).toHaveLength(4);expect(new Set(rows.map(r=>r.task_id+':'+r.user_id)).size).toBe(4);
 for(const row of rows){expect(row.user_id).toBe(before.planning_tasks.find((t:any)=>t.id===row.task_id).owner_id);expect(row.assigned_by).toBeNull();expect(row.assigned_at).toBeTruthy();}
 expect(rows.some(r=>r.task_id===empty)).toBe(false);expect(rows.find(r=>r.task_id===id(21)).user_id).toBe(id(5));await rejects(async()=>db.query('insert into planning_task_assignees(task_id,user_id) values($1,$2)',[a,id(3)]),/duplicate key/);
});
test('zero/one/two/several owners, removal, duplicate/invalid/inactive input validation and safe legacy rejection',async()=>{
 for(const owners of [[],[id(3)],[id(3),id(4)],[id(3),id(4),id(6)],[id(4),id(6)],[]]){await save('task',{...await task(a),owner_ids:owners});expect((await task(a)).owner_ids).toEqual(owners);}
 const current=await task(a),history=(await detail(a)).history;
 for(const owners of [[id(3),id(3)],[id(5)],[id(99)],[null],null,'not-array'])await rejects(async()=>save('task',{...current,owner_ids:owners}),/Duplicate|active owner|identity|list/);
 await rejects(async()=>save('task',{...current,owner_id:id(3)}),/Reload Planning/);
 expect(await task(a)).toEqual(current);expect((await detail(a)).history).toEqual(history);
});
test('manager and designated leader can manage owner sets; members cannot reassign or spoof authority',async()=>{
 await as(2);await save('task',{...await task(b),owner_ids:[id(3),id(4)]});
 for(const n of [3,4]){await as(n);const t=await task(b);await save('task',{...t,status:'in_progress'});const current=await task(b);
  for(const owners of [[],[id(n)],[id(3),id(4),id(6)]])await rejects(async()=>save('task',{...current,owner_ids:owners,can_manage:true,role:'mentor'}),/reassign/);
  await rejects(async()=>save('board',{...(await context()).boards[0],name:'Forbidden'}),/leadership/);
  await rejects(async()=>db.query("select planning_dependency_save('remove',null,null,$1)",[(await context()).dependencies[0].id]),/leadership/);
 }
 await as(6);await rejects(async()=>save('task',{...await task(b),status:'done'}),/assigned/);
 await as(1);await save('task',{...await task(b),owner_ids:[id(4)]});await as(3);await rejects(async()=>save('task',{...await task(b),status:'done'}),/assigned/);await as(4);await save('task',{...await task(b),status:'done'});
});
test('each assignee retains existing shared checklist/comment/task capabilities, no per-owner state',async()=>{
 await save('task',{...await task(b),owner_ids:[id(3),id(4)]});
 await as(3);await save('step',{...(await detail(b)).steps[0],done:true});await save('comment',{task_id:b,text:'Shared progress',author_id:id(1)});await save('task',{...await task(b),status:'done'});
 await as(4);expect((await task(b)).status).toBe('done');const d=await detail(b);expect(d.steps[0].done).toBe(true);expect(d.comments.at(-1).author_id).toBe(id(3));expect((await context()).dependencies).toHaveLength(1);
});
test('My Work server filters A/B/C per authenticated assignee and updates membership without task copies',async()=>{
 await save('task',{...await task(b),owner_ids:[id(3),id(4)]});
 await as(3);expect((await context(true)).tasks.map((t:any)=>t.id).sort()).toEqual([a,b].sort());
 await as(4);expect((await context(true)).tasks.map((t:any)=>t.id).sort()).toEqual([b,c].sort());
 await as(1);await save('task',{...await task(a),owner_ids:[id(3),id(4)]});await as(4);expect((await context(true)).tasks).toHaveLength(3);
 await as(1);await save('task',{...await task(a),owner_ids:[id(3)]});await save('task',{...await task(b),owner_ids:[id(4)]});
 await as(3);expect((await context(true)).tasks.map((t:any)=>t.id)).toEqual([a]);await as(4);expect((await context(true)).tasks.map((t:any)=>t.id).sort()).toEqual([b,c].sort());
 await save('task',{...await task(b),status:'done'});expect((await context(true)).tasks.find((t:any)=>t.id===b).status).toBe('done');
});
test('archival and inactive members retain names/assignments; inactive new choices and authority denied',async()=>{
 await save('task',{...await task(b),owner_ids:[id(3),id(4)]});await db.exec(`reset role;update profiles set active=false where id='${id(3)}'`);await as(1);
 expect((await task(b)).owners.find((m:any)=>m.id===id(3))).toMatchObject({name:'Miles',active:false});expect((await context()).members.some((m:any)=>m.id===id(3))).toBe(false);
 await save('task',{...await task(b),status:'blocked'});await rejects(async()=>save('task',{...await task(empty),owner_ids:[id(3)]}),/active owner/);
 await as(3);await rejects(async()=>context(true),/Active team/);
 await as(1);const target=(await context()).boards.find((x:any)=>x.id===board);await save('board',{...target,active:false});await rejects(async()=>save('task',{...await task(b),owner_ids:[]}),/Active board/);expect((await task(b)).owner_ids).toEqual([id(3),id(4)]);
 await as(4);expect((await context(true)).tasks).toHaveLength(0);
});
test('inactive/revoked/archived leadership loses management immediately',async()=>{
 for(const change of [`update profiles set active=false where id='${id(2)}'`,`update team_member_positions set revoked_at=now() where user_id='${id(2)}'`,"update team_positions set active=false"]){
  await db.exec('reset role;savepoint state');await db.exec(change);await as(2);await rejects(async()=>save('task',{id:a,version:1,board_id:board,title:'Denied',status:'todo',priority:'normal',owner_ids:[id(2)]}),/Active team|assigned/);await db.exec('rollback to state');
 }
});
test('accurate atomic assignment audit with server actor/time; audit failure rolls back data and version',async()=>{
 await save('task',{...await task(b),owner_ids:[id(4),id(6)],actor_id:id(99)});let h=(await detail(b)).history[0];expect(h.before_data.owner_ids).toEqual([id(3)]);expect(h.after_data.owner_ids).toEqual([id(4),id(6)]);expect(h.after_data.owners.map((m:any)=>m.name)).toEqual(['Zach','Mira']);expect(h.actor_id).toBe(id(1));expect(h.created_at).toBeTruthy();
 const old=await task(b),history=(await detail(b)).history;
 await db.exec("reset role;create function planning_private.fail_owners() returns trigger language plpgsql as $$begin raise exception 'audit offline';end$$;create trigger fail_owners before insert on planning_private.history for each row execute function planning_private.fail_owners();");await as(1);
 await rejects(async()=>save('task',{...old,owner_ids:[id(3)],status:'done'}),/audit offline/);expect(await task(b)).toEqual(old);expect((await detail(b)).history).toEqual(history);
});
test('conflicting owner-set requests use one Task version; stale change cannot partially replace winner',async()=>{
 // PGlite serializes execution on one connection. Concurrent submitted requests
 // still exercise the stale version boundary, not PostgreSQL multi-session lock scheduling.
 await db.exec('commit');const old=await task(empty);
 const results=await Promise.allSettled([save('task',{...old,owner_ids:[id(3),id(4)]}),save('task',{...old,owner_ids:[id(4),id(6)]})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(String((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason)).toMatch(/Changed/);
 const winner=await task(empty);expect(winner.owner_ids).toEqual([id(3),id(4)]);expect(winner.version).toBe(old.version+1);expect((await detail(empty)).history.filter((h:any)=>h.action==='updated')).toHaveLength(1);
 await save('task',{...winner,owner_ids:[]});await db.exec('begin');
});
test('direct assignment reads/writes, private functions, and anonymous RPC calls are denied',async()=>{
 for(const role of ['anon','authenticated']){await db.exec(`reset role;set role ${role}`);for(const sql of ['select * from planning_task_assignees','delete from planning_task_assignees','insert into planning_task_assignees default values','update planning_task_assignees set user_id=task_id','truncate planning_task_assignees',"select planning_private.task_owners(null)","select planning_private.context(null,true)"])await rejects(async()=>db.exec(sql),/permission denied/);
  if(role==='anon')await rejects(async()=>context(true),/permission denied/);
 }
});
test('functional Board owners persist across seasons; task metrics and dependency topology stay singular',async()=>{
 const tid=await save('task',{board_id:areaBoard,title:'Persistent',status:'done',priority:'normal',owner_ids:[id(3),id(4),id(6)]});let current=await context();expect(current.tasks.filter((t:any)=>t.id===tid)).toHaveLength(1);expect(current.tasks.filter((t:any)=>t.board_id===areaBoard&&t.status==='done')).toHaveLength(1);
 const deps=current.dependencies;await save('task',{...await task(b),owner_ids:[id(3),id(4),id(6)]});expect((await context()).dependencies).toEqual(deps);
 await save('season',{...current.seasons[0],status:'archived'});const next=await save('season',{name:'Next',status:'active'});
 const nextContext=(await db.query<any>('select planning_context($1) c',[next])).rows[0].c;expect(nextContext.tasks.find((t:any)=>t.id===tid).owner_ids).toHaveLength(3);
});

test('failed migration restores legacy column/data/functions and removes uncommitted assignment objects',()=>{expect(rollbackVerified).toBe(true);});
