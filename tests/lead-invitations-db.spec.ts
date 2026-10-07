import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function as(n:number){await db.exec(`reset role;select set_config('test.uid','${id(n)}',false);set role authenticated;`);}
async function manage(action:string,p:Record<string,unknown>){return db.query('select team_manage($1,$2::jsonb)',[action,JSON.stringify(p)]);}
async function member(n:number){return (await db.query<any>('select * from profiles where id=$1',[id(n)])).rows[0];}
const patch=async(n:number)=>({user_id:id(n),display_name:'Updated member',role:'lead',active:true,primary_area_id:id(101),member_status:'registered',expected_member_status:'prospective',expected_team_area:'',expected_updated_at:(await member(n)).updated_at,reason:'Team registration review'});
test.beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table profiles(id uuid primary key,display_name text,role text,active boolean,primary_area_id uuid,updated_at timestamptz default now());
 create table areas(id uuid primary key default gen_random_uuid(),name text,active boolean default true,slug text unique default gen_random_uuid()::text);insert into areas(id,name,active) values('${id(101)}','Fabrication',true);
 grant select on areas to authenticated;
 create table team_attendance_members(student_id uuid primary key,member_status text,team_area text default '');
 insert into profiles(id,display_name,role,active) values('${id(1)}','Mentor','mentor',true),('${id(2)}','Student','student',true),('${id(3)}','Lead','lead',true),('${id(4)}','Inactive','mentor',false),('${id(5)}','Read Only','readonly',true);
 insert into team_attendance_members values('${id(2)}','prospective','');
 -- Existing Inventory consumers read the same profiles/area contract.
 create schema private;
 create function private.current_role() returns text language sql stable security definer set search_path='' as $$select role from public.profiles where id=auth.uid() and active$$;
 create function private.current_area() returns uuid language sql stable security definer set search_path='' as $$select primary_area_id from public.profiles where id=auth.uid() and active$$;
 grant usage on schema private to authenticated;
 alter table profiles enable row level security;
 grant select,update on profiles to authenticated;
 create policy profiles_read on profiles for select to authenticated using(id=auth.uid() or private.current_role() is not null);
 create policy profiles_write on profiles for update to authenticated using(private.current_role() in ('mentor','admin'));
 `);
 await db.exec(readFileSync('tests/fixtures/finance_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609120003_team_management_positions.sql','utf8'));
 await db.exec(`create table auth.users(id uuid primary key,email text,created_at timestamptz default clock_timestamp(),invited_at timestamptz,last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{}');insert into auth.users(id,email) select id,display_name||'@example.test' from profiles;`);
 await db.exec(readFileSync('supabase/migrations/202609120007_team_management_v2.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609160001_notification_profile_and_role_guards.sql','utf8'));
 await db.exec('alter table auth.users add column email_confirmed_at timestamptz, add column banned_until timestamptz');
 await db.exec(readFileSync('supabase/migrations/202610010002_team_invitation_display.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261007013837_lead_student_invitations.sql','utf8'));
});
test.afterAll(()=>db.close());
const payload=(n:number,overrides:Record<string,unknown>={})=>({id:id(n),email:`new${n}@example.test`,display_name:`New student ${n}`,role:'student',reason:'Joining team',area_id:id(101),member_status:'prospective',...overrides});
const reserve=async(p:Record<string,unknown>)=>(await db.query<any>('select team_invitation_reserve($1::jsonb) r',[JSON.stringify(p)])).rows[0].r;
const context=async()=>(await db.query<any>('select team_invitation_context() c')).rows[0].c;
async function provision(p:ReturnType<typeof payload>,n:number){await db.exec('reset role');await db.query("insert into auth.users(id,email,invited_at,raw_user_meta_data) values($1,$2,clock_timestamp(),jsonb_build_object('team_invitation_id',$3::text))",[id(n),p.email,p.id]);await db.query("insert into profiles(id,display_name,role,active) values($1,'New','readonly',true)",[id(n)]);await db.exec('set role service_role');}
test('lead creates only a student through audited, quarantined and idempotent completion',async()=>{
 await as(3);const p=payload(901,{actor_id:id(1),permissions:['admin'],app_metadata:{role:'admin'},active:true});expect((await reserve(p)).send).toBe(true);expect((await reserve(p)).send).toBe(false);
 await provision(p,601);await db.exec('reset role');expect(await member(601)).toMatchObject({role:'readonly',active:false});await db.exec('set role service_role');
 await db.query('select team_invitation_finish($1,$2)',[p.id,id(601)]);await db.query('select team_invitation_finish($1,$2)',[p.id,id(601)]);await db.exec('reset role');
 expect(await member(601)).toMatchObject({role:'student',active:true,primary_area_id:id(101)});
 expect((await db.query<any>("select actor_id,role from team_private.invitations where id=$1",[p.id])).rows[0]).toEqual({actor_id:id(3),role:'student'});
 expect((await db.query<any>("select actor_id from team_private.management_history where user_id=$1 and action='member_invited'",[id(601)])).rows).toEqual([{actor_id:id(3)}]);
});
test('lead target-role tampering, missing role and invalid registrations are rejected before reservation',async()=>{
 await as(3);for(const role of ['lead','mentor','admin','readonly','bogus',null,{},['student']])await expect(reserve(payload(902,{role}))).rejects.toThrow(/students only/);
 const p=payload(902);delete (p as any).role;await expect(reserve(p)).rejects.toThrow(/students only/);await expect(reserve(payload(902,{member_status:'administrator'}))).rejects.toThrow(/Valid invitation role/);
 await db.exec('reset role');expect((await db.query('select id from team_private.invitations where id=$1',[id(902)])).rows).toHaveLength(0);
});
test('students, readonly, inactive leads and anonymous callers cannot use invitation capability',async()=>{
 for(const n of [2,5]){await as(n);await expect(reserve(payload(903))).rejects.toThrow(/Active lead/);await expect(context()).rejects.toThrow(/Active lead/);}
 await db.exec(`reset role;update profiles set active=false where id='${id(3)}'`);await as(3);await expect(reserve(payload(903))).rejects.toThrow(/Active lead/);await expect(context()).rejects.toThrow(/Active lead/);await db.exec(`reset role;update profiles set active=true where id='${id(3)}';set role anon;`);
 for(const sql of ['select team_invitation_context()',"select team_invitation_reserve('{}')",`select team_invitation_finish('${id(901)}',null)`])await expect(db.query(sql)).rejects.toThrow(/permission denied/);
});
test('lead capability does not grant management, profile writes, raw invitations or service completion',async()=>{
 await as(3);for(const sql of ['select team_management_context()','select team_management_context_v2()',"select team_manage_v2('create_area','{}')", "select team_manage('create_area','{}')"])await expect(db.query(sql)).rejects.toThrow(/mentor or admin/);
 for(const sql of ["update profiles set role='admin'",'select * from team_private.invitations',`select team_invitation_finish('${id(901)}','${id(601)}')`])await expect(db.query(sql)).rejects.toThrow(/permission denied/);
});
test('lead sees only own student invitations and sanitized own audit, never management directory',async()=>{
 await as(1);await reserve(payload(904,{role:'mentor',email:'private-manager@example.test'}));await db.exec(`reset role;insert into profiles(id,display_name,role,active) values('${id(8)}','Another Lead','lead',true)`);await as(8);await reserve(payload(905,{email:'other-lead-student@example.test'}));
 await as(3);const c=await context();expect(c.members).toEqual([]);expect(c.positions).toEqual([]);expect(c.assignments).toEqual([]);expect(c.invitations.map((i:any)=>i.id)).toEqual([id(901)]);expect(c.history.every((h:any)=>h.actor_id===id(3))).toBe(true);expect(c.history).toHaveLength(2);expect(JSON.stringify(c)).not.toMatch(/private-manager|other-lead-student|before_data|primary_area_id|Updated member/);
 await as(1);const full=(await db.query<any>('select team_management_context_v2() c')).rows[0].c;expect(full.members.length).toBeGreaterThan(3);expect(full.invitations).toHaveLength(3);
});
test('other actor replay, duplicate email, changed payload and existing-account invitations cannot send',async()=>{
 await as(3);await expect(reserve(payload(905))).rejects.toThrow(/unavailable for this account/);
 await expect(reserve(payload(901,{email:'changed@example.test'}))).rejects.toThrow(/details changed/);
 await expect(reserve(payload(906,{email:'  MENTOR@example.test '}))).rejects.toThrow(/already exists/);
 await expect(reserve(payload(906,{email:'other-lead-student@example.test'}))).rejects.toThrow(/duplicate key/);
 const p=payload(906);expect((await reserve(p)).send).toBe(true);expect((await reserve(p)).send).toBe(false);
});
test('completion rechecks current active inviter role and retains readonly quarantine after revocation',async()=>{
 await as(3);const p=payload(907);await reserve(p);await provision(p,607);await db.exec(`reset role;update profiles set active=false where id='${id(3)}';set role service_role;`);
 await expect(db.query('select team_invitation_finish($1,$2)',[p.id,id(607)])).rejects.toThrow(/no longer authorized/);await db.query('select team_invitation_finish($1,null)',[p.id]);await db.exec('reset role');expect(await member(607)).toMatchObject({role:'readonly',active:false});
 await db.exec(`update profiles set active=true,role='student' where id='${id(3)}';set role service_role`);await expect(db.query('select team_invitation_finish($1,$2)',[p.id,id(607)])).rejects.toThrow(/no longer authorized/);
 await db.exec(`reset role;update profiles set role='lead' where id='${id(3)}';set role service_role`);await db.query('select team_invitation_finish($1,$2)',[p.id,id(607)]);
});
test('manager invitation cannot complete elevated access after inviter is downgraded to lead',async()=>{
 await db.exec(`reset role;insert into profiles(id,display_name,role,active) values('${id(9)}','Temporary Mentor','mentor',true)`);await as(9);const p=payload(908,{role:'mentor'});await reserve(p);await provision(p,608);await db.exec(`reset role;update profiles set role='lead' where id='${id(9)}';set role service_role`);
 await expect(db.query('select team_invitation_finish($1,$2)',[p.id,id(608)])).rejects.toThrow(/no longer authorized/);await db.exec('reset role');expect(await member(608)).toMatchObject({role:'readonly',active:false});await as(9);await expect(reserve({...p,role:'student'})).rejects.toThrow(/unavailable for this account/);expect((await context()).invitations).toEqual([]);
});
test('own open invitations are never silently truncated after 100 newer records',async()=>{
 await db.exec('reset role');await db.exec(`insert into team_private.invitations(id,email,display_name,role,actor_id,reason) select gen_random_uuid(),'bulk'||n||'@example.test','Synthetic','student','${id(3)}','Fixture only' from generate_series(1,101) n`);await as(3);expect((await context()).invitations).toHaveLength(104);
});
