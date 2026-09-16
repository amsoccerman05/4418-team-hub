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
test('member role edits cannot demote the final active mentor or admin through either RPC',async()=>{
 for(const managerRole of ['mentor','admin']){
  await db.exec(`reset role;update profiles set role='${managerRole}' where id='${id(1)}';`);
  await as(1);const before=await member(1);const history=(await db.query<any>('select team_management_context() c')).rows[0].c.history;
  for(const role of ['student','lead','readonly'])for(const rpc of [manage,v2]){
   await expect(rpc('member',{...await patch(1),role,active:true,expected_member_status:null,expected_team_area:null})).rejects.toThrow(/at least one active admin or mentor/);
   expect(await member(1)).toEqual(before);
  }
  expect((await db.query<any>('select team_management_context() c')).rows[0].c.history).toEqual(history);
  expect((await db.query("select id from profiles where active and role in ('mentor','admin')")).rows).toHaveLength(1);
 }
 await db.exec(`reset role;update profiles set role='mentor' where id='${id(1)}';`);
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

const v2=(action:string,p:Record<string,unknown>)=>db.query('select team_manage_v2($1,$2::jsonb)',[action,JSON.stringify(p)]);
test('V2 email directory is Auth-derived and manager-only; browser cannot access raw Auth or invites',async()=>{
 await as(1);const c=(await db.query<any>('select team_management_context_v2() c')).rows[0].c;expect(c.members.find((m:any)=>m.id===id(1)).email).toBe('Mentor@example.test');
 for(const n of [2,3,4,5]){await as(n);await expect(db.query('select team_management_context_v2()')).rejects.toThrow(/mentor or admin/);await expect(db.query('select * from auth.users')).rejects.toThrow(/permission denied/);await expect(db.query('select * from team_private.invitations')).rejects.toThrow(/permission denied/);await expect(v2('position_save',{key:'new_lead',reason:'Spoof'})).rejects.toThrow(/mentor or admin/);}
});
test('V2 positions retain stable keys/history, support lifecycle, and never invent permission grants',async()=>{
 await as(1);await v2('position_save',{create:true,key:'safety_lead',name:'Safety Lead',description:'Safety coordination',category:'Other Leadership',display_order:5,reason:'New responsibility'});
 await v2('assign_position',{user_id:id(3),position_key:'safety_lead',reason:'Elected'});await as(3);expect((await db.query<any>("select finance_private.cap('finance_approver') f,finance_private.cap('po_approver') p")).rows[0]).toEqual({f:false,p:false});
 await as(1);for(const active of [false,true]){const pos=(await db.query<any>("select * from team_positions where key='safety_lead'")).rows[0];await v2('position_save',{...pos,name:'Safety Coordinator',active,reason:'Organization review'});}
 expect((await db.query<any>("select version,name from team_positions where key='safety_lead'")).rows[0]).toEqual({version:3,name:'Safety Coordinator'});expect((await db.query("select * from team_member_positions where position_key='safety_lead'")).rows).toHaveLength(1);
 await expect(v2('delete_position',{key:'lead_coach_1',reason:'Delete'})).rejects.toThrow(/Deletion/);await expect(db.exec("delete from team_positions where key='lead_coach_1'")).rejects.toThrow(/permission denied/);
 const pos=(await db.query<any>("select * from team_positions where key='lead_coach_1'")).rows[0];await v2('position_save',{...pos,name:'Head Coach',reason:'Display correction'});await v2('assign_position',{user_id:id(3),position_key:'lead_coach_1',reason:'Coach'});await as(3);expect((await db.query<any>("select finance_private.cap('po_approver') p")).rows[0].p).toBe(true);
 await as(1);await v2('assign_position',{user_id:id(3),position_key:'finance_lead',reason:'Finance responsibility'});await as(3);expect((await db.query<any>("select finance_private.cap('finance_approver') p")).rows[0].p).toBe(true);
});
test('V2 deactivation and reactivation preserve PO, revision, history and assignment identities',async()=>{
 await as(3);const po=(await db.query<any>("select finance_mutate('create',$1::jsonb) id",[JSON.stringify({area_id:id(101),sheet_url:'https://docs.google.com/document/d/TEST',vendor:'Vendor',amount:20,purpose:'History preservation'})])).rows[0].id;
 await db.query("select finance_mutate('submit',$1::jsonb)",[JSON.stringify({id:po,version:1})]);await db.exec('reset role');const before=(await db.query<any>('select to_jsonb(p) p from finance_purchase_orders p where id=$1',[po])).rows;
 const history=(await db.query<any>('select to_jsonb(h) h from finance_private.history h where po_id=$1 order by id',[po])).rows;
 await as(1);for(const active of [false,true]){const pr=await member(3);await v2('member_state',{user_id:id(3),expected_updated_at:pr.updated_at,active,reason:'Membership lifecycle'});}
 await db.exec('reset role');expect((await db.query<any>('select to_jsonb(p) p from finance_purchase_orders p where id=$1',[po])).rows).toEqual(before);expect((await db.query<any>('select to_jsonb(h) h from finance_private.history h where po_id=$1 order by id',[po])).rows).toEqual(history);expect((await db.query('select * from finance_po_revisions where po_id=$1',[po])).rows).toHaveLength(1);
 await as(1);await expect(v2('member_state',{user_id:id(1),expected_updated_at:(await member(1)).updated_at,active:false,reason:'Final manager'})).rejects.toThrow(/at least one/);
});
test('V2 areas rename/archive/reactivate without rewriting IDs, PO references or attendance labels',async()=>{
 await as(1);await v2('create_area',{name:'Test Area',slug:'test-area',reason:'Organization'});
 await db.exec("reset role;create table attendance_snapshot_for_test as select * from team_attendance_members;");await as(1);
 const old=(await db.query<any>('select * from areas where id=$1',[id(101)])).rows[0];
 for(const [name,active] of [['Manufacturing',true],['Manufacturing',false],['Manufacturing',true]] as const){const a=(await db.query<any>('select * from areas where id=$1',[id(101)])).rows[0];await v2('area_save',{id:a.id,expected_name:a.name,expected_active:a.active,name,active,reason:'Area maintenance'});}
 expect((await db.query<any>('select * from areas where id=$1',[id(101)])).rows[0]).toMatchObject({id:old.id,slug:old.slug,name:'Manufacturing',active:true});await db.exec('reset role');expect((await db.query<any>('select area_id from finance_purchase_orders')).rows[0].area_id).toBe(id(101));expect((await db.query<any>('select team_area from team_attendance_members where student_id=$1',[id(2)])).rows[0].team_area).toBe('Manufacturing');expect((await db.query<any>('select team_area from attendance_snapshot_for_test where student_id=$1',[id(2)])).rows[0].team_area).toBe('Fabrication');
 await as(1);await expect(v2('delete_area',{id:id(101),reason:'Delete'})).rejects.toThrow(/Deletion/);await expect(v2('merge_area',{id:id(101),reason:'Merge'})).rejects.toThrow(/merging/);
 const c=(await db.query<any>('select team_management_context_v2() c')).rows[0].c;expect(c.history.map((h:any)=>h.action)).toEqual(expect.arrayContaining(['area_renamed','area_archived','area_reactivated','position_created','position_updated','member_deactivated','member_reactivated']));
});
test('V2 invitation reserves once, rejects students/existing accounts, and finalizes only a new Auth invite',async()=>{
 const p={id:id(901),email:'new@example.test',display_name:'New Student',role:'student',area_id:id(101),member_status:'prospective',reason:'Join team'};
 const reserve=()=>db.query<any>('select team_invitation_reserve($1::jsonb) r',[JSON.stringify(p)]);
 await as(3);await expect(reserve()).rejects.toThrow(/mentor or admin/);await as(1);expect((await reserve()).rows[0].r.send).toBe(true);expect((await reserve()).rows[0].r.send).toBe(false);
 await expect(db.query('select team_invitation_finish($1,$2)',[p.id,id(6)])).rejects.toThrow(/permission denied/);
 await expect(db.query('select team_invitation_reserve($1::jsonb)',[JSON.stringify({...p,id:id(902),email:'Mentor@example.test'})])).rejects.toThrow(/already exists/);
 await db.exec(`reset role;insert into auth.users(id,email,invited_at,raw_user_meta_data) values('${id(6)}','new@example.test',clock_timestamp(),jsonb_build_object('team_invitation_id','${id(901)}'));insert into profiles(id,display_name,role,active) values('${id(6)}','New','readonly',true);set role service_role;`);
 await db.exec('reset role');expect((await member(6)).active).toBe(false);await db.exec('set role service_role');
 await expect(db.query('select team_invitation_finish($1,$2)',[p.id,id(1)])).rejects.toThrow(/identity mismatch/);
 await db.query('select team_invitation_finish($1,$2)',[p.id,id(6)]);await db.query('select team_invitation_finish($1,$2)',[p.id,id(6)]);
 await as(1);expect(await member(6)).toMatchObject({id:id(6),role:'student',active:true,display_name:'New Student',primary_area_id:id(101)});const c=(await db.query<any>('select team_management_context_v2() c')).rows[0].c;expect(c.invitations[0].status).toBe('pending');expect(c.history.filter((h:any)=>h.action==='member_invited')).toHaveLength(1);
});
test('invitation failure stays quarantined; service reconciliation rechecks authority and is audited',async()=>{
 await as(1);const invitation=id(903),user=id(7);await db.query('select team_invitation_reserve($1::jsonb)',[JSON.stringify({id:invitation,email:'new-admin@example.test',display_name:'New Admin',role:'admin',reason:'Approved manager'})]);
 await db.exec(`reset role;insert into auth.users(id,email,invited_at,raw_user_meta_data) values('${user}','new-admin@example.test',clock_timestamp(),jsonb_build_object('team_invitation_id','${invitation}'));insert into profiles(id,display_name,role,active) values('${user}','New','readonly',true);update profiles set active=true where id='${id(4)}';update profiles set active=false where id='${id(1)}';set role service_role;`);
 await expect(db.query('select team_invitation_finish($1,$2)',[invitation,user])).rejects.toThrow(/no longer authorized/);await db.query('select team_invitation_finish($1,null)',[invitation]);await db.exec('reset role');expect(await member(7)).toMatchObject({active:false,role:'readonly'});await db.exec(`update profiles set active=true where id='${id(1)}';set role service_role;`);await db.query('select team_invitation_finish($1,$2)',[invitation,user]);await as(7);expect((await member(7)).role).toBe('admin');const r=(await db.query<any>('select team_invitation_reserve($1::jsonb) r',[JSON.stringify({id:id(904),email:'admin-invited@example.test',display_name:'Student',role:'student',reason:'Admin invitation'})])).rows[0].r;expect(r.send).toBe(true);
});

for(const scenario of ['matching','status conflict','area conflict','no requested registration'])test(`invitation registration reconciliation: ${scenario}`,async()=>{
 const n=10+['matching','status conflict','area conflict','no requested registration'].indexOf(scenario),invitation=id(910+n),user=id(n),email=`reconcile-${n}@example.test`;
 await as(1);await db.query('select team_invitation_reserve($1::jsonb)',[JSON.stringify({id:invitation,email,display_name:'Reconciled Student',role:'student',area_id:id(101),member_status:scenario==='no requested registration'?null:'prospective',reason:'Reconcile interrupted invitation'})]);
 await db.exec('reset role');
 await db.query("insert into auth.users(id,email,invited_at,raw_user_meta_data) values($1,$2,clock_timestamp(),jsonb_build_object('team_invitation_id',$3::text))",[user,email,invitation]);
 await db.query("insert into profiles(id,display_name,role,active) values($1,'New','readonly',true)",[user]);
 await db.query('insert into team_attendance_members values($1,$2,$3)',[user,scenario==='status conflict'?'registered':'prospective',scenario==='area conflict'?'Other area':'Manufacturing']);
 const before=(await db.query('select * from team_attendance_members where student_id=$1',[user])).rows;
 const profile=await member(n);
 await db.exec('set role service_role');await db.query('select team_invitation_finish($1,null)',[invitation]);
 const finish=()=>db.query('select team_invitation_finish($1,$2)',[invitation,user]);
 if(scenario.endsWith('conflict')){
  await expect(finish()).rejects.toThrow(/Existing registration differs/);
  await expect(finish()).rejects.toThrow(/Existing registration differs/);
 }else{await finish();await finish();}
 await db.exec('reset role');
 expect((await db.query('select * from team_attendance_members where student_id=$1',[user])).rows).toEqual(before);
 const conflict=scenario.endsWith('conflict');
 if(conflict)expect(await member(n)).toEqual(profile);else expect(await member(n)).toMatchObject({active:true,role:'student'});
 expect((await db.query<any>('select status from team_private.invitations where id=$1',[invitation])).rows[0].status).toBe(conflict?'review':'pending');
 expect((await db.query("select id from team_private.management_history where user_id=$1 and action='member_invited'",[user])).rows).toHaveLength(conflict?0:1);
});

test('mentor role edits protect self, allow another mentor, and reject student roles',async()=>{
 await db.exec(`reset role;insert into profiles(id,display_name,role,active) values('${id(80)}','Other mentor','mentor',true),('${id(81)}','Target','student',true);`);
 await as(80);const payload={...await patch(81),primary_area_id:null,member_status:null,expected_member_status:null,expected_team_area:null};
 await manage('member',{...payload,role:'mentor'});expect((await member(81)).role).toBe('mentor');
 await expect(manage('member',{...payload,user_id:id(80),expected_updated_at:(await member(80)).updated_at,role:'student'})).rejects.toThrow(/another mentor/);
 await expect(manage('member',{...payload,expected_updated_at:(await member(81)).updated_at,role:'admin'})).rejects.toThrow(/legacy role/);
 for(const role of ['student','lead','readonly']){
  await db.exec(`reset role;update profiles set role='${role}' where id='${id(81)}';`);await as(81);
  await expect(manage('member',{...payload,role:'mentor'})).rejects.toThrow(/mentor or admin/);
 }
 await as(80);await manage('member',{...payload,expected_updated_at:(await member(81)).updated_at,role:'mentor'});
 await as(81);await manage('member',{...payload,user_id:id(80),expected_updated_at:(await member(80)).updated_at,role:'student'});expect((await member(80)).role).toBe('student');
});
test('worker can read only its required profile columns',async()=>{
 await db.exec('reset role;set role service_role;');
 await expect(db.query('select id,active,role from profiles')).resolves.toBeDefined();
 await expect(db.query('select display_name from profiles')).rejects.toThrow(/permission denied/);
 await db.exec('reset role;');
});
