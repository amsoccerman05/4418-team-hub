// Isolated native PostgreSQL only. No production URL, credentials, network listener or email.
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const bin=process.env.NOTIFICATION_PG_BIN||'/opt/homebrew/opt/postgresql@17/bin';
const dir=mkdtempSync('/tmp/impulse-notification-native-'),data=join(dir,'db');
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('PG'))delete env[k];
const args=['-X','-h',dir,'-p','55439','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(join(bin,'psql'),args,{input:q,encoding:'utf8',env}).trim();
const asyncSQL=q=>new Promise((resolve,reject)=>{const p=spawn(join(bin,'psql'),args,{env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('exit',c=>c?reject(Error(err)):resolve(out.trim()));p.stdin.end(q);});
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const user=`select set_config('test.uid','${id(2)}',false);set role authenticated;`;
async function sleeping(marker){for(let i=0;i<100;i++){if(sql(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and query like '%${marker}%' and wait_event='PgSleep'`)==='1')return;await new Promise(r=>setTimeout(r,20));}throw Error('Session did not reach controlled synchronization point');}
let started=false;
try{
 execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','postgres','--no-locale'],{env,stdio:'ignore'});
 execFileSync(join(bin,'pg_ctl'),['-D',data,'-l',join(dir,'server.log'),'-o',`-k ${dir} -p 55439 -c listen_addresses=''`,'-w','start'],{env,stdio:'ignore'});started=true;
 const test=readFileSync('tests/notification-center-db.spec.ts','utf8');const body=test.split('test.beforeEach(async()=>{')[1].split('\n});\ntest.afterEach')[0].replace('db=new PGlite();','');
 const statements=[];await new (Object.getPrototypeOf(async()=>{}).constructor)('db','id','readFileSync',body)({exec:async q=>statements.push(q)},id,readFileSync);
 sql(statements.join('\n'));
 sql(`select set_config('test.uid','${id(1)}',false);select team_announcement_save('{"title":"Native fixture","body":"Local only","severity":"normal","active":true}');`);
 const announcement=sql('select id from team_announcements limit 1');
 const create=(key,person=2)=>`with event as(select notifications_private.center_event('announcements','${key}','published','${announcement}',1,'Native test','Local') id) insert into notifications_private.recipients(event_id,user_id) select id,'${id(person)}' from event on conflict do nothing;`;
 const one=asyncSQL(`begin;${create('race')}select pg_sleep(1.5) /* create_gate */;commit;`);await sleeping('create_gate');const two=asyncSQL(`begin;${create('race')}commit;`);await Promise.all([one,two]);
 assert.equal(sql("select count(*) from notifications_private.events where event_key='race'"),'1');assert.equal(sql("select count(*) from notifications_private.recipients r join notifications_private.events e on e.id=r.event_id where e.event_key='race'"),'1');sql(create('race',3));assert.equal(sql("select count(*) from notifications_private.recipients r join notifications_private.events e on e.id=r.event_id where e.event_key='race'"),'2');console.log('PASS concurrent event/recipient creation and distinct recipients');
 const notice=sql(`select r.id from notifications_private.recipients r join notifications_private.events e on e.id=r.event_id where e.event_key='race' and r.user_id='${id(2)}'`);
 const first=asyncSQL(`begin;${user}select notification_read('${notice}');select pg_sleep(1.5) /* read_gate */;commit;`);await sleeping('read_gate');const second=asyncSQL(`${user}select notification_read('${notice}');`);await Promise.all([first,second]);const stamp=sql(`select read_at from notifications_private.recipients where id='${notice}'`);assert.ok(stamp);sql(`${user}select notification_read('${notice}');`);assert.equal(sql(`select read_at from notifications_private.recipients where id='${notice}'`),stamp);assert.equal(sql(`select count(*) from notifications_private.recipients where user_id='${id(3)}' and read_at is not null`),'0');console.log('PASS simultaneous mark-read is idempotent and recipient-specific');
 const all=asyncSQL(`begin;${user}select notification_read();select pg_sleep(1.5) /* all_gate */;commit;`);await sleeping('all_gate');sql(create('arrived-after-read'));await all;
 assert.equal(sql(`select count(*) from notifications_private.recipients r join notifications_private.events e on e.id=r.event_id where e.event_key='arrived-after-read' and r.read_at is null`),'1');console.log('PASS concurrent incoming notification stays unread after mark-all snapshot');
 sql(`select set_config('test.uid','${id(1)}',false);select team_announcement_save('{"title":"Queued fixture","body":"Local only","severity":"normal","send_email":true,"email_request_id":"${id(901)}"}');`);
 const count=sql('select count(*) from notifications_private.recipients');const [a,b]=await Promise.all([asyncSQL('select id from team_notification_claim(3)'),asyncSQL('select id from team_notification_claim(3)')]);const ids=[...a.split('\n'),...b.split('\n')].filter(Boolean);assert.equal(ids.length,new Set(ids).size);assert.ok(ids.length>0);
 const n=ids[0],token=sql(`select lease_token from team_notifications where id='${n}'`);await Promise.all([asyncSQL(`select team_notification_finish('${n}','${token}','retry','local',null)`),asyncSQL(`select team_notification_finish('${n}','${token}','retry','local',null)`)]);assert.equal(sql('select count(*) from notifications_private.recipients'),count);console.log('PASS concurrent worker claims/duplicate finishes do not duplicate recipient rows');
 console.log('4 native multi-session checks passed; no email sent.');
}finally{if(started)execFileSync(join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{env,stdio:'ignore'});rmSync(dir,{recursive:true,force:true});}
