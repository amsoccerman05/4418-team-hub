import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);}
async function dashboard(){return (await db.query<any>('select team_dashboard_context() c')).rows[0].c;}
async function announce(p:Record<string,unknown>){return (await db.query<any>('select team_announcement_save($1::jsonb) id',[JSON.stringify({title:'Team update',body:'Welcome',severity:'normal',...p})])).rows[0].id;}
test.beforeEach(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table profiles(id uuid primary key,display_name text,role text,active boolean,primary_area_id uuid,updated_at timestamptz default now());
 create table areas(id uuid primary key default gen_random_uuid(),name text,active boolean default true,slug text unique default gen_random_uuid()::text);
 insert into areas(id,name) values('${id(101)}','Fabrication'),('${id(102)}','Electrical');
 insert into profiles(id,display_name,role,active,primary_area_id) values('${id(1)}','Mentor','mentor',true,'${id(101)}'),('${id(2)}','Student','student',true,'${id(101)}'),('${id(3)}','Other student','student',true,'${id(102)}'),('${id(4)}','Inactive','mentor',false,null),('${id(5)}','Lead','lead',true,'${id(101)}'),('${id(6)}','Reader','readonly',true,null),('${id(7)}','Admin','admin',true,null);
 grant select on profiles,areas to authenticated;
 alter table profiles enable row level security;create policy profile_read on profiles for select to authenticated using(id=auth.uid());
 create table pit_events(id uuid primary key,name text,status text);create table pit_issues(id uuid primary key,event_id uuid,severity text,status text);
 create table inventory_items(id uuid primary key,quantity numeric,minimum_quantity numeric);create table inventory_balances(inventory_item_id uuid,quantity numeric);
 grant select on pit_events,pit_issues,inventory_items,inventory_balances to authenticated;
 insert into pit_events values('${id(301)}','Competition','active');insert into pit_issues values('${id(302)}','${id(301)}','ROBOT DOWN','DEFERRED');
 insert into inventory_items values('${id(401)}',0,2),('${id(402)}',3,5);insert into inventory_balances values('${id(401)}',0),('${id(402)}',3);
 `);
 await db.exec(readFileSync('supabase/migrations/202609100001_team_attendance.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/finance_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609120003_team_management_positions.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609120005_hub_dashboard_announcements.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/finance_notifications.sql','utf8'));
 // Storage service enforces bucket size/MIME; local tables exercise actual RLS policies.
 await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
 await db.exec(readFileSync('supabase/migrations/202609120006_team_communications.sql','utf8'));

 await db.exec(`insert into team_meetings(id,title,meeting_type,starts_at,ends_at,requirement,status,created_by) values('${id(201)}','Past','preseason',now()-interval '2 days',now()-interval '1 day','registered','finalized','${id(1)}'),('${id(202)}','Next build','other',now()+interval '1 day',now()+interval '1 day 3 hours','registered','draft','${id(1)}');
 insert into team_meeting_members(meeting_id,student_id,required,member_status,team_area) values('${id(201)}','${id(2)}',true,'registered','Fabrication'),('${id(202)}','${id(2)}',true,'registered','Fabrication'),('${id(201)}','${id(3)}',true,'registered','Electrical');
 select set_config('test.uid','${id(1)}',false);
 insert into team_attendance(id,meeting_id,student_id,physical_status,review_status) values('${id(211)}','${id(201)}','${id(2)}','late','none'),('${id(212)}','${id(202)}','${id(2)}','pending','pending'),('${id(213)}','${id(201)}','${id(3)}','absent','pending');
 insert into team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by) values('${id(213)}','${id(3)}','${id(201)}','Other',5,'Internal discipline','${id(1)}');
 insert into finance_purchase_orders(id,requester_id,area_id,sheet_url,vendor,amount,purpose,status,revision) values('${id(501)}','${id(2)}','${id(101)}','https://docs.google.com/spreadsheets/d/fixture','My vendor',25,'Parts','awaiting_approval',1),('${id(502)}','${id(3)}','${id(102)}','https://docs.google.com/spreadsheets/d/fixture','Private vendor',99,'Parts','awaiting_approval',1);
 insert into finance_po_revisions(po_id,revision,metadata,submitted_by) values('${id(501)}',1,'{}','${id(2)}'),('${id(502)}',1,'{}','${id(3)}');`);
 await db.exec(readFileSync('supabase/migrations/202609120001_attendance_requests_recurrence.sql','utf8'));
 await db.exec(`reset role;drop view team_attendance_history;alter table team_attendance_private.history set schema public;alter table public.history rename to team_attendance_history;grant select on team_attendance_history to authenticated;create policy attendance_history_read on team_attendance_history for select to authenticated using(team_attendance_private.manager() or student_id=auth.uid());`);
 await db.exec(readFileSync('tests/fixtures/attendance-production-functions.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609300001_attendance_policy_v03.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/finance_notification_coverage.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610050001_notification_center.sql','utf8'));

});
test.afterEach(()=>db.close());

async function center(filter='all'){return (await db.query<any>('select notification_center($1) c',[filter])).rows[0].c;}
async function read(n:string|null=null,unread=false){await db.query('select notification_read($1,$2)',[n,unread]);}
test('prospective announcements, isolated read state, audience recheck, idempotence and private storage',async()=>{
 await as(1);await announce({title:'Public update'});await announce({title:'Area update',audience:'area',area_id:id(101)});await announce({title:'Unpublished',active:false});
 await as(2);let c=await center();expect(c.items).toHaveLength(2);expect(c.unread).toBe(2);expect(c.items.every((n:any)=>n.href==='#home-announcements')).toBe(true);
 const nid=c.items[0].id;await read(nid);const first=(await center()).items.find((n:any)=>n.id===nid).read_at;await read(nid);expect((await center()).items.find((n:any)=>n.id===nid).read_at).toBe(first);await read(nid,true);expect((await center()).unread).toBe(2);
 await as(3);expect((await center()).items).toHaveLength(1);await read(nid);await as(2);expect((await center()).unread).toBe(2);await read();await read();expect((await center()).unread).toBe(0);
 expect(Object.keys(c.items[0]).sort()).toEqual(['id','source','title','message','created_at','read_at','href','action_needed'].sort());
 await expect(db.exec('select * from notifications_private.recipients')).rejects.toThrow(/permission/);await expect(db.exec('select * from team_notifications')).rejects.toThrow(/permission/);
 await db.exec('reset role');expect((await db.query<any>('select count(*)::int n from team_notifications')).rows[0].n).toBe(0);
 await as(4);await expect(center()).rejects.toThrow(/Active/);await db.exec('reset role;set role anon');await expect(center()).rejects.toThrow(/permission/);
});
async function position(user:number,key:string){await as(1);await db.query("select team_manage('assign_position',$1)",[JSON.stringify({user_id:id(user),position_key:key,reason:'Local notification test'})]);}
async function finance(action:string,p:any){return (await db.query<any>('select finance_mutate($1,$2) id',[action,JSON.stringify(p)])).rows[0].id;}
async function poAction(user:number,pid:string,action:string,p:any={}){await as(user);const r=(await db.query<any>('select version from finance_purchase_orders where id=$1',[pid])).rows[0];return finance(action,{id:pid,version:r.version,...p});}
async function purchase(){await position(2,'finance_lead');await position(3,'lead_coach_1');await as(5);const pid=await finance('create',{vendor:'Supplier',amount:100,purpose:'Parts',area_id:id(101),sheet_url:'https://docs.google.com/spreadsheets/d/LocalFixture/edit'});await poAction(5,pid,'submit');return pid;}
async function request(kind='absent'){await as(2);const a=(await db.query<any>('select * from team_attendance where id=$1',[id(212)])).rows[0];await db.query('select team_attendance_request($1)',[JSON.stringify({meeting_id:id(202),version:a.version,notice_type:kind,reason:'PRIVATE medical information',expected_at:kind==='absent'?null:new Date(Date.now()+26*3600000).toISOString()})]);}
async function review(status:string){await as(1);const a=(await db.query<any>('select * from team_attendance where id=$1',[id(212)])).rows[0];await db.query("select team_attendance_manage('attendance',$1)",[JSON.stringify({meeting_id:id(202),attendance_id:a.id,version:a.version,review_status:status,explanation:'PRIVATE reviewer note'})]);}
async function counts(){await db.exec('reset role');return (await db.query<any>(`select (select count(*)::int from notifications_private.events) events,(select count(*)::int from notifications_private.recipients) recipients,(select count(*)::int from team_notifications) emails`)).rows[0];}
test('Finance current approval/school action is independent of read state; events/email recipients remain v6',async()=>{
 const pid=await purchase();expect(await counts()).toEqual({events:1,recipients:2,emails:2});await as(2);let c=await center();expect(c.items[0].action_needed).toBe(true);expect(c.items[0].href).toBe('https://finance.frc4418.org/#po/'+pid);await read(c.items[0].id);expect((await center('action')).items).toHaveLength(1);
 await poAction(2,pid,'approve',{slot:'finance_approver'});await as(2);expect((await center()).items[0].action_needed).toBe(false);await as(3);expect((await center('action')).items.length).toBeGreaterThan(0);
 await poAction(3,pid,'approve',{slot:'po_approver'});await as(1);c=await center('action');expect(c.items).toHaveLength(1);expect(c.items[0].title).toContain('ready for school');await read(c.items[0].id);expect((await center('action')).items).toHaveLength(1);
 await poAction(1,pid,'school_submit',{reference:'Local'});expect((await center('action')).items).toHaveLength(0);expect((await center()).items).toHaveLength(1);await as(5);expect((await center()).items.some((n:any)=>n.title.includes('submitted to school'))).toBe(true);
});
test('Finance changes requested, resubmit, cancellation, retry dedup and no historical replay',async()=>{
 const pid=await purchase();await poAction(2,pid,'request_changes',{slot:'finance_approver',reason:'Change parts'});await as(5);expect((await center()).items[0].title).toContain('needs changes');
 await poAction(5,pid,'submit');await as(2);expect((await center('action')).items).toHaveLength(1);await poAction(5,pid,'cancel',{reason:'No longer needed'});await as(2);expect((await center('action')).items).toHaveLength(0);expect((await center()).items[0].title).toContain('canceled');
 const before=await counts();const h=(await db.query<any>('select max(id) id from finance_private.history')).rows[0].id;await db.query('select team_notification_enqueue_history($1)',[h]);expect(await counts()).toEqual(before);
 // Simulate reviewed installation cutoff around an old event with no prior outbox rows.
 await db.exec(`update notifications_private.center_epoch set finance_history_id=999999`);
 await db.query("insert into finance_private.history(po_id,revision,action,actor_id,details) select id,revision,'submit',$2,jsonb_build_object('after',to_jsonb(p)) from finance_purchase_orders p where id=$1",[pid,id(5)]);
 expect((await counts()).recipients).toBe(before.recipients);
});
for(const kind of ['absent','late','early'])test(`Attendance ${kind} request notifies only current reviewers, no reasons leaked`,async()=>{
 await position(3,'program_manager');await request(kind);expect(await counts()).toEqual({events:1,recipients:2,emails:2});
 await as(1);const c=await center();expect(c.items[0].action_needed).toBe(true);expect(JSON.stringify(c)).not.toContain('PRIVATE');expect(c.items[0].href).toBe('#attendance/notices');await read(c.items[0].id);expect((await center('action')).items).toHaveLength(1);
 await as(2);expect((await center()).items).toHaveLength(0);await as(5);expect((await center()).items).toHaveLength(0);
 await db.exec('reset role');const email=(await db.query<any>("select id,payload from team_notifications where recipient_id=$1",[id(3)])).rows[0];expect(JSON.stringify(email.payload)).not.toContain('PRIVATE');
 await db.exec(`update team_member_positions set revoked_at=now(),revoked_by='${id(1)}',revoke_reason='Test' where user_id='${id(3)}' and position_key='program_manager'`);
 await db.exec('set role service_role');expect((await db.query<any>('select team_attendance_delivery_allowed($1) ok',[email.id])).rows[0].ok).toBe(false);await as(3);expect((await center()).items).toHaveLength(0);
 await position(5,'program_manager');await as(5);expect((await center()).items).toHaveLength(0);
});
for(const status of ['excused','denied'])test(`Attendance ${status} decision persists in-app and email independently; no check-in noise`,async()=>{
 await request();await review(status);await as(1);expect((await center('action')).items).toHaveLength(0);expect((await center()).items).toHaveLength(1);await as(2);let c=await center();expect(c.items).toHaveLength(1);expect(c.items[0].title).toContain(status==='excused'?'approved':'denied');expect(c.items[0].action_needed).toBe(false);expect(JSON.stringify(c)).not.toContain('PRIVATE');
 const before=await counts();await db.query("update team_attendance set checked_in_at=now(),physical_status='present',version=version+1 where id=$1",[id(212)]);await db.query("update team_attendance set left_at=now(),physical_status='left_early',version=version+1 where id=$1",[id(212)]);expect(await counts()).toEqual(before);
 await db.exec("update team_notifications set status='failed',last_error='PRIVATE provider error' where source='attendance'");await as(2);expect((await center()).items).toHaveLength(1);expect(JSON.stringify(await center())).not.toContain('provider');
});
test('self-review excluded; strike notifies affected member only and preserves audit',async()=>{
 await position(2,'program_manager');await request();await as(2);expect((await center()).items).toHaveLength(0);
 await as(1);await db.query("select team_attendance_manage('strike',$1)",[JSON.stringify({attendance_id:id(212),meeting_id:id(202),category:'Other',quantity:1,explanation:'PRIVATE discipline details'})]);await as(2);const c=await center();expect(c.items).toHaveLength(1);expect(c.items[0].title).toContain('strike');expect(JSON.stringify(c)).not.toContain('PRIVATE');await db.exec('reset role');expect((await db.query<any>("select count(*)::int n from team_notifications where event='strike_assigned'")).rows[0].n).toBe(1);
});
test('notification persistence failure rolls back domain data and audit together',async()=>{
 await db.exec(`reset role;create function notifications_private.fail_test() returns trigger language plpgsql as $$begin raise exception 'inbox unavailable';end$$;create trigger fail_test before insert on notifications_private.recipients for each row execute function notifications_private.fail_test();`);
 const before=(await db.query<any>('select to_jsonb(a) a from team_attendance a where id=$1',[id(212)])).rows[0].a;const hist=(await db.query<any>('select count(*)::int n from team_attendance_history')).rows[0].n;
 await expect(request()).rejects.toThrow(/inbox unavailable/);await db.exec('reset role');expect((await db.query<any>('select to_jsonb(a) a from team_attendance a where id=$1',[id(212)])).rows[0].a).toEqual(before);expect((await db.query<any>('select count(*)::int n from team_attendance_history')).rows[0].n).toBe(hist);expect(await counts()).toEqual({events:0,recipients:0,emails:0});
});
test('bounded keyset pagination, explicit announcement email dedup, revoked visibility',async()=>{
 await as(1);for(let n=0;n<33;n++)await announce({title:'Update '+n});const aid=await announce({title:'Email update',send_email:true,email_request_id:id(900)});await as(2);let c=await center();expect(c.items).toHaveLength(30);expect(c.has_more).toBe(true);const last=c.items.at(-1);const next=(await db.query<any>('select notification_center($1,$2,$3) c',['all',last.created_at,last.id])).rows[0].c;expect(next.items).toHaveLength(4);expect(next.has_more).toBe(false);expect(new Set([...c.items,...next.items].map((n:any)=>n.id)).size).toBe(34);
 await db.exec('reset role');expect((await db.query<any>('select count(*)::int n from notifications_private.events where object_id=$1',[aid])).rows[0].n).toBe(1);expect((await db.query<any>('select count(*)::int n from team_notifications where announcement_id=$1',[aid])).rows[0].n).toBeGreaterThan(0);
 await as(1);await announce({id:aid,version:1,active:false});await as(2);expect((await center()).unread).toBe(33);
});
test('current Finance visibility and inactive recipient restrictions are rechecked; no direct helper/write bypass',async()=>{
 await purchase();await as(6);expect((await center()).items).toHaveLength(0);await as(2);expect((await center()).items).toHaveLength(1);
 await db.exec(`reset role;update team_member_positions set revoked_at=now(),revoked_by='${id(1)}',revoke_reason='Test' where user_id='${id(2)}' and position_key='finance_lead'`);await as(2);expect((await center()).items).toHaveLength(0);
 for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);for(const query of ['select * from notifications_private.events','update notifications_private.recipients set user_id=event_id','truncate notifications_private.recipients','select notifications_private.center_rows()','select notifications_private.attendance_reviewer(null)'])await expect(db.exec(query)).rejects.toThrow(/permission/);}
});
test('concurrent/repeated read and event delivery retries preserve one identity and server read timestamp',async()=>{
 const pid=await purchase();await as(2);const n=(await center()).items[0];await Promise.all([read(n.id),read(n.id),read()]);const saved=(await center()).items[0];expect(saved.read_at).toBeTruthy();expect(saved.action_needed).toBe(true);await read(n.id);expect((await center()).items[0].read_at).toBe(saved.read_at);
 const before=await counts();const h=(await db.query<any>('select max(id) id from finance_private.history where po_id=$1',[pid])).rows[0].id;await Promise.all([db.query('select team_notification_enqueue_history($1)',[h]),db.query('select team_notification_enqueue_history($1)',[h])]);expect(await counts()).toEqual(before);
 await db.exec('set role service_role');const delivery=(await db.query<any>('select * from team_notification_claim(3)')).rows;expect(delivery).toHaveLength(2);for(const d of delivery)await db.query("select team_notification_finish($1,$2,'retry','provider_timeout',null)",[d.id,d.lease_token]);expect(await counts()).toEqual(before);await as(2);expect((await center()).items[0].id).toBe(n.id);
});
test('Finance submission rolls back when in-app persistence fails; draft and prior history remain',async()=>{
 await position(2,'finance_lead');await as(5);const pid=await finance('create',{vendor:'Rollback',amount:10,purpose:'Test',area_id:id(101),sheet_url:'https://docs.google.com/spreadsheets/d/LocalFixture/edit'});
 await db.exec(`reset role;create function notifications_private.fail_finance() returns trigger language plpgsql as $$begin raise exception 'notification unavailable';end$$;create trigger fail_finance before insert on notifications_private.recipients for each row execute function notifications_private.fail_finance();`);
 const before=(await db.query<any>('select to_jsonb(p) p from finance_purchase_orders p where id=$1',[pid])).rows[0].p;const count=(await db.query<any>('select count(*)::int n from finance_private.history')).rows[0].n;
 await expect(poAction(5,pid,'submit')).rejects.toThrow(/notification unavailable/);await db.exec('reset role');expect((await db.query<any>('select to_jsonb(p) p from finance_purchase_orders p where id=$1',[pid])).rows[0].p).toEqual(before);expect((await db.query<any>('select count(*)::int n from finance_private.history')).rows[0].n).toBe(count);expect(await counts()).toEqual({events:0,recipients:0,emails:0});
});
