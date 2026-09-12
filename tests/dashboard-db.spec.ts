import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);}
async function dashboard(){return (await db.query<any>('select team_dashboard_context() c')).rows[0].c;}
async function announce(p:Record<string,unknown>){return (await db.query<any>('select team_announcement_save($1::jsonb) id',[JSON.stringify({title:'Team update',body:'Welcome',severity:'normal',...p})])).rows[0].id;}
test.beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
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
