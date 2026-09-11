-- MANUAL ONLY: run in the existing shared Supabase project after reviewing.
-- Reads the existing profiles contract. Never alters profiles or other app tables.
begin;
do $$ begin
 perform id,display_name,role,active from public.profiles limit 1;
end $$;
create schema team_attendance_private;
revoke all on schema team_attendance_private from public;
grant usage on schema team_attendance_private to authenticated;
create function team_attendance_private.role() returns text language sql stable security definer set search_path='' as $$
 select role::text from public.profiles where id=auth.uid() and active
$$;
create function team_attendance_private.manager() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(team_attendance_private.role() in ('lead','admin','mentor'),false)
$$;
-- Attendance-only registration/area metadata; avoids changing shared profiles.
create table public.team_attendance_members (
 student_id uuid primary key references public.profiles(id),
 member_status text not null default 'prospective' check(member_status in ('prospective','registered','inactive')),
 team_area text not null default '' check(length(team_area)<=100)
);
create table public.team_meetings (
 id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 150),
 meeting_type text not null check(meeting_type in ('offseason','preseason','other')),
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 late_minutes integer not null default 10 check(late_minutes between 0 and 120),
 requirement text not null check(requirement in ('registered','areas','selected','optional')),
 areas text[] not null default '{}', selected_students uuid[] not null default '{}',
 status text not null default 'draft' check(status in ('draft','open','closed','finalized')),
 check_in_open boolean not null default false, code_hash bytea, code_expires_at timestamptz,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 version integer not null default 1
);
create table public.team_meeting_members (
 meeting_id uuid not null references public.team_meetings(id), student_id uuid not null references public.profiles(id),
 required boolean not null, member_status text not null, team_area text not null,
 attempts integer not null default 0, attempt_window timestamptz,
 primary key(meeting_id,student_id)
);
create table public.team_attendance (
 id uuid primary key default gen_random_uuid(), meeting_id uuid not null, student_id uuid not null,
 physical_status text not null default 'pending' check(physical_status in ('pending','present','late','left_early','absent')),
 review_status text not null default 'none' check(review_status in ('none','pending','excused','denied','not_required')),
 checked_in_at timestamptz, left_at timestamptz,
 notice_at timestamptz, notice_reason text not null default '' check(length(notice_reason)<=2000),
 review_reason text not null default '' check(length(review_reason)<=2000), reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
 version integer not null default 1,
 unique(meeting_id,student_id), foreign key(meeting_id,student_id) references public.team_meeting_members(meeting_id,student_id)
);
create table public.team_attendance_strikes (
 id uuid primary key default gen_random_uuid(), attendance_id uuid not null references public.team_attendance(id),
 student_id uuid not null references public.profiles(id), meeting_id uuid not null references public.team_meetings(id),
 category text not null check(category in ('Unexcused Absence','Late Arrival','Early Departure','Insufficient Notice','Other')),
 quantity integer not null check(quantity between 1 and 10), explanation text not null check(length(trim(explanation)) between 1 and 2000),
 assigned_by uuid not null references public.profiles(id), assigned_at timestamptz not null default now(),
 rescinded_by uuid references public.profiles(id), rescinded_at timestamptz, rescind_reason text,
 check ((rescinded_at is null and rescinded_by is null and rescind_reason is null) or
 (rescinded_at is not null and rescinded_by is not null and length(trim(rescind_reason)) between 1 and 2000))
);
-- Raw audit payloads are private; the public read facade below redacts student history.
create table team_attendance_private.history (
 id bigint generated always as identity primary key, meeting_id uuid, student_id uuid,
 entity text not null, entity_id text not null, action text not null,
 before_data jsonb, after_data jsonb, performed_by uuid references public.profiles(id), performed_at timestamptz not null default now(),
 actor_auth_uid uuid, actor_database_session text not null, actor_database_role text not null
);
create index team_attendance_student on public.team_attendance(student_id);
create index team_meeting_members_student on public.team_meeting_members(student_id);
create index team_strikes_student on public.team_attendance_strikes(student_id);
create index team_history_student on team_attendance_private.history(student_id,performed_at desc);
create index team_history_meeting on team_attendance_private.history(meeting_id,performed_at desc);
-- Central attribution covers both audit triggers and explicit snapshot inserts.
-- Do not invent a profile actor for SQL Editor/service operations. Preserve the
-- claimed Auth subject separately when it has no corresponding shared profile.
create function team_attendance_private.history_actor() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); db_role text:=coalesce(nullif(current_setting('role',true),'none'),session_user::text);
begin
 if db_role in ('authenticated','anon') and
    (actor is null or not exists(select 1 from public.profiles where id=actor)) then
   raise exception 'Authenticated audit writes require a valid profile actor' using errcode='42501';
 end if;
 -- Always overwrite supplied attribution; never accept an actor from RPC input.
 new.actor_auth_uid:=actor;
 new.performed_by:=case when exists(select 1 from public.profiles where id=actor) then actor else null end;
 new.actor_database_session:=session_user::text;
 new.actor_database_role:=db_role;
 return new;
