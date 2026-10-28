// Disposable native PostgreSQL only. No production DSN, credentials, or records.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {installCoreBaseline} from '../fixtures/student-role-core.ts';
for(const key of ['DATABASE_URL','SUPABASE_DB_URL','PGSERVICE','PGHOST','PGDATABASE','PGUSER','PGPASSWORD'])assert(!process.env[key],`Refusing ${key}`);
const bin=process.env.STUDENT_ROLE_PG_BIN;assert(bin&&isAbsolute(bin),'Set STUDENT_ROLE_PG_BIN to installed local server binaries');
const root=mkdtempSync(join(tmpdir(),'student-role-native-')),data=join(root,'db');
const env={PATH:process.env.PATH||'/usr/bin:/bin',HOME:root,LANG:'C.UTF-8',TZ:'UTC'};
const args=['-X','-h',root,'-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync(join(bin,'psql'),args,{input,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}).trim();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const actor=n=>`select set_config('test.uid','${id(n)}',false);set role authenticated;`;
const lit=x=>`'${String(x).replaceAll("'","''")}'`;
const json=x=>`${lit(JSON.stringify(x))}::jsonb`;
const children=new Set();let started=false;
function session(name){const p=spawn(join(bin,'psql'),args,{env:{...env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});children.add(p);let out='',err='';const done=new Promise((resolve,reject)=>{p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>{children.delete(p);code?reject(Error(err)):resolve(out);});});done.catch(()=>{});p.stdin.write("set statement_timeout='15s';set idle_in_transaction_session_timeout='25s';\n");return {p,done,output:()=>out};}
async function until(fn,label){const end=Date.now()+10000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout: '+label);}
async function gate(query,name){const s=session(name);s.p.stdin.write(`begin;${query};select 'GATE_READY';\n`);await until(()=>s.output().includes('GATE_READY'),name);return {release:()=>{s.p.stdin.end('commit;\n');return s.done;}};}
function run(q,name){const s=session(name);s.p.stdin.end(q+'\n');return s.done;}
const blocked=name=>until(()=>Number(sql(`select count(*) from pg_stat_activity where application_name=${lit(name)} and cardinality(pg_blocking_pids(pid))>0`))===1,name+' observed lock');
const request=n=>({id:id(n),email:`synthetic${n}@example.test`,display_name:'New Student',role:'student',reason:'Native fixture'});
const count=()=>sql('select count(*) from team_private.invitations');
try{
 execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8'],{env,stdio:'pipe',timeout:30000});
 execFileSync(join(bin,'pg_ctl'),['-D',data,'-l',join(root,'server.log'),'-o',`-k ${root} -c listen_addresses='' -c unix_socket_permissions=0700`,'-w','start'],{env,stdio:'pipe',timeout:30000});started=true;
 await installCoreBaseline({exec:async q=>{sql(q);return [];}});
 sql(readFileSync('supabase/migrations/20261028160322_student_admin_lead_roles.sql','utf8'));
 sql(`insert into profiles(id,display_name,role,active) values('${id(6)}','Operations','admin_lead',true)`);
 for(const kind of ['advisory','actor-row']){
  sql(`update profiles set role='admin_lead' where id='${id(6)}'`);const before=count();
  const g=await gate(kind==='advisory'?'select pg_advisory_xact_lock(4418)':`update profiles set role='readonly' where id='${id(6)}'`,'reserve-'+kind+'-gate');
  const pending=run(`${actor(6)}select team_invitation_reserve(${json(request(kind==='advisory'?901:902))});`,'reserve-'+kind);await blocked('reserve-'+kind);
  if(kind==='advisory')sql(`update profiles set role='readonly' where id='${id(6)}'`);
  await g.release();await assert.rejects(pending,/Admin Lead/);assert.equal(count(),before);console.log('PASS reservation rechecks after '+kind+' wait');
 }
 sql(`update profiles set role='admin_lead' where id='${id(6)}'`);
 const old=JSON.parse(sql(`select row_to_json(p) from profiles p where id='${id(2)}'`));const patch={user_id:id(2),display_name:'Not written',member_status:'registered',expected_updated_at:old.updated_at,expected_member_status:'prospective',expected_team_area:'',reason:'Native test'};
 const g=await gate(`update profiles set role='readonly' where id='${id(6)}'`,'operations-demotion');const pending=run(`${actor(6)}select team_operations_manage(${json(patch)});`,'operations-wait');await blocked('operations-wait');await g.release();await assert.rejects(pending,/Admin Lead/);assert.equal(sql(`select display_name from profiles where id='${id(2)}'`),old.display_name);console.log('PASS operations rechecks after actor row wait');
 sql(`update profiles set role='admin_lead' where id='${id(6)}';${actor(6)}select team_invitation_reserve(${json(request(903))});reset role;insert into auth.users(id,email,invited_at,raw_user_meta_data) values('${id(603)}','synthetic903@example.test',clock_timestamp(),'{"team_invitation_id":"${id(903)}"}');insert into profiles(id,display_name,role,active) values('${id(603)}','Quarantined','readonly',true)`);
 const finishGate=await gate(`update profiles set role='lead' where id='${id(6)}'`,'finish-demotion');const finish=run(`set role service_role;select team_invitation_finish('${id(903)}','${id(603)}');`,'finish-wait');await blocked('finish-wait');await finishGate.release();await assert.rejects(finish,/no longer authorized/);assert.equal(sql(`select role||':'||active from profiles where id='${id(603)}'`),'readonly:false');console.log('PASS finish retains quarantine after actor demotion while waiting');
}finally{for(const p of children)p.kill('SIGTERM');if(started)execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,stdio:'pipe',timeout:30000});rmSync(root,{recursive:true,force:true});}
