import {test,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;let mid:string;
const uid=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const as=async(n:number)=>db.exec(`reset role;select set_config('test.uid','${uid(n)}',false);set role authenticated;`);
const checkout=()=>db.query('select team_attendance_check_out($1)',[mid]);
const row=async()=>{await db.exec('reset role');return (await db.query<any>('select * from team_attendance where meeting_id=$1 and student_id=$2',[mid,uid(2)])).rows[0];};
test.beforeEach(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;create table profiles(id uuid primary key,display_name text,role text,active boolean);insert into profiles values('${uid(1)}','Manager','mentor',true),('${uid(2)}','Student','student',true),('${uid(3)}','Other','student',true),('${uid(4)}','Inactive','student',false);select set_config('test.uid','${uid(1)}',false);`);
 await db.exec(readFileSync('supabase/migrations/202609100001_team_attendance.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202609130001_attendance_checkout.sql','utf8'));
 mid=(await db.query<any>(`select team_attendance_manage('create',jsonb_build_object('title','Checkout','meeting_type','other','starts_at',now()-interval '30 minutes','ends_at',now()+interval '30 minutes','requirement','registered')) r`)).rows[0].r.id;
 await db.query(`update team_attendance set checked_in_at=now()-interval '20 minutes',physical_status='present',review_status='pending',notice_reason='Keep request' where meeting_id=$1 and student_id=$2`,[mid,uid(2)]);
});
test.afterEach(()=>db.close());
test('server checkout is audited, idempotent and preserves request/arrival; leadership corrections stay audited',async()=>{
 const before=await row();await as(2);await checkout();const after=await row();expect(after.left_at).not.toBeNull();expect(after.physical_status).toBe('left_early');expect(after.checked_in_at).toEqual(before.checked_in_at);expect(after.notice_reason).toBe('Keep request');expect(after.review_status).toBe('pending');expect(after.version).toBe(before.version+1);
 const audit=(await db.query<any>("select * from team_attendance_history where entity_id=$1 and after_data->>'left_at' is not null",[after.id])).rows;expect(audit).toHaveLength(1);expect(audit[0].performed_by).toBe(uid(2));expect(audit[0].before_data.left_at).toBeNull();
 await as(2);await checkout();expect(await row()).toEqual(after);
 await as(1);await db.query("select team_attendance_manage('attendance',$1::jsonb)",[JSON.stringify({meeting_id:mid,attendance_id:after.id,version:after.version,physical_status:'left_early',left_at:after.left_at,explanation:'Verified departure'})]);
 await db.exec('reset role');expect((await db.query<any>("select * from team_attendance_history where entity_id=$1 and performed_by=$2 and action='UPDATE'",[after.id,uid(1)])).rows.length).toBeGreaterThan(0);
});
test('rejects anonymous, managers, inactive students and missing check-ins without updates',async()=>{
 const before=await row();await db.exec('set role anon');await expect(checkout()).rejects.toThrow(/permission denied/);
 for(const n of [1,4]){await as(n);await expect(checkout()).rejects.toThrow(/Student access required/);}
 await as(3);await expect(checkout()).rejects.toThrow(/Check in before/);expect(await row()).toEqual(before);
});
test('rejects ended/finalized meetings and never invents a departure',async()=>{
 await db.query('update team_attendance set left_at=null where meeting_id=$1',[mid]);await db.query("update team_meetings set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",[mid]);await as(2);await expect(checkout()).rejects.toThrow(/during the meeting/);expect((await row()).left_at).toBeNull();
 await db.query("update team_meetings set ends_at=now()+interval '1 hour',status='finalized' where id=$1",[mid]);await as(2);await expect(checkout()).rejects.toThrow(/during the meeting/);expect((await row()).left_at).toBeNull();
});
test('audit failure rolls back checkout atomically',async()=>{
 const before=await row();await db.exec(`create function fail_checkout_audit() returns trigger language plpgsql as $$begin if new.after_data->>'left_at' is not null then raise exception 'Audit unavailable';end if;return new;end $$;create trigger fail_checkout_audit before insert on team_attendance_private.history for each row execute function fail_checkout_audit();`);
 await as(2);await expect(checkout()).rejects.toThrow(/Audit unavailable/);expect(await row()).toEqual(before);
});
