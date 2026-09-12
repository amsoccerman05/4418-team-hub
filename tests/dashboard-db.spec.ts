import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);}
async function dashboard(){return (await db.query<any>('select team_dashboard_context() c')).rows[0].c;}
async function announce(p:Record<string,unknown>){return (await db.query<any>('select team_announcement_save($1::jsonb) id',[JSON.stringify({title:'Team update',body:'Welcome',severity:'normal',...p})])).rows[0].id;}
test.beforeAll(async()=>{
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
});
test.afterAll(()=>db.close());
test('student context includes only personal attendance and POs, without team summaries',async()=>{await as(2);const c=await dashboard();expect(c.personal).toEqual({percent:100,strikes:0,pending:1});expect(c.next_meeting.title).toBe('Next build');expect(c.orders.map((p:any)=>p.vendor)).toEqual(['My vendor']);expect(c.attention).toBeNull();expect(c.robot).toBeNull();expect(c.inventory).toBeNull();expect(JSON.stringify(c)).not.toContain('Internal discipline');});
test('mentor/admin/lead summaries preserve operational calculations',async()=>{for(const n of [1,5,7]){await as(n);const c=await dashboard();expect(c.attention.requests).toBe(2);expect(c.attention.strike_actions).toBe(1);expect(c.robot.readiness).toBe('NOT READY');expect(c.robot.blocking).toBe(1);expect(c.inventory).toEqual({out:1,low:1});}});
test('Finance actions use positions, exclude requester and prior actor, preserve distinct slots',async()=>{
 await as(1);await db.query("select team_manage('assign_position',$1::jsonb)",[JSON.stringify({user_id:id(5),position_key:'lead_coach_2',reason:'Test coach'})]);await as(5);expect((await dashboard()).finance.approvals).toBe(2);
 await db.exec('reset role');await db.exec(`insert into finance_po_approvals(po_id,revision,slot,action,actor_id) values('${id(501)}',1,'po_approver','approved','${id(5)}')`);await as(5);expect((await dashboard()).finance.approvals).toBe(1);
 await as(1);await db.query("select team_manage('assign_position',$1::jsonb)",[JSON.stringify({user_id:id(2),position_key:'finance_lead',reason:'Test finance'})]);await as(2);expect((await dashboard()).finance.approvals).toBe(1);
 await db.exec(`reset role;insert into finance_po_approvals(po_id,revision,slot,action,actor_id) values('${id(501)}',1,'finance_approver','approved','${id(1)}');update finance_purchase_orders set status='approved' where id='${id(501)}';`);await as(1);expect((await dashboard()).finance.school).toBe(1);await as(2);expect((await dashboard()).finance.school).toBe(0);
});
test('global and area announcements respect RLS; expired/inactive hidden even on admin dashboard',async()=>{
 await as(1);await announce({title:'Global'});await announce({title:'Fabrication only',area_id:id(101)});await announce({title:'Expired',expires_at:'2000-01-01'});await announce({title:'Inactive',active:false});
 await as(2);expect((await dashboard()).announcements.map((a:any)=>a.title).sort()).toEqual(['Fabrication only','Global']);await as(3);expect((await dashboard()).announcements.map((a:any)=>a.title)).toEqual(['Global']);
 await as(1);expect((await db.query('select * from team_announcements')).rows.length).toBe(4);expect((await dashboard()).announcements.length).toBe(2);
});
test('announcement edits preserve creator, reject stale writes, and deactivate',async()=>{await as(1);const aid=await announce({title:'Edit me',created_by:id(3)});await announce({id:aid,version:1,title:'Edited',active:false});expect((await dashboard()).announcements.some((a:any)=>a.id===aid)).toBe(false);await expect(announce({id:aid,version:1})).rejects.toThrow(/changed/);const a=(await db.query<any>('select * from team_announcements where id=$1',[aid])).rows[0];expect(a.created_by).toBe(id(1));expect(a.version).toBe(2);});
test('students/leads/readonly/inactive cannot manage announcements or directly write',async()=>{for(const n of [2,3,4,5,6]){await as(n);await expect(announce({})).rejects.toThrow(/mentor or admin/);await expect(db.exec("update team_announcements set title='Forged'")).rejects.toThrow(/permission denied/);}});
test('inactive and anonymous dashboard access denied; readonly gets no disciplinary data',async()=>{await as(4);await expect(dashboard()).rejects.toThrow(/Active team/);expect((await db.query('select * from team_announcements')).rows).toHaveLength(0);await as(6);const c=await dashboard();expect(c.personal.strikes).toBe(0);expect(c.attention).toBeNull();await db.exec('reset role;set role anon');await expect(dashboard()).rejects.toThrow(/permission denied/);});

