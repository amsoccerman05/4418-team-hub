import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
test('invitation projection matches authoritative identities without writes or resends',async()=>{
 const db=new PGlite();const uid=(n:number)=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
 try{
 await db.exec(`create schema auth;create schema team_private;create table public.profiles(id uuid primary key,active boolean);create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,created_at timestamptz,invited_at timestamptz,last_sign_in_at timestamptz,email_confirmed_at timestamptz,banned_until timestamptz);create table team_private.invitations(id uuid primary key,email text,display_name text,user_id uuid,status text,created_at timestamptz);create function team_private.admin() returns boolean language sql as $$select current_setting('test.manager',true)='yes'$$;create function public.team_management_context() returns jsonb language sql as $$select '{"members":[]}'::jsonb$$;select set_config('test.manager','yes',false);`);
 for(let n=1;n<=6;n++){
 await db.query("insert into team_private.invitations values($1,$2,'Member',$3,$4,now()-interval '1 day')",[uid(n),'member'+n+'@example.test',n===1||n===4||n===5||n===6?uid(n+10):null,n===1||n>=4?'pending':'review']);
 await db.query('insert into profiles values($1,$2)',[uid(n+10),n!==5]);
 await db.query("insert into auth.users values($1,$2,$3,now(),$4,$5,$5,$6)",[uid(n+10),'member'+n+'@example.test',JSON.stringify({team_invitation_id:n===3?uid(999):uid(n)}),new Date().toISOString(),n===1?null:new Date().toISOString(),n===6?new Date(Date.now()+86400000).toISOString():null]);
 }
 const snapshot=async()=>JSON.stringify((await db.query("select (select jsonb_agg(i) from team_private.invitations i) invitations,(select jsonb_agg(u) from auth.users u) users,(select jsonb_agg(p) from profiles p) profiles")).rows);
 const before=await snapshot();await db.exec(readFileSync('supabase/migrations/202610010002_team_invitation_display.sql','utf8'));
 const rows=(await db.query('select team_management_context_v2() c')).rows[0].c.invitations;
 expect(rows.find((i:any)=>i.id===uid(1)).status).toBe('pending');expect(rows.find((i:any)=>i.id===uid(2)).status).toBe('account_active');expect(rows.find((i:any)=>i.id===uid(3))).toMatchObject({status:'review',review_reason:'identity_unmatched'});expect(rows.find((i:any)=>i.id===uid(4)).status).toBe('account_active');for(const n of [5,6])expect(rows.find((i:any)=>i.id===uid(n)).status).toBe('review');
 await db.query('select team_management_context_v2()');expect(await snapshot()).toBe(before);await db.exec("select set_config('test.manager','no',false)");await expect(db.query('select team_management_context_v2()')).rejects.toThrow(/Active mentor/);
 }finally{await db.close();}
});
