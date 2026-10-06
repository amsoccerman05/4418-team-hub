import {test,expect} from '@playwright/test';
import {assertFabricationContext} from '../src/fabrication/model';
import type {PGlite} from '@electric-sql/pglite';
import {createFabricationDatabase,seedFabrication,as,id,submission,manifest,reserve,writeObjects,finalize,upload,context,mutate,actionPayload} from './fixtures/fabrication';
test.describe.configure({mode:'serial'});let db:PGlite,fixture:Awaited<ReturnType<typeof seedFabrication>>;
async function reject(fn:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint rejected');try{await expect(fn()).rejects.toThrow(pattern);}finally{await db.exec('rollback to rejected');}}
async function status(key:string,actor=3,cancel=false){await as(db,actor);return(await db.query<{r:any}>(`select fabrication_${cancel?'cancel_mutation':'mutation_status'}($1,$2) r`,[key,id(actor)])).rows[0].r;}
test.beforeAll(async()=>{db=await createFabricationDatabase();fixture=await seedFabrication(db);});test.afterAll(async()=>{await db?.close();});test.beforeEach(async()=>{await db.exec('reset role;begin');});test.afterEach(async()=>{await db.exec('rollback');});

test('reservation, validated finalize, canonical project projection and immutable provenance',async()=>{
 const r=await reserve(db);expect(r.receipt).toMatchObject({status:'pending',action:null,entity_id:null,version:null});expect(r.reservation?.dxf_path).toBe(`${fixture.board}/${id(601)}/${id(701)}/drawing.dxf`);
 await reject(()=>finalize(db,r),/Invalid Fabrication/);await writeObjects(db,r);expect(await finalize(db,r)).toMatchObject({status:'applied',action:'revision',entity_id:id(601),version:1});
 await as(db,3);const c=assertFabricationContext(await context(db),id(3));expect(c).toMatchObject({user_id:id(3),season_id:fixture.season,is_operator:true});expect(c.projects.find(x=>x.id===fixture.board)?.can_submit).toBe(true);
 expect(c.parts[0]).toMatchObject({status:'needs_review',version:1,claimed_by:null,current_revision:{name:'Side plate',drawing_unit:'mm',thickness_unit:'in',revision_number:1,dxf:manifest().dxf,pdf:manifest().pdf}});
 expect(JSON.stringify(c)).not.toContain('drawing.dxf');expect(c.revisions).toHaveLength(1);
 await db.exec('reset role');await reject(()=>db.exec('update fabrication_revisions set name=\'Overwrite\''),/Immutable/);
});
test('any active eligible teammate can operate own claim; foreign claims and readonly cannot',async()=>{
 await upload(db);await mutate(db,'claim',actionPayload(),5);await as(db,4);expect((await context(db)).parts[0].allowed_actions).not.toContain('start');
 await reject(()=>mutate(db,'claim',actionPayload(2),4),/unavailable/);await reject(()=>mutate(db,'ready',actionPayload(2),4),/unavailable/);await reject(()=>mutate(db,'claim',actionPayload(2),6),/unavailable/);
 await mutate(db,'ready',actionPayload(2),5);await reject(()=>mutate(db,'start',actionPayload(3),5),/unavailable/);await mutate(db,'acknowledge',actionPayload(3),5);await mutate(db,'start',actionPayload(4),5);await mutate(db,'done',actionPayload(5),5);
 await as(db,5);expect((await context(db)).parts[0]).toMatchObject({status:'done',version:6,claimed_by:id(5),acknowledged_revision_id:id(701),reviewed_revision_id:id(701)});
});
test('new revision during work preserves claim and resets review and acknowledgement; stale current revision rejected',async()=>{
 await upload(db);await mutate(db,'claim',actionPayload(),5);await mutate(db,'acknowledge',actionPayload(2),5);await mutate(db,'ready',actionPayload(3),5);await mutate(db,'start',actionPayload(4),5);
 await upload(db,{...submission(601,702,5),name:'Side plate corrected'},3);await as(db,5);let p=(await context(db)).parts[0];expect(p).toMatchObject({status:'needs_review',version:6,claimed_by:id(5),acknowledged_revision_id:null,reviewed_revision_id:null,current_revision_id:id(702)});
 await reject(()=>mutate(db,'done',actionPayload(6,701),5),/Changed/);await reject(()=>mutate(db,'start',actionPayload(6,702),5),/unavailable/);
 await mutate(db,'acknowledge',actionPayload(6,702),5);await mutate(db,'ready',actionPayload(7,702),5);await mutate(db,'start',actionPayload(8,702),5);await mutate(db,'hold',actionPayload(9,702,'Fixture clearance needs attention'),5);await as(db,5);
 p=(await context(db)).parts[0];expect(p).toMatchObject({status:'on_hold',status_note:'Fixture clearance needs attention',acknowledged_revision_id:null,reviewed_revision_id:null});await mutate(db,'rework',actionPayload(10,702,'Clearance checked'),5);
 expect((await context(db)).revisions.map(x=>x.revision_number)).toEqual([2,1]);
});
test('submit/revise follows current canonical assignments and season/board permission, not arbitrary ownership',async()=>{
 for(const actor of [1,2,3,4,8]){const p=submission(600+actor,700+actor);expect(await upload(db,p,actor)).toMatchObject({status:'applied'});}
 for(const actor of [5,6,7])await reject(()=>reserve(db,submission(650,750),actor),/unavailable|account changed/);
 await db.exec(`reset role;delete from planning_project_review_supporters where user_id='${id(4)}'`);await reject(()=>reserve(db,submission(651,751),4),/unavailable/);
 await reject(()=>reserve(db,submission(652,752,null,204)),/unavailable/);
 await upload(db,submission(653,753,null,203),1);await as(db,3);await reject(()=>context(db,null,fixture.draftBoard),/unavailable/);
 await as(db,1);expect((await context(db,null,fixture.draftBoard)).season_id).toBe(fixture.draft);await reject(()=>context(db,fixture.season,fixture.draftBoard),/unavailable/);
 await db.exec(`reset role;update planning_seasons set status='archived' where id='${fixture.season}'`);await reject(()=>reserve(db,submission(654,754),1),/unavailable/);await as(db,5);expect((await context(db)).parts).toHaveLength(0);
});
test('metadata and manifest require explicit valid bounded fields and reject forged provenance',async()=>{
 const base=submission();for(const change of [{name:'\u00a0\ufeff'},{name:'🚀'.repeat(101)},{material:'x'.repeat(121)},{thickness:0},{thickness:1001},{quantity:1.5},{quantity:100001},{needed_date:'infinity'},{needed_date:'2026-02-30'},{needed_date:'0000-01-01'},{drawing_unit:'cm'},{thickness_unit:'ft'},{onshape_url:'http://cad.onshape.com/documents/test'},{onshape_url:'https://user@cad.onshape.com/documents/test'},{onshape_url:'https://cad.onshape.com.evil/documents/test'},{onshape_url:'https://cad.onshape.com/documents/test\\evil'},{created_by:id(8)}])await reject(()=>reserve(db,{...base,...change} as any),/Invalid/);
 for(const change of [{dxf:null},{dxf:{...manifest().dxf,size:20971521}},{dxf:{...manifest().dxf,name:'../part.dxf'}},{dxf:{...manifest().dxf,sha256:'not a hash'}},{pdf:{...manifest().pdf!,size:10485761}}])await reject(()=>reserve(db,base,3,undefined,{...manifest(),...change} as any),/Invalid/);
 await upload(db,{...base,name:'🚀'.repeat(100),material:'x'.repeat(120),notes:'x'.repeat(2000),onshape_url:''},3,undefined,{...manifest(),pdf:null});await as(db,3);expect((await context(db)).parts[0].current_revision.pdf).toBeNull();
});
test('actor-bound exact idempotency, opaque status, cancellation tombstones, and terminal cleanup',async()=>{
 const key=id(9001),p=submission(),r=await reserve(db,p,3,key);expect(await reserve(db,p,3,key)).toEqual(r);await reject(()=>reserve(db,{...p,name:'Different'},3,key),/request ID/);await reject(()=>reserve(db,p,3,key,{...manifest(),pdf:null}),/request ID/);
 expect(await status(key,4)).toMatchObject({status:'unknown',entity_id:null});expect(await status(key)).toMatchObject({status:'pending',entity_id:null});
 await writeObjects(db,r);await finalize(db,r);expect(await reserve(db,p,3,key)).toMatchObject({receipt:{status:'applied',version:1},reservation:null});expect(await status(key,3,true)).toMatchObject({status:'applied'});
 await db.exec('reset role;set role service_role');await reject(()=>db.query('select fabrication_cancelled_upload_paths($1,$2,$3)',[id(3),key,r.reservation!.lease_id]),/unavailable/);
 const cancelled=id(9002),r2=await reserve(db,submission(602,702),3,cancelled);await writeObjects(db,r2);expect(await status(cancelled,3,true)).toMatchObject({status:'cancelled'});expect(await finalize(db,r2)).toMatchObject({status:'cancelled'});
 await db.exec('reset role;set role service_role');expect((await db.query<{r:any}>('select fabrication_cancelled_upload_paths($1,$2,$3) r',[id(3),cancelled,r2.reservation!.lease_id])).rows[0].r.paths).toHaveLength(2);
 await status(id(9003),3,true);expect(await reserve(db,submission(603,703),3,id(9003))).toMatchObject({receipt:{status:'cancelled'},reservation:null});
 await as(db,3);expect((await context(db)).parts).toHaveLength(1);
});
test('current permission rechecked at reserve replay, authorize and finalize; no metadata-only forge',async()=>{
 const r=await reserve(db);await writeObjects(db,r);
 await db.exec(`reset role;update profiles set role='readonly' where id='${id(3)}'`);await reject(()=>finalize(db,r),/unavailable/);await reject(()=>reserve(db,submission(),3,r.receipt.request_id),/unavailable/);
 await db.exec(`reset role;update profiles set role='student' where id='${id(3)}';update storage.objects set user_metadata='{}'`);await reject(()=>finalize(db,r),/Invalid/);
 await db.exec(`reset role;update storage.objects set user_metadata=jsonb_build_object('sha256',case when name like '%.dxf' then repeat('a',64) else repeat('b',64) end);update planning_boards set active=false where id='${fixture.board}'`);await reject(()=>finalize(db,r),/unavailable/);
});
test('storage boundary defeats broad unrelated policies and only finalized visible revisions download',async()=>{
 const r=await reserve(db);await writeObjects(db,r);await as(db,3);expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
 await reject(()=>db.query("insert into storage.objects(bucket_id,name) values('fabrication-private','browser.dxf')"),/row-level/);
 await finalize(db,r);await as(db,6);expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);await db.exec("update storage.objects set name='overwrite.dxf'");expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);await db.exec('delete from storage.objects');expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
 await db.exec('reset role;set role service_role');expect((await db.query<{r:any}>('select fabrication_download_file($1,$2,$3) r',[id(6),id(701),'dxf'])).rows[0].r).toMatchObject({revision_number:1,bucket:'fabrication-private',name:'Side plate.dxf',size:120});
 await db.exec(`reset role;update profiles set active=false where id='${id(6)}'`);await as(db,6);expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
 await db.exec('reset role;set role anon');expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
});
test('optimistic stale updates and audit failure are atomic; hold requires visible reason',async()=>{
 await upload(db);const key=id(9010),p=actionPayload();expect(await mutate(db,'claim',p,5,key)).toMatchObject({version:2});expect(await mutate(db,'claim',p,5,key)).toMatchObject({version:2});await reject(()=>mutate(db,'claim',{...p,note:'different'},5,key),/request ID/);
 await reject(()=>mutate(db,'ready',actionPayload(1),5),/Changed/);await reject(()=>mutate(db,'hold',actionPayload(2),5),/Invalid/);
 await db.exec("reset role;create function fabrication_private.audit_failure() returns trigger language plpgsql as $$begin raise exception 'secret-row-detail';end$$;create trigger failure before insert on fabrication_private.history for each row execute function fabrication_private.audit_failure();");
 let failure:any;await db.exec('savepoint atomic');try{await mutate(db,'ready',actionPayload(2),5);}catch(e){failure=e;}await db.exec('rollback to atomic');expect(failure.message).not.toContain('secret-row-detail');expect(failure.detail||'').toBe('');await as(db,5);expect((await context(db)).parts[0].version).toBe(2);
});
test('reservation capacity is bounded and cancellation never frees race-prone quota',async()=>{
 const reservations=[];for(let n=0;n<5;n++)reservations.push(await reserve(db,submission(620+n,720+n),3,id(9200+n)));
 await reject(()=>reserve(db,submission(630,730)),/limit reached/);await status(id(9200),3,true);await reserve(db,submission(630,730));
 await db.exec(`reset role;insert into fabrication_private.reservations(actor_id,request_id,revision_id,part_id,board_id,payload,manifest,bytes,dxf_path) select '${id(1)}',('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((i+1000)::text,12,'0'))::uuid,'${id(650)}','${fixture.otherBoard}','{}','{}',31457280,'quota/'||i from generate_series(10000,10070) i;`);
 await reject(()=>reserve(db,submission(650,750,null,202),1),/limit reached/);
});
test('project capacity includes pending new parts, allows revisions and releases cancelled new-part slots',async()=>{
 await upload(db);await db.exec(`reset role;insert into fabrication_private.reservations(actor_id,request_id,revision_id,part_id,board_id,payload,manifest,bytes,dxf_path) select '${id(1)}',('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((i+1000)::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((i+2000)::text,12,'0'))::uuid,'${fixture.board}','{}','{}',120,'part-cap/'||i from generate_series(20000,20198) i;`);
 await reject(()=>reserve(db,submission(602,702)),/limit reached/);
 expect((await reserve(db,submission(601,702,1))).receipt.status).toBe('pending');
 await status(id(20000),1,true);expect((await reserve(db,submission(602,703))).receipt.status).toBe('pending');
 await reject(()=>reserve(db,submission(603,704)),/limit reached/);
});
test('an already reserved part UUID cannot move projects or bypass a full project cap',async()=>{
 await upload(db);await db.exec(`reset role;insert into fabrication_private.reservations(actor_id,request_id,revision_id,part_id,board_id,payload,manifest,bytes,dxf_path) select '${id(1)}',('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((i+1000)::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((i+2000)::text,12,'0'))::uuid,'${fixture.board}','{}','{}',120,'cross-cap/'||i from generate_series(30000,30198) i;`);
 await reserve(db,submission(6099,7099,null,202),8);
 await reject(()=>reserve(db,submission(6099,7100)),/unavailable/);
});
test('claim, acknowledgement and release preserve the visible hold reason',async()=>{
 await upload(db);await mutate(db,'hold',actionPayload(1,701,'Waiting for replacement material'),1);await mutate(db,'claim',actionPayload(2),5);await mutate(db,'acknowledge',actionPayload(3),5);await mutate(db,'release',actionPayload(4),5);await as(db,5);
 expect((await context(db)).parts[0]).toMatchObject({status:'on_hold',status_note:'Waiting for replacement material',claimed_by:null});
});
test('small part version reads bind the actor and recheck current visibility without exposing history',async()=>{
 await upload(db);const version=async(expected=5,part=id(601))=>(await db.query<{v:number}>('select fabrication_part_version($1,$2) v',[part,id(expected)])).rows[0].v;
 for(const actor of [1,3,5,6]){await as(db,actor);expect(await version(actor)).toBe(1);}
 await as(db,5);await reject(()=>version(1),/account changed/);await reject(()=>version(5,id(99999)),/unavailable/);
 await mutate(db,'claim',actionPayload(1),5);expect(await version(5)).toBe(2);
 await as(db,7);await reject(()=>version(7),/account changed/);
 await db.exec(`reset role;update profiles set active=false where id='${id(6)}'`);await as(db,6);await reject(()=>version(6),/account changed/);
 await db.exec(`reset role;update profiles set active=true where id='${id(6)}';update planning_boards set active=false where id='${fixture.board}'`);await as(db,6);await reject(()=>version(6),/unavailable/);await as(db,1);expect(await version(1)).toBe(2);
 await db.exec(`reset role;update planning_boards set active=true where id='${fixture.board}';update planning_seasons set status='archived' where id='${fixture.season}'`);await as(db,5);await reject(()=>version(5),/unavailable/);await as(db,1);expect(await version(1)).toBe(2);
 await as(db,2);expect(await version(2)).toBe(2);await db.exec(`reset role;update team_member_positions set revoked_at=clock_timestamp() where user_id='${id(2)}'`);await as(db,2);await reject(()=>version(2),/unavailable/);
 for(const role of ['anon','service_role']){await db.exec(`reset role;set role ${role}`);await reject(()=>version(1),/permission denied/);}
});
test('configured byte budgets are authoritative, fail closed when missing, and reject unauthorized changes',async()=>{
 await db.exec('reset role');expect((await db.query<{project_byte_limit:number;total_byte_limit:number}>('select project_byte_limit::int,total_byte_limit::int from fabrication_private.settings')).rows[0]).toEqual({project_byte_limit:134217728,total_byte_limit:268435456});
 await db.exec('update fabrication_private.settings set project_byte_limit=100,total_byte_limit=1000');await reject(()=>reserve(db),/limit reached/);
 await db.exec('reset role');for(const statement of ['update fabrication_private.settings set project_byte_limit=0','update fabrication_private.settings set project_byte_limit=1001','update fabrication_private.settings set total_byte_limit=1073741825'])await reject(()=>db.exec(statement),/check constraint/);
 await db.exec('update fabrication_private.settings set project_byte_limit=200,total_byte_limit=300');const first=await reserve(db);expect(first.receipt.status).toBe('pending');await reject(()=>reserve(db,submission(602,702,null,202),1),/limit reached/);
 await db.exec('reset role;delete from fabrication_private.settings');await reject(()=>reserve(db,submission(),3,first.receipt.request_id),/limit reached/);await reject(()=>reserve(db,submission(603,703)),/limit reached/);
 for(const role of ['anon','authenticated','service_role']){await db.exec(`reset role;set role ${role}`);await reject(()=>db.exec('update fabrication_private.settings set project_byte_limit=999'),/permission denied/);}
});
test('all direct tables/private helpers and anonymous or misplaced service RPC access is denied',async()=>{
 for(const role of ['anon','authenticated','service_role']){await db.exec(`reset role;set role ${role}`);for(const table of ['fabrication_parts','fabrication_revisions','fabrication_private.requests','fabrication_private.reservations','fabrication_private.history','fabrication_private.settings'])for(const verb of ['select * from','delete from','truncate'])await reject(()=>db.exec(`${verb} ${table}`),/permission denied/);await reject(()=>db.exec('select fabrication_private.member(null)'),/permission denied/);
 if(role!=='authenticated')await reject(()=>context(db),/permission denied/);if(role!=='service_role')await reject(()=>db.query('select fabrication_reserve_upload($1,$2,$3,$4)',[id(3),id(9999),JSON.stringify(submission()),JSON.stringify(manifest())]),/permission denied/);}
 await db.exec('reset role');expect((await db.query<{n:number}>("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname='fabrication_private' and c.relkind='r' or c.relname in ('fabrication_parts','fabrication_revisions')) and c.relrowsecurity")).rows[0].n).toBe(6);
});