const added=['program_manager','product_technical_manager','software_lead','business_lead','cad_lead','fabrication_lead','strategy_lead','power_lead','communications_lead','operations_lead'];
test('new leadership positions assign without granting global or Finance powers',async()=>{
 await as(1);for(const key of added)await db.query("select team_manage('assign_position',$1::jsonb)",[JSON.stringify({user_id:id(3),position_key:key,reason:'Directory test'})]);
 await as(3);const c=(await db.query<any>("select team_my_positions() positions,finance_private.cap('finance_approver') finance,finance_private.cap('po_approver') coach,team_private.admin() admin")).rows[0];expect(c.positions.sort()).toEqual([...added].sort());expect(c.finance||c.coach||c.admin).toBe(false);await expect(announce({})).rejects.toThrow(/mentor or admin/);
});
test('expanded audience visibility and recipients use active current memberships',async()=>{
 await db.exec(`reset role;insert into team_attendance_members(student_id,member_status) values('${id(2)}','registered'),('${id(3)}','prospective');`);
 await as(1);const reg=await announce({audience:'registered'}),lead=await announce({audience:'leadership'}),pos=await announce({audience:'position',position_key:'software_lead'});
 for(const [user,expected] of [[2,[reg]],[3,[pos]],[5,[]],[6,[]]] as [number,string[]][]){await as(user);const visible=(await dashboard()).announcements.filter((a:any)=>[reg,lead,pos].includes(a.id)).map((a:any)=>a.id);expect(visible.sort()).toEqual(expected.sort());}
 await as(1);expect((await dashboard()).announcements.some((a:any)=>a.id===lead)).toBe(true);
 const assignment=(await db.query<any>("select id from team_member_positions where user_id=$1 and position_key='software_lead' and revoked_at is null",[id(3)])).rows[0].id;
 await db.query("select team_manage('revoke_position',$1::jsonb)",[JSON.stringify({user_id:id(3),assignment_id:assignment,reason:'Term ended'})]);await as(3);expect((await dashboard()).announcements.some((a:any)=>a.id===pos)).toBe(false);
});
test('email publish retries dedupe; edit never sends; explicit update is independently deduped',async()=>{
 await as(1);const event=id(701);const a=await announce({title:'Email publish',send_email:true,email_request_id:event});const again=await announce({title:'Email publish',send_email:true,email_request_id:event});expect(again).toBe(a);
 await db.exec('reset role');let rows=(await db.query<any>("select * from team_notifications where announcement_id=$1",[a])).rows;expect(rows.length).toBe(6);expect(rows.every(n=>n.source==='hub'&&n.entity_type==='announcement'&&n.event==='announcement_published'&&n.channel==='email')).toBe(true);expect(rows.some(n=>n.recipient_id===id(4))).toBe(false);expect(rows.some(n=>n.recipient_id===id(6))).toBe(true);
 await as(1);await announce({id:a,version:1,title:'Edited without email'});await db.exec('reset role');expect((await db.query('select * from team_notifications where announcement_id=$1',[a])).rows.length).toBe(6);
 await as(1);for(let i=0;i<2;i++)await db.query('select team_announcement_send_update($1,2,$2)',[a,id(702)]);
 await db.exec('reset role');expect((await db.query('select * from team_notifications where announcement_id=$1',[a])).rows.length).toBe(12);
 await as(2);await expect(db.query('select team_announcement_send_update($1,2,$2)',[a,id(703)])).rejects.toThrow(/mentor or admin/);
 await as(1);await expect(announce({id:a,version:2,send_email:true,email_request_id:id(704)})).rejects.toThrow(/Send update email/);
});
test('position revocation and inactive profiles stop queued announcement delivery',async()=>{
 await as(1);const a=await announce({audience:'position',position_key:'communications_lead',send_email:true,email_request_id:id(705)});
 await db.exec('reset role');const n=(await db.query<any>('select id,recipient_id from team_notifications where announcement_id=$1',[a])).rows[0];expect(n.recipient_id).toBe(id(3));
 await db.exec('set role service_role');expect((await db.query<any>('select team_announcement_delivery_allowed($1) ok',[n.id])).rows[0].ok).toBe(true);
 await db.exec(`reset role;update profiles set active=false where id='${id(3)}';set role service_role;`);expect((await db.query<any>('select team_announcement_delivery_allowed($1) ok',[n.id])).rows[0].ok).toBe(false);
 await db.exec(`reset role;update profiles set active=true where id='${id(3)}';update team_member_positions set revoked_by='${id(1)}',revoked_at=now(),revoke_reason='Term ended' where user_id='${id(3)}' and position_key='communications_lead';set role service_role;`);expect((await db.query<any>('select team_announcement_delivery_allowed($1) ok',[n.id])).rows[0].ok).toBe(false);
});
test('private image upload/delete and reads enforce manager and audience policies',async()=>{
 const path=`${id(1)}/${id(801)}.png`;await as(2);await expect(db.query("insert into storage.objects(bucket_id,name) values('team-announcement-media',$1)",[path])).rejects.toThrow(/row-level security/);
 await as(1);await expect(db.query("insert into storage.objects(bucket_id,name) values('team-announcement-media',$1)",[`${id(1)}/${id(802)}.svg`])).rejects.toThrow(/row-level security/);
 await db.query("insert into storage.objects(bucket_id,name) values('team-announcement-media',$1)",[path]);const a=await announce({image_path:path,audience:'area',area_id:id(101)});
 await as(2);expect((await db.query('select * from storage.objects')).rows.length).toBe(1);await db.exec('delete from storage.objects');await as(3);expect((await db.query('select * from storage.objects')).rows.length).toBe(0);
 await as(1);await db.exec('delete from storage.objects');expect((await db.query('select * from storage.objects')).rows.length).toBe(1);await announce({id:a,version:1,image_path:null});await db.exec('delete from storage.objects');expect((await db.query('select * from storage.objects')).rows.length).toBe(0);
 await db.exec('reset role');const bucket=(await db.query<any>("select * from storage.buckets where id='team-announcement-media'")).rows[0];expect(bucket.public).toBe(false);expect(bucket.file_size_limit).toBe(6291456);expect(bucket.allowed_mime_types).toEqual(['image/jpeg','image/png','image/webp']);
});
test('announcement failure stays in outbox; leases and channel boundaries remain intact',async()=>{
 await db.exec("reset role;update team_notifications set status='skipped'");await as(1);const a=await announce({audience:'registered',send_email:true,email_request_id:id(706)});
 await db.exec('reset role');await db.query("insert into team_notifications(source,event,recipient_id,entity_type,payload,announcement_id,announcement_event_id,channel) select source,event,recipient_id,entity_type,payload,announcement_id,announcement_event_id,'in_app' from team_notifications where announcement_id=$1",[a]);
 await db.exec('set role service_role');const n=(await db.query<any>('select * from team_notification_claim(3)')).rows;expect(n.length).toBe(1);expect(n[0].channel).toBe('email');expect((await db.query('select * from team_notification_claim(3)')).rows.length).toBe(0);
 await db.query("select team_notification_finish($1,$2,'retry','provider_http_503',null)",[n[0].id,n[0].lease_token]);await db.exec('reset role');expect((await db.query<any>('select active from team_announcements where id=$1',[a])).rows[0].active).toBe(true);expect((await db.query<any>('select status from team_notifications where id=$1',[n[0].id])).rows[0].status).toBe('pending');
});
test('each email audience resolves only its intended active recipients',async()=>{
 for(const [audience,extra,expected] of [
 ['registered',{},[id(2)]],['leadership',{},[id(1),id(7)]],['area',{area_id:id(101)},[id(1),id(2),id(5)]],['position',{position_key:'product_technical_manager'},[id(3)]]] as [string,Record<string,unknown>,string[]][]){
 await as(1);const a=await announce({audience,...extra,send_email:true,email_request_id:crypto.randomUUID()});await db.exec('reset role');expect((await db.query<any>('select recipient_id from team_notifications where announcement_id=$1',[a])).rows.map(n=>n.recipient_id).sort()).toEqual(expected.sort());
 }
 await as(1);await expect(announce({active:false,send_email:true,email_request_id:crypto.randomUUID()})).rejects.toThrow(/active, unexpired/);await expect(announce({expires_at:'2000-01-01',send_email:true,email_request_id:crypto.randomUUID()})).rejects.toThrow(/active, unexpired/);
 await as(2);await expect(db.query('select team_announcement_delivery_allowed($1)',[id(1)])).rejects.toThrow(/permission denied/);
});