end $$;
create trigger team_history_actor before insert on team_attendance_private.history
 for each row execute function team_attendance_private.history_actor();
alter table team_attendance_private.history enable row level security;
revoke all on team_attendance_private.history from public,anon,authenticated;

-- Strict allowlist: future audit fields remain private unless explicitly added.
-- This pure helper exposes no stored data and does not run with elevated rights.
create function team_attendance_private.student_history_payload(entity text,payload jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select case when payload is null then null else coalesce((
   select jsonb_object_agg(key,value) from jsonb_each(payload)
   where key=any(case entity
     when 'team_attendance' then array['physical_status','review_status','checked_in_at','left_at','notice_at']
     when 'team_attendance_strikes' then array['category','quantity','assigned_at','rescinded_at']
     else array[]::text[] end)
 ),'{}'::jsonb) end
$$;
-- Intentionally owner-executed view: private storage has no client SELECT grant.
-- The explicit role/ownership predicate and CASE projections are the access
-- boundary. security_barrier prevents caller predicates reaching hidden rows.
create view public.team_attendance_history with (security_barrier=true) as
 select id,meeting_id,student_id,entity,entity_id,action,
 case when team_attendance_private.manager() then before_data
      else team_attendance_private.student_history_payload(entity,before_data) end as before_data,
 case when team_attendance_private.manager() then after_data
      else team_attendance_private.student_history_payload(entity,after_data) end as after_data,
 performed_by,performed_at,
 case when team_attendance_private.manager() then actor_auth_uid end as actor_auth_uid,
 case when team_attendance_private.manager() then actor_database_session end as actor_database_session,
 case when team_attendance_private.manager() then actor_database_role end as actor_database_role
 from team_attendance_private.history
 where team_attendance_private.manager() or
 (team_attendance_private.role()='student' and student_id=auth.uid()
  and entity in ('team_attendance','team_attendance_strikes'))
 order by id;
revoke all on public.team_attendance_history from public,anon,authenticated;
grant select on public.team_attendance_history to authenticated;

create function team_attendance_private.audit() returns trigger language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; r jsonb;
begin
 if TG_OP<>'INSERT' then b:=to_jsonb(old)-'code_hash'-'code_expires_at'; end if;
 if TG_OP<>'DELETE' then a:=to_jsonb(new)-'code_hash'-'code_expires_at'; end if;
 r:=coalesce(a,b);
 insert into team_attendance_private.history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
 values(case when TG_TABLE_NAME='team_meetings' then (r->>'id')::uuid else (r->>'meeting_id')::uuid end,
 (r->>'student_id')::uuid,TG_TABLE_NAME,coalesce(r->>'id',r->>'student_id'),TG_OP,b,a,auth.uid());
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['team_attendance_members','team_meetings','team_attendance','team_attendance_strikes'] loop
 execute format('create trigger team_audit after insert or update on public.%I for each row execute function team_attendance_private.audit()',t);
 end loop;
 foreach t in array array['team_attendance_members','team_meetings','team_meeting_members','team_attendance','team_attendance_strikes'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 if t<>'team_meetings' then execute format('grant select on public.%I to authenticated',t); end if;
 end loop;
end $$;
-- Codes/hashes are NEVER selectable, even by leadership. Open/rotate returns a temporary code once.
grant select(id,title,meeting_type,starts_at,ends_at,late_minutes,requirement,status,check_in_open,code_expires_at,created_by,created_at,version) on public.team_meetings to authenticated;
create policy attendance_member_read on public.team_attendance_members for select to authenticated using
 (team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));
create policy attendance_snapshot_read on public.team_meeting_members for select to authenticated using
 (team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));
