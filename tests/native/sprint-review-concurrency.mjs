// Disposable, synthetic PostgreSQL only; no production URL, credentials or external listener.
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const bin=process.env.SPRINT_REVIEW_PG_BIN||'/tmp/repair-po-native-pg17/install/bin';
const dir=mkdtempSync('/tmp/impulse-sprint-review-'),data=join(dir,'db');
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('PG'))delete env[k];
const args=['-X','-h','127.0.0.1','-p','55443','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(join(bin,'psql'),args,{input:q,encoding:'utf8',env,stdio:['pipe','pipe','pipe']}).trim();
const asyncSQL=q=>new Promise((resolve,reject)=>{const p=spawn(join(bin,'psql'),args,{env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('exit',c=>c?reject(Error(err)):resolve(out.trim()));p.stdin.end(q);});
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const literal=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
const actor=n=>`select set_config('test.uid','${id(n)}',false);set role authenticated;`;
const review=(n=401)=>({id:id(n),season_id:id(101),title:'Native synthetic meeting',review_date:'2026-10-06',chair_id:id(2),agenda:[],version:null});
const assignment={board_id:id(201),lead_id:id(3),supporter_ids:[id(4)],version:null};
const update=(n=501,version=null)=>({id:id(n),review_id:id(401),board_id:id(201),progress:'Synthetic progress',blockers:'',evidence:[],tradeoffs:'',decisions_needed:'',decision_references:[],reported_decision:'',decision_rationale:'',reported_by_student_ids:[],next_test:'',linked_task_id:null,carry_from_update_id:null,unresolved:true,version});
const save=(action,p,key,who=1,expected=who)=>`${actor(who)}select sprint_review_save('${action}','${id(key)}','${id(expected)}',${literal(p)});`;
const recovery=(kind,key,who=1)=>`${actor(who)}select sprint_review_${kind}('${id(key)}','${id(who)}');`;
const value=out=>JSON.parse(out.split('\n').filter(Boolean).at(-1));
async function waiting(marker,event='PgSleep'){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){if(Number(sql(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and query like '%${marker}%' and wait_event='${event}'`))>0)return;await new Promise(r=>setTimeout(r,25));}
 throw Error('Controlled session did not reach '+marker);
}
const hold=async(marker)=>{const p=asyncSQL(`begin;select pg_advisory_xact_lock(4418,30);select pg_sleep(1.3) /* ${marker} */;commit;`);await waiting(marker);return{p};};
let started=false,checks=0;
const pass=s=>{checks++;console.log('PASS '+s);};
try{
 execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8'],{env,stdio:'ignore'});
 execFileSync(join(bin,'pg_ctl'),['-D',data,'-l',join(dir,'server.log'),'-o',`-k '' -p 55443 -c listen_addresses=127.0.0.1`,'-w','start'],{env,stdio:'ignore'});started=true;
 sql(readFileSync('tests/fixtures/sprint-review-base.sql','utf8'));
 for(const f of ['202610020001_planning_v1.sql','202610030001_planning_task_dependencies.sql','202610040001_planning_task_assignees.sql',readdirSync('supabase/migrations').find(x=>x.endsWith('_sprint_review_v1.sql'))])sql(readFileSync('supabase/migrations/'+f,'utf8'));
 sql(`${actor(1)}select planning_save('season',${literal({id:id(101),name:'Native synthetic season',status:'active'})});select planning_save('board',${literal({id:id(201),season_id:id(101),kind:'project',name:'Cross-functional project'})});`);
 sql(save('review',review(),901));sql(save('assignment',assignment,902));
 // Two different update IDs for the same review/project still converge to one record.
 const gate=await hold('unique_gate');
 const pair=await Promise.allSettled([asyncSQL(save('update',update(501),903,3)),asyncSQL(save('update',update(502),904,4))]);await gate.p;
 assert.equal(pair.filter(x=>x.status==='fulfilled').length,1);assert.match(String(pair.find(x=>x.status==='rejected').reason),/Changed by another teammate/);
 const winner=Number(sql('select right(id::text,12)::int from planning_sprint_review_updates'));assert.equal(sql('select count(*) from planning_sprint_review_updates'),'1');pass('simultaneous project update creation is singular');
 const original=update(winner,1);const identical=await hold('identical_gate');
 const replayed=await Promise.all([asyncSQL(save('update',original,910,3)),asyncSQL(save('update',original,910,3))]);await identical.p;
 assert.deepEqual(value(replayed[0]),value(replayed[1]));assert.equal(sql(`select count(*) from planning_review_private.history where request_id='${id(910)}'`),'1');pass('simultaneous exact replay commits one mutation and audit');
 const conflict=await hold('payload_gate');
 const collision=await Promise.allSettled([asyncSQL(save('update',update(winner,2),911,3)),asyncSQL(save('update',{...update(winner,2),progress:'Different'},911,3))]);await conflict.p;
 assert.equal(collision.filter(x=>x.status==='fulfilled').length,1);assert.match(String(collision.find(x=>x.status==='rejected').reason),/request ID/);pass('same actor/request with changed payload cannot overwrite');
 const stale=await hold('version_gate');
 const staleResults=await Promise.allSettled([asyncSQL(save('update',update(winner,3),912,3)),asyncSQL(save('update',update(winner,3),913,4))]);await stale.p;
 assert.equal(staleResults.filter(x=>x.status==='fulfilled').length,1);assert.match(String(staleResults.find(x=>x.status==='rejected').reason),/Changed by another teammate/);pass('two sessions sharing a version yield one winner');
 const cancelFirst=asyncSQL(`begin;${recovery('cancel_mutation',920)}select pg_sleep(1.1) /* cancel_first */;commit;`);await waiting('cancel_first');
 const cancelledWrite=asyncSQL(save('review',review(420),920));await cancelFirst;assert.equal(value(await cancelledWrite).status,'cancelled');assert.equal(sql(`select count(*) from planning_sprint_reviews where id='${id(420)}'`),'0');pass('cancel before queued save leaves permanent no-write tombstone');
 const writeFirst=asyncSQL(`begin;${save('review',review(421),921)}select pg_sleep(1.1) /* write_first */;commit;`);await waiting('write_first');
 const cancellation=asyncSQL(recovery('cancel_mutation',921));const status=asyncSQL(recovery('mutation_status',921));await writeFirst;
 assert.equal(value(await cancellation).status,'applied');assert.equal(value(await status).status,'applied');assert.equal(sql(`select count(*) from planning_sprint_reviews where id='${id(421)}'`),'1');pass('save before cancellation/status reports the committed result exactly');
 const revoke=await hold('role_gate');const revoked=asyncSQL(save('update',update(winner,4),930,3));
 await waiting('sprint_review_save','advisory');sql(`update profiles set role='readonly' where id='${id(3)}'`);
 await assert.rejects(revoked,/unavailable/);await revoke.p;assert.equal(sql(`select count(*) from planning_review_private.requests where request_id='${id(930)}'`),'0');sql(`update profiles set role='student' where id='${id(3)}'`);pass('writer role is rechecked after waiting on Planning lock');
 const revokeAssignment=await hold('assignment_gate');const unassigned=asyncSQL(save('update',update(winner,4),931,4));await waiting('sprint_review_save','advisory');sql(`delete from planning_project_review_supporters where user_id='${id(4)}'`);
 await assert.rejects(unassigned,/unavailable/);await revokeAssignment.p;pass('supporter removal is rechecked after waiting');
 const switchGate=await hold('actor_gate');const switched=asyncSQL(save('update',update(winner,4),932,3,1));await assert.rejects(switched,/account changed/);await switchGate.p;pass('expected actor binding rejects switched account after waiting');
 const archiveGate=await hold('archive_gate');const archived=asyncSQL(save('update',update(winner,4),933,3));await waiting('sprint_review_save','advisory');sql(`update planning_seasons set status='archived' where id='${id(101)}'`);
 await assert.rejects(archived,/unavailable/);await archiveGate.p;sql(`update planning_seasons set status='active' where id='${id(101)}'`);pass('season archival is rechecked after waiting');
 const unknown=id(940);assert.equal(value(sql(recovery('mutation_status',940,3))).status,'unknown');assert.equal(value(sql(recovery('mutation_status',910,4))).status,'unknown');pass('status contains no draft data and is isolated to the authenticated actor');
 sql(`create function planning_review_private.audit_failure() returns trigger language plpgsql as $$begin raise exception 'protected test detail';end$$;create trigger audit_failure before insert on planning_review_private.history for each row execute function planning_review_private.audit_failure();`);
 await assert.rejects(asyncSQL(save('update',update(winner,4),950,3)),e=>/Invalid Sprint Review/.test(e.message)&&!e.message.includes('protected test detail'));
 assert.equal(sql(`select version from planning_sprint_review_updates where id='${id(winner)}'`),'4');assert.equal(value(sql(recovery('mutation_status',950,3))).status,'unknown');pass('native audit failure rolls back mutation and receipt with sanitized error');
 console.log(`${checks} native multi-session/transaction checks passed; isolated PostgreSQL ${sql('show server_version')} only.`);
}catch(error){if(!started){try{console.error(readFileSync(join(dir,'server.log'),'utf8'));}catch{}}throw error;}finally{
 if(started)execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,stdio:'ignore'});
 rmSync(dir,{recursive:true,force:true});
}