test('active announcement with explicit null expiration emails; expired announcement is rejected',async()=>{
 await as(1);const a=await announce({title:'No expiration',expires_at:null,send_email:true,email_request_id:crypto.randomUUID()});
 await db.exec('reset role');expect((await db.query('select id from team_notifications where announcement_id=$1',[a])).rows.length).toBeGreaterThan(0);
 await as(1);const expired=await announce({title:'Expired regression',expires_at:'2000-01-01'});
 await expect(db.query('select team_announcement_send_update($1,1,$2)',[expired,crypto.randomUUID()])).rejects.toThrow(/active, unexpired/);
 await db.exec('reset role');expect((await db.query('select id from team_notifications where announcement_id=$1',[expired])).rows).toHaveLength(0);
});
test('manager may attach own existing image but not another manager image on create or edit',async()=>{
 const own=`${id(1)}/${id(901)}.png`,other=`${id(7)}/${id(902)}.webp`;
 await as(1);await db.query("insert into storage.objects(bucket_id,name) values('team-announcement-media',$1)",[own]);
 await as(7);await db.query("insert into storage.objects(bucket_id,name) values('team-announcement-media',$1)",[other]);
 await as(1);const a=await announce({title:'Own image',image_path:own});expect((await db.query<any>('select image_path from team_announcements where id=$1',[a])).rows[0].image_path).toBe(own);
 await expect(announce({image_path:other})).rejects.toThrow(/uploaded by your account/);
 await expect(announce({id:a,version:1,image_path:other})).rejects.toThrow(/uploaded by your account/);
 expect((await db.query<any>('select image_path,version from team_announcements where id=$1',[a])).rows[0]).toEqual({image_path:own,version:1});
 await expect(announce({image_path:`${id(1)}/${id(903)}.png`})).rejects.toThrow(/Upload the image/);
});
