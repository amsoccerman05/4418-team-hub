import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {planningFixture,asReviewUser,assignmentPayload,saveReview,reviewId} from './sprint-review';
import type {FabricationSubmission,FabricationManifest,FabricationReservation,FabricationReceipt,FabricationContext,FabricationAction,FabricationActionPayload} from '../../src/fabrication/types';
export {reviewId as id,asReviewUser as as};
export const fabricationMigration=()=>readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(x=>x.endsWith('_fabrication_v1.sql')),'utf8');
export const fabricationStorageSQL=readFileSync('tests/fixtures/fabrication-storage.sql','utf8');
export async function createFabricationDatabase(){
 const db=new PGlite();await db.exec(readFileSync('tests/fixtures/sprint-review-base.sql','utf8'));
 for(const x of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql',readdirSync('supabase/migrations').find(x=>x.endsWith('_sprint_review_v1.sql'))!])await db.exec(readFileSync('supabase/migrations/'+x,'utf8'));
 await db.exec(fabricationStorageSQL);
 const before=async()=>(await db.query("select p.oid,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('planning_private','planning_review_private') or (n.nspname='public' and p.proname like 'planning_%') order by p.oid")).rows;
 const previous=await before(),migration=fabricationMigration();
 await assert.rejects(db.exec(migration.replace(/commit;\s*$/,()=>"do $$begin raise exception 'synthetic fabrication rollback';end$$;commit;")),/synthetic fabrication rollback/);await db.exec('rollback');
 assert.deepEqual(await before(),previous);assert.equal((await db.query<{n:unknown}>("select to_regnamespace('fabrication_private') n")).rows[0].n,null);
 await db.exec(migration);assert.deepEqual(await before(),previous);return db;
}
export async function seedFabrication(db:PGlite){const fixture=await planningFixture(db);await saveReview(db,'assignment',assignmentPayload());return fixture;}
export const submission=(part=601,revision=701,version:number|null=null,board=201):FabricationSubmission=>({part_id:reviewId(part),board_id:reviewId(board),revision_id:reviewId(revision),version,name:'Side plate',material:'6061 aluminum',thickness:0.125,thickness_unit:'in',drawing_unit:'mm',quantity:2,needed_date:'2026-10-20',onshape_url:'https://cad.onshape.com/documents/example',notes:'Deburr edges'});
export const manifest=():FabricationManifest=>({dxf:{name:'Side plate.dxf',size:120,sha256:'a'.repeat(64)},pdf:{name:'Side plate.pdf',size:64,sha256:'b'.repeat(64)}});
let sequence=8000;
export async function reserve(db:PGlite,p=submission(),actor=3,key=reviewId(++sequence),m=manifest()){
 await db.exec('reset role;set role service_role');return(await db.query<{r:FabricationReservation}>('select fabrication_reserve_upload($1,$2,$3,$4) r',[reviewId(actor),key,JSON.stringify(p),JSON.stringify(m)])).rows[0].r;
}
export async function writeObjects(db:PGlite,r:FabricationReservation){await db.exec('reset role');const lease=r.reservation!;for(const kind of ['dxf','pdf'] as const){const f=lease.manifest[kind],path=kind==='dxf'?lease.dxf_path:lease.pdf_path;if(!f||!path)continue;await db.query('insert into storage.objects(bucket_id,name,metadata,user_metadata) values($1,$2,$3,$4) on conflict do nothing',[lease.bucket,path,JSON.stringify({size:f.size,mimetype:kind==='dxf'?'application/dxf':'application/pdf'}),JSON.stringify({sha256:f.sha256})]);}}
export async function finalize(db:PGlite,r:FabricationReservation,actor=3){await db.exec('reset role;set role service_role');return(await db.query<{r:FabricationReceipt}>('select fabrication_finalize_upload($1,$2,$3) r',[reviewId(actor),r.receipt.request_id,r.reservation!.lease_id])).rows[0].r;}
export async function upload(db:PGlite,p=submission(),actor=3,key=reviewId(++sequence),m=manifest()){const r=await reserve(db,p,actor,key,m);if(r.reservation){await writeObjects(db,r);return finalize(db,r,actor);}return r.receipt;}
export async function context(db:PGlite,season:string|null=null,project:string|null=null){return(await db.query<{r:FabricationContext}>('select fabrication_context($1,$2) r',[season,project])).rows[0].r;}
export async function mutate(db:PGlite,action:FabricationAction,p:FabricationActionPayload,actor=5,key=reviewId(++sequence)){await asReviewUser(db,actor);return(await db.query<{r:FabricationReceipt}>('select fabrication_mutate($1,$2,$3,$4) r',[action,key,reviewId(actor),JSON.stringify(p)])).rows[0].r;}
export const actionPayload=(version=1,revision=701,note=''):FabricationActionPayload=>({part_id:reviewId(601),version,revision_id:reviewId(revision),note});
