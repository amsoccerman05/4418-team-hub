import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import type {PGlite} from '@electric-sql/pglite';
import {createFabricationDatabase,seedFabrication,as,id} from './fabrication';
import {assertAssemblyContext} from '../../src/planning/assembly/model';
import type {AssemblyAction,AssemblyContext,AssemblyPayload,AssemblyReceipt,CheckInput,ComponentInput} from '../../src/planning/assembly/types';
export {as,id,seedFabrication as seedAssembly};
export const assemblyMigration=()=>readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(x=>x.endsWith('_assembly_testing_v1.sql')),'utf8');
export async function createAssemblyDatabase(){
 const db=await createFabricationDatabase();
 const untouched=async()=>({functions:(await db.query("select p.oid,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('planning_private','planning_review_private','fabrication_private') or (n.nspname='public' and p.proname ~ '^(planning_|sprint_review_|fabrication_)') order by p.oid")).rows,
 relations:(await db.query("select c.oid,c.relname,c.relacl::text,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','planning_private','planning_review_private','fabrication_private','storage') order by c.oid")).rows});
 const before=await untouched(),migration=assemblyMigration();
 await assert.rejects(db.exec(migration.replace(/commit;\s*$/,()=>"do $$begin raise exception 'synthetic assembly rollback';end$$;commit;")),/synthetic assembly rollback/);await db.exec('rollback');
 assert.deepEqual(await untouched(),before);assert.equal((await db.query<{n:unknown}>("select to_regnamespace('assembly_private') n")).rows[0].n,null);
 await db.exec(migration);assert.deepEqual(await untouched(),before);return db;
}
let sequence=50000;
export const component=(n=901):ComponentInput=>({id:id(n),name:'Bearing',quantity:2,status:'needed',notes:'Flanged bearing'});
export const check=(n=1001):CheckInput=>({id:id(n),title:'Bench fit',kind:'fit',outcome:'passed',procedure:'Dry fit the mount',expected:'No interference',observed:'Fits freely',evidence_url:'https://example.com/test-results',revision_id:null,rework_task_id:null,supersedes_id:null});
export const payload=(fields:ComponentInput|CheckInput|{task_id:string;linked:boolean}|{id:string;notes:string},version=0,board=201):AssemblyPayload=>({board_id:id(board),version,...fields});
export async function context(db:PGlite,board=201,actor=3){await as(db,actor);return assertAssemblyContext((await db.query<{r:AssemblyContext}>('select assembly_context($1,$2) r',[id(board),id(actor)])).rows[0].r,id(actor),id(board));}
export async function mutate(db:PGlite,action:AssemblyAction,p:AssemblyPayload,actor=3,key=id(++sequence)){await as(db,actor);return(await db.query<{r:AssemblyReceipt}>('select assembly_mutate($1,$2,$3,$4) r',[action,key,id(actor),JSON.stringify(p)])).rows[0].r;}
export async function receipt(db:PGlite,key:string,actor=3,cancel=false){await as(db,actor);return(await db.query<{r:AssemblyReceipt}>(`select assembly_${cancel?'cancel_mutation':'mutation_status'}($1,$2) r`,[key,id(actor)])).rows[0].r;}