create policy attendance_meeting_read on public.team_meetings for select to authenticated using
 (team_attendance_private.manager() or (team_attendance_private.role()='student' and exists(select 1 from public.team_meeting_members mm where mm.meeting_id=id and mm.student_id=auth.uid())));
create policy attendance_read on public.team_attendance for select to authenticated using
 (team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));
create policy attendance_strike_read on public.team_attendance_strikes for select to authenticated using
 (team_attendance_private.manager() or (student_id=auth.uid() and team_attendance_private.role()='student'));


create function public.team_attendance_roster() returns table(student_id uuid,display_name text,member_status text,team_area text)
language plpgsql security definer set search_path='' as $$
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501'; end if;
 return query select p.id,p.display_name::text,coalesce(m.member_status,'prospective'),coalesce(m.team_area,'')
 from public.profiles p left join public.team_attendance_members m on m.student_id=p.id
 where p.active and p.role::text in ('student','lead') order by p.display_name;
end $$;

create function public.team_attendance_manage(action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; a public.team_attendance; s public.team_attendance_strikes;
 mid uuid; code text; target text; uid uuid; result jsonb;
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501'; end if;
 -- Serializes leadership mutations, including roster snapshots.
 perform pg_advisory_xact_lock(4418,10);
 if action='member' then
 uid:=(p->>'student_id')::uuid;
 if not exists(select 1 from public.profiles where id=uid and active and role::text in ('student','lead')) then raise exception 'Active student or lead required'; end if;
 insert into public.team_attendance_members(student_id,member_status,team_area) values(uid,p->>'member_status',trim(coalesce(p->>'team_area','')))
 on conflict(student_id) do update set member_status=excluded.member_status,team_area=excluded.team_area;
 return '{}'::jsonb;
 elsif action='create' then
 if p->>'requirement'='areas' and jsonb_array_length(coalesce(p->'areas','[]'))=0 then raise exception 'Select at least one area'; end if;
 if p->>'requirement'='selected' and jsonb_array_length(coalesce(p->'selected_students','[]'))=0 then raise exception 'Select at least one student'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p->'selected_students','[]')) v where not exists(
 select 1 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where pr.id=v::uuid and pr.active and pr.role::text in ('student','lead') and coalesce(mem.member_status,'prospective')<>'inactive')) then raise exception 'Selected student is unavailable'; end if;
 insert into public.team_meetings(title,meeting_type,starts_at,ends_at,late_minutes,requirement,areas,selected_students,created_by)
 values(trim(p->>'title'),p->>'meeting_type',(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,
 coalesce((p->>'late_minutes')::integer,10),p->>'requirement',array(select jsonb_array_elements_text(coalesce(p->'areas','[]'))),
 array(select jsonb_array_elements_text(coalesce(p->'selected_students','[]'))::uuid),auth.uid()) returning * into m;
 insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
 select m.id,pr.id,case m.requirement when 'registered' then coalesce(mem.member_status,'prospective')='registered'
 when 'areas' then coalesce(mem.member_status,'prospective')='registered' and coalesce(mem.team_area,'')=any(m.areas)
 when 'selected' then pr.id=any(m.selected_students) else false end,coalesce(mem.member_status,'prospective'),coalesce(mem.team_area,'')
 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where pr.active and pr.role::text in ('student','lead') and coalesce(mem.member_status,'prospective')<>'inactive';
 insert into public.team_attendance(meeting_id,student_id,review_status) select meeting_id,student_id,case when required then 'none' else 'not_required' end from public.team_meeting_members where meeting_id=m.id;
 -- Audit the immutable required roster as part of meeting creation.
 insert into team_attendance_private.history(meeting_id,entity,entity_id,action,after_data,performed_by)
 select m.id,'team_meeting_members',m.id::text,'SNAPSHOT',coalesce(jsonb_agg(to_jsonb(mm)-'attempts'-'attempt_window'),'[]'),auth.uid() from public.team_meeting_members mm where mm.meeting_id=m.id;
 return jsonb_build_object('id',m.id);
 end if;
 mid:=(p->>'meeting_id')::uuid;
 select * into m from public.team_meetings where id=mid for update;
 if not found then raise exception 'Meeting not found'; end if;
 if action in ('open','close','finalize') then
 if m.version is distinct from (p->>'version')::integer then raise exception 'Meeting changed. Refresh and try again.'; end if;
 if m.status='finalized' then raise exception 'Meeting is finalized'; end if;
 if action='open' then
 if now()<m.starts_at-interval '30 minutes' or now()>=m.ends_at then raise exception 'Check-in opens from 30 minutes before start until the scheduled end'; end if;
 loop
 code:=lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%1000000)::text,6,'0');
 exit when sha256(convert_to(m.id::text||code,'UTF8')) is distinct from m.code_hash;
 end loop;
 update public.team_meetings set status='open',check_in_open=true,code_hash=sha256(convert_to(id::text||code,'UTF8')),
 code_expires_at=least(now()+interval '30 minutes',ends_at),version=version+1 where id=mid;
 return jsonb_build_object('code',code,'expires_at',least(now()+interval '30 minutes',m.ends_at));
 elsif action='close' then
 if m.status not in ('draft','open') then raise exception 'Only a draft or open meeting can be closed'; end if;
 update public.team_meetings set status='closed',check_in_open=false,code_hash=null,code_expires_at=null,version=version+1 where id=mid;
 else
 if m.status<>'closed' or now()<m.ends_at then raise exception 'Close check-in and wait until the scheduled end before finalizing'; end if;
 update public.team_attendance att set physical_status='absent',version=att.version+1 from public.team_meeting_members mm
 where att.meeting_id=mid and mm.meeting_id=att.meeting_id and mm.student_id=att.student_id and mm.required and att.physical_status='pending';
 update public.team_meetings set status='finalized',check_in_open=false,code_hash=null,code_expires_at=null,version=version+1 where id=mid;
 end if;
 return '{}'::jsonb;
 end if;
 select * into a from public.team_attendance where id=(p->>'attendance_id')::uuid and meeting_id=mid for update;
 if not found then raise exception 'Attendance record not found'; end if;
 if action='attendance' then
 if a.version is distinct from (p->>'version')::integer then raise exception 'Attendance changed. Refresh and try again.'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'A correction/review explanation is required'; end if;
 target:=coalesce(p->>'physical_status',a.physical_status);
 if m.status='finalized' and target='pending' then raise exception 'Finalized attendance cannot be pending'; end if;
 if target='left_early' and (nullif(p->>'left_at','') is null or (p->>'left_at')::timestamptz>=m.ends_at or (p->>'left_at')::timestamptz<m.starts_at) then raise exception 'Departure must be during the meeting, before its end'; end if;
 update public.team_attendance set physical_status=target,review_status=coalesce(p->>'review_status',review_status),
 left_at=case when target='left_early' then (p->>'left_at')::timestamptz else null end,
 review_reason=trim(p->>'explanation'),reviewed_by=auth.uid(),reviewed_at=now(),version=version+1 where id=a.id;
 elsif action='strike' then
 insert into public.team_attendance_strikes(attendance_id,student_id,meeting_id,category,quantity,explanation,assigned_by)
 values(a.id,a.student_id,a.meeting_id,p->>'category',(p->>'quantity')::integer,trim(p->>'explanation'),auth.uid());
 elsif action='rescind' then
 select * into s from public.team_attendance_strikes where id=(p->>'strike_id')::uuid and attendance_id=a.id for update;
 if not found or s.rescinded_at is not null then raise exception 'Active strike not found'; end if;
 if length(trim(coalesce(p->>'explanation','')))=0 then raise exception 'Rescind reason is required'; end if;
 update public.team_attendance_strikes set rescinded_by=auth.uid(),rescinded_at=now(),rescind_reason=trim(p->>'explanation') where id=s.id;
 else raise exception 'Unknown attendance action'; end if;
 return '{}'::jsonb;
