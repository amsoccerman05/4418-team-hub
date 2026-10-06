// Isolated synthetic PostgreSQL, 127.0.0.1 only. No production URL or credentials.
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {baseline,id,migration} from '../fixtures/outreach-baseline.mjs';
const bin=process.env.OUTREACH_PG_BIN||'/opt/homebrew/opt/postgresql@17/bin';
const dir=mkdtempSync('/tmp/impulse-outreach-native-'),data=join(dir,'db');
const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('PG'))delete env[key];
const port=await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(()=>resolve(address.port));});});
const args=['-X','-w','-d',`host=127.0.0.1 hostaddr=127.0.0.1 port=${port} user=outreach_fixture dbname=postgres passfile=/nonexistent sslmode=disable gssencmode=disable connect_timeout=5 options='-c statement_timeout=15000 -c lock_timeout=12000'`,'-Atq','-v','ON_ERROR_STOP=1'];
const sql=query=>execFileSync(join(bin,'psql'),args,{input:query,encoding:'utf8',env}).trim();
const asyncSQL=query=>new Promise(resolve=>{const p=spawn(join(bin,'psql'),args,{env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('exit',code=>resolve({code,out:out.trim(),err}));p.stdin.end(query);});
const user=n=>`select set_config('test.uid','${id(n)}',false);set role authenticated;`;
const literal=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const save=(entity,p,req,actor=1)=>`select outreach_save('${entity}',${literal(p)},'${id(req)}','${id(actor)}');`;
const org=(n=300,version=0)=>({id:id(n),version,kind:'organization',name:`Synthetic native ${n}`,website:'',notes:'',active:true});
async function waiting(marker,event){for(let i=0;i<200;i++){if(Number(sql(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and query like '%${marker}%' and ${event}`))>0)return;await new Promise(r=>setTimeout(r,15));}throw Error(`Session did not reach ${marker}`);}
const sleeping=marker=>waiting(marker,"wait_event='PgSleep'");
const blocked=marker=>waiting(marker,"wait_event_type='Lock'");
let started=false;
try{
 execFileSync(join(bin,'initdb'),['-D',data,'--auth-local=reject','--auth-host=trust','-U','outreach_fixture','--no-locale','--encoding=UTF8'],{env,stdio:'ignore'});
 try{execFileSync(join(bin,'pg_ctl'),['-D',data,'-l',join(dir,'server.log'),'-o',`-p ${port} -c listen_addresses='127.0.0.1' -c unix_socket_directories='' -c max_connections=20 -c shared_buffers=16MB -c timezone=UTC`,'-w','start'],{env,stdio:'ignore'});started=true;}
 catch(error){console.error(readFileSync(join(dir,'server.log'),'utf8'));throw error;}
 sql(baseline());sql(readFileSync(migration,'utf8'));
 const request=save('organization',org(),900);
 const first=asyncSQL(`begin;${user(1)}${request}select pg_sleep(1.0) /* duplicate_gate */;commit;`);await sleeping('duplicate_gate');
 const second=asyncSQL(`${user(1)}${request}`);assert.equal((await first).code,0);assert.equal((await second).code,0);
 assert.equal(sql(`select count(*) from outreach_private.history where request_id='${id(900)}'`),'1');assert.equal(sql(`select version from outreach_private.organizations where id='${id(300)}'`),'1');
 console.log('PASS concurrent exact request replay preserves one mutation and first audit');
 const stale={...org(300,1),name:'First winner'};
 const one=asyncSQL(`begin;${user(1)}${save('organization',stale,901)}select pg_sleep(1.0) /* stale_gate */;commit;`);await sleeping('stale_gate');
 const two=asyncSQL(`${user(2)}${save('organization',{...stale,name:'Stale loser'},902,2)}`);assert.equal((await one).code,0);const loser=await two;assert.notEqual(loser.code,0);assert.match(loser.err,/Changed by another teammate/);
 assert.equal(sql(`select name||':'||version from outreach_private.organizations where id='${id(300)}'`),'First winner:2');
 console.log('PASS simultaneous versioned updates reject the stale writer');
 // The first live check passes before the advisory lock blocks; revoke while blocked.
 const advisory=asyncSQL('begin;select pg_advisory_xact_lock(4418,80);select pg_sleep(1.0) /* advisory_gate */;commit;');await sleeping('advisory_gate');
 const late=asyncSQL(`${user(1)}/* revoke_advisory */ ${save('organization',org(301),903)}`);await blocked('revoke_advisory');
 sql(`update profiles set active=false where id='${id(1)}'`);await advisory;const rejected=await late;assert.notEqual(rejected.code,0);assert.match(rejected.err,/Active admin or mentor/);assert.equal(sql(`select count(*) from outreach_private.organizations where id='${id(301)}'`),'0');sql(`update profiles set active=true where id='${id(1)}'`);
 console.log('PASS live actor revocation during advisory-lock wait rejects the write');
 const row=asyncSQL(`begin;select 1 from outreach_private.organizations where id='${id(300)}' for update;select pg_sleep(1.0) /* row_gate */;commit;`);await sleeping('row_gate');
 const lateRow=asyncSQL(`${user(1)}/* revoke_row */ ${save('organization',{...org(300,2),name:'Forbidden after row wait'},904)}`);await blocked('revoke_row');
 sql(`update profiles set role='student' where id='${id(1)}'`);await row;const rowRejected=await lateRow;assert.notEqual(rowRejected.code,0);assert.match(rowRejected.err,/Active admin or mentor/);assert.equal(sql(`select version from outreach_private.organizations where id='${id(300)}'`),'2');sql(`update profiles set role='admin' where id='${id(1)}'`);
 console.log('PASS live actor revocation during record-lock wait rejects the write');
 sql(`${user(1)}${save('engagement',{id:id(310),version:0,organization_id:id(300),season_id:id(100),stage:'committed',owner_id:id(2),notes:''},905)}${save('pledge',{id:id(330),version:0,engagement_id:id(310),kind:'cash',amount:500,description:'Synthetic pledge',promised_on:'2026-10-05',status:'pledged'},906)}`);
 // Test-only gate models a future tightening of Finance's existing authority.
 // Neither the migration nor the application creates or changes this function.
 sql(`create table finance_private.synthetic_budget_gate(actor uuid primary key);insert into finance_private.synthetic_budget_gate values('${id(1)}');alter function finance_private.can_manage_budget() rename to original_budget_guard;create function finance_private.can_manage_budget() returns boolean language sql stable security definer set search_path='' as $$select finance_private.original_budget_guard() and exists(select 1 from finance_private.synthetic_budget_gate where actor=auth.uid())$$;`);
 const income=asyncSQL(`begin;select 1 from finance_income where id='${id(200)}' for update;select pg_sleep(1.0) /* income_gate */;commit;`);await sleeping('income_gate');
 const lateIncome=asyncSQL(`${user(1)}/* revoke_finance */ select outreach_link_income('${id(330)}','${id(200)}','${id(907)}','${id(1)}');`);await blocked('revoke_finance');
 sql('delete from finance_private.synthetic_budget_gate');await income;const incomeRejected=await lateIncome;assert.notEqual(incomeRejected.code,0);assert.match(incomeRejected.err,/Finance budget access/);assert.equal(sql('select count(*) from outreach_private.income_links'),'0');assert.equal(sql('select count(*) from finance_private.history'),'0');
 console.log('PASS Finance authority rechecked after income-row wait; no link or Finance mutation');
 const cancel=req=>`select outreach_cancel_request('${id(req)}','${id(1)}');`;
 const result=out=>JSON.parse(out.split('\n').filter(Boolean).at(-1));
 const applying=asyncSQL(`begin;${user(1)}${save('organization',org(302),910)}select pg_sleep(1.0) /* apply_before_cancel */;commit;`);await sleeping('apply_before_cancel');
 const afterApply=asyncSQL(`${user(1)}${cancel(910)}`);assert.equal((await applying).code,0);const appliedResult=await afterApply;assert.equal(appliedResult.code,0);assert.deepEqual(result(appliedResult.out),{status:'applied',result:{id:id(302),version:1}});
 assert.equal(sql(`select count(*) from outreach_private.history where request_id='${id(910)}'`),'1');assert.equal(sql(`select count(*) from outreach_private.organizations where id='${id(302)}'`),'1');
 console.log('PASS in-flight write wins before cancellation; original receipt returned without undo');
 const canceling=asyncSQL(`begin;${user(1)}${cancel(911)}select pg_sleep(1.0) /* cancel_before_apply */;commit;`);await sleeping('cancel_before_apply');
 const afterCancel=asyncSQL(`${user(1)}${save('organization',org(303),911)}`);assert.equal((await canceling).code,0);const canceledResult=await afterCancel;assert.notEqual(canceledResult.code,0);assert.match(canceledResult.err,/canceled before application/);
 assert.equal(sql(`select count(*) from outreach_private.organizations where id='${id(303)}'`),'0');assert.equal(sql(`select count(*) from outreach_private.requests where request_id='${id(911)}'`),'1');assert.deepEqual(result(sql(`${user(1)}${cancel(911)}`)),{status:'canceled'});
 console.log('PASS cancellation wins before late write; tombstone blocks application and replays safely');
 const cancelGate=asyncSQL('begin;select pg_advisory_xact_lock(4418,80);select pg_sleep(1.0) /* cancel_revoke_gate */;commit;');await sleeping('cancel_revoke_gate');
 const lateCancel=asyncSQL(`${user(1)}/* revoke_cancel */ ${cancel(912)}`);await blocked('revoke_cancel');sql(`update profiles set active=false where id='${id(1)}'`);await cancelGate;const deniedCancel=await lateCancel;
 assert.notEqual(deniedCancel.code,0);assert.match(deniedCancel.err,/Active admin or mentor/);assert.equal(sql(`select count(*) from outreach_private.requests where request_id='${id(912)}'`),'0');sql(`update profiles set active=true where id='${id(1)}'`);
 console.log('PASS actor revocation during cancellation lock wait prevents tombstone insertion');
 console.log('8 native multi-session checks passed; no production database or messages used.');
}finally{if(started)execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,stdio:'ignore'});rmSync(dir,{recursive:true,force:true});}
