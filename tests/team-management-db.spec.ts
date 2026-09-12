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
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table profiles(id uuid primary key,display_name text,role text,active boolean,primary_area_id uuid,updated_at timestamptz default now());
 create table areas(id uuid primary key default gen_random_uuid(),name text,active boolean default true,slug text unique default gen_random_uuid()::text);insert into areas(id,name,active) values('${id(101)}','Fabrication',true);
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
});
test.afterAll(()=>db.close());
test('only active mentors/admins manage membership, with server actor and history',async()=>{
 for(const n of [2,3,4,5]){await as(n);await expect(db.query('select team_management_context()')).rejects.toThrow(/mentor or admin/);await expect(manage('assign_position',{user_id:id(2),position_key:'finance_lead',reason:'Spoof'})).rejects.toThrow(/mentor or admin/);}
 await as(1);await manage('member',await patch(2));const p=await member(2);expect(p.display_name).toBe('Updated member');expect(p.role).toBe('lead');
 const c=(await db.query<any>('select team_management_context() c')).rows[0].c;expect(c.history[0].actor_id).toBe(id(1));expect(c.members.find((m:any)=>m.id===id(2)).member_status).toBe('registered');
 await as(2);expect((await db.query<any>('select private.current_role() role,private.current_area() area')).rows[0]).toEqual({role:'lead',area:id(101)});
});
test('direct profile writes are revoked, last administrator and stale edits are protected',async()=>{
 await as(1);await expect(db.exec("update profiles set role='admin'")).rejects.toThrow(/permission denied/);
 await expect(manage('member',{...await patch(1),role:'student',expected_member_status:null,expected_team_area:null})).rejects.toThrow(/at least one/);
 await expect(manage('member',{...await patch(2),expected_updated_at:'2000-01-01'})).rejects.toThrow(/Member changed/);
 await expect(manage('member',await patch(2))).rejects.toThrow(/Registration changed/);
});
test('positions preserve add/remove history and active membership gates helper results',async()=>{
 await as(1);await manage('assign_position',{user_id:id(2),position_key:'finance_lead',reason:'Elected'});await manage('assign_position',{user_id:id(2),position_key:'lead_coach_2',reason:'Additional position'});
 await as(2);expect((await db.query<any>('select team_my_positions() p')).rows[0].p).toEqual(['finance_lead','lead_coach_2']);
 await expect(db.exec('delete from team_member_positions')).rejects.toThrow(/permission denied/);
 await expect(db.exec('select * from team_private.management_history')).rejects.toThrow(/permission denied/);
 await as(1);const c=(await db.query<any>('select team_management_context() c')).rows[0].c;const a=c.assignments.find((a:any)=>a.position_key==='finance_lead');await manage('revoke_position',{user_id:id(2),assignment_id:a.id,reason:'Term ended'});
 await as(2);expect((await db.query<any>("select team_has_position('finance_lead') p")).rows[0].p).toBe(false);
 await as(1);const next={...await patch(2),active:false,expected_member_status:'registered',expected_team_area:'Fabrication'};await manage('member',next);
 await as(2);expect((await db.query<any>('select team_my_positions() p')).rows[0].p).toEqual([]);
 await as(1);expect((await db.query('select * from team_member_positions')).rows).toHaveLength(2);
});
test('anonymous clients cannot invoke shared team administration',async()=>{
 await db.exec('reset role;set role anon');await expect(db.query('select team_management_context()')).rejects.toThrow(/permission denied/);await expect(db.query('select team_my_positions()')).rejects.toThrow(/permission denied/);
});

test('team area creation is audited and mentor-only, preserving existing IDs',async()=>{
 await as(3);await expect(manage('create_area',{name:'Operations',slug:'operations',reason:'Team area'})).rejects.toThrow(/mentor or admin/);
 await as(1);await manage('create_area',{name:'Operations',slug:'operations',reason:'Team area'});
 const c=(await db.query<any>('select team_management_context() c')).rows[0].c;expect(c.areas.find((a:any)=>a.name==='Fabrication').id).toBe(id(101));expect(c.areas.some((a:any)=>a.name==='Operations')).toBe(true);expect(c.history[0].action).toBe('create_area');
 await expect(manage('create_area',{name:'Operations duplicate',slug:'operations',reason:'Duplicate'})).rejects.toThrow(/unique/);
});