end $$;

create function public.team_attendance_check_in(meeting_id uuid,code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; mm public.team_meeting_members; a public.team_attendance; t timestamptz:=clock_timestamp();
begin
 if coalesce(team_attendance_private.role(),'') not in ('student','lead') then raise exception 'Student access required' using errcode='42501'; end if;
 select * into m from public.team_meetings where id=meeting_id for update;
 if not found or not m.check_in_open or m.status<>'open' or t>=m.code_expires_at or t>=m.ends_at then raise exception 'Check-in is closed or the code expired'; end if;
 select * into mm from public.team_meeting_members x where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster. Contact leadership.'; end if;
 select * into a from public.team_attendance x where x.meeting_id=m.id and student_id=auth.uid() for update;
 if a.checked_in_at is not null or a.physical_status<>'pending' then return jsonb_build_object('message','Attendance already recorded'); end if;
 if mm.attempt_window is null or t>=mm.attempt_window+interval '15 minutes' then
 mm.attempts:=0;
 update public.team_meeting_members x set attempts=0,attempt_window=t where x.meeting_id=m.id and student_id=auth.uid();
 end if;
 if mm.attempts>=5 then return jsonb_build_object('error','Too many attempts. Try again in 15 minutes or contact leadership.'); end if;
 update public.team_meeting_members x set attempts=attempts+1 where x.meeting_id=m.id and student_id=auth.uid();
 if code is null or code !~ '^[0-9]{6}$' or sha256(convert_to(m.id::text||code,'UTF8')) is distinct from m.code_hash then
 return jsonb_build_object('error','Invalid meeting code'); end if;
 update public.team_attendance set physical_status=case when t>m.starts_at+make_interval(mins=>m.late_minutes) then 'late' else 'present' end,
 checked_in_at=t,version=version+1 where id=a.id;
 return jsonb_build_object('message','Checked in');
end $$;
create function public.team_attendance_notice(meeting_id uuid,reason text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; a public.team_attendance;
begin
 if coalesce(team_attendance_private.role(),'') not in ('student','lead') then raise exception 'Student access required' using errcode='42501'; end if;
 if length(trim(coalesce(reason,''))) not between 1 and 2000 then raise exception 'Provide a notice reason (up to 2000 characters)'; end if;
 select * into m from public.team_meetings where id=meeting_id for update;
 if not found or m.status='finalized' then raise exception 'Contact leadership to review a finalized meeting'; end if;
 select * into a from public.team_attendance x where x.meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster'; end if;
 if a.notice_at is not null then raise exception 'Notice already submitted. Contact leadership for corrections.'; end if;
 update public.team_attendance set notice_at=clock_timestamp(),notice_reason=trim(reason),review_status='pending',version=version+1 where id=a.id;
end $$;
revoke all on all functions in schema team_attendance_private from public,anon,authenticated;
grant execute on function team_attendance_private.role(),team_attendance_private.manager(),team_attendance_private.student_history_payload(text,jsonb) to authenticated;
revoke all on function public.team_attendance_roster(),public.team_attendance_manage(text,jsonb),public.team_attendance_check_in(uuid,text),public.team_attendance_notice(uuid,text) from public,anon,authenticated;
grant execute on function public.team_attendance_roster(),public.team_attendance_manage(text,jsonb),public.team_attendance_check_in(uuid,text),public.team_attendance_notice(uuid,text) to authenticated;
commit;
