-- MANUAL ONLY. Apply after team_attendance migration; no shared app/profile changes.
begin;
alter table public.team_attendance
 add column notice_type text check(notice_type in ('absent','late','early')),
 add column expected_at timestamptz,
 add constraint team_notice_expected check (case when notice_type is null or notice_type='absent' then expected_at is null else expected_at is not null end);
-- One transaction, existing per-meeting role checks, snapshots and audit triggers.
create function public.team_attendance_create_batch(meetings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; result jsonb:='[]';
begin
 if not team_attendance_private.manager() then raise exception 'Leadership access required' using errcode='42501'; end if;
 if jsonb_typeof(meetings) is distinct from 'array' then raise exception 'Meeting list required'; end if;
 if jsonb_array_length(meetings) not between 1 and 52 then raise exception 'Create between 1 and 52 meetings at a time'; end if;
 for item in select value from jsonb_array_elements(meetings) loop
  result:=result||jsonb_build_array(public.team_attendance_manage('create',item));
 end loop;
 return result;
end $$;
-- New structured notice entry point. The existing generic RPC stays compatible.
create function public.team_attendance_request(p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare m public.team_meetings; a public.team_attendance; kind text:=p->>'notice_type';
 expected timestamptz:=nullif(p->>'expected_at','')::timestamptz; t timestamptz:=clock_timestamp();
begin
 if coalesce(team_attendance_private.role(),'') not in ('student','lead') then raise exception 'Student access required' using errcode='42501'; end if;
 if kind is null or kind not in ('absent','late','early') then raise exception 'Select attendance impact'; end if;
 if length(trim(coalesce(p->>'reason',''))) not between 1 and 2000 then raise exception 'Provide a reason (up to 2000 characters)'; end if;
 select * into m from public.team_meetings where id=(p->>'meeting_id')::uuid for update;
 if not found then raise exception 'Meeting not found'; end if;
 t:=clock_timestamp();
 if m.status='finalized' or t>=m.ends_at then raise exception 'Contact leadership after the meeting'; end if;
 if t>=m.starts_at and kind<>'early' then raise exception 'During a meeting only early-departure requests are available'; end if;
 if kind='absent' and expected is not null then raise exception 'Absence does not need an expected time'; end if;
 if kind in ('late','early') and (expected is null or expected<=m.starts_at or expected>=m.ends_at or expected<t) then raise exception 'Expected time must be in the future and during the meeting'; end if;
 select * into a from public.team_attendance where meeting_id=m.id and student_id=auth.uid() for update;
 if not found then raise exception 'You are not on this meeting roster'; end if;
 if a.version is distinct from (p->>'version')::integer then raise exception 'Attendance changed. Refresh and try again.'; end if;
 -- Each change gets a fresh server timestamp and audit history; never backdate notice.
 update public.team_attendance set notice_type=kind,expected_at=expected,notice_at=t,notice_reason=trim(p->>'reason'),
 review_status='pending',review_reason='',reviewed_by=null,reviewed_at=null,version=version+1 where id=a.id;
end $$;
revoke all on function public.team_attendance_create_batch(jsonb),public.team_attendance_request(jsonb) from public,anon,authenticated;
grant execute on function public.team_attendance_create_batch(jsonb),public.team_attendance_request(jsonb) to authenticated;
-- Include only safe structured fields in student audit history if the hardened facade exists.
-- Compatible with both previously released base migration variants.
do $outer$ begin
 if to_regprocedure('team_attendance_private.student_history_payload(text,jsonb)') is not null then
 execute $fn$create or replace function team_attendance_private.student_history_payload(entity text,payload jsonb)
 returns jsonb language sql immutable set search_path='' as $body$
 select case when payload is null then null else coalesce((select jsonb_object_agg(key,value) from jsonb_each(payload)
 where key=any(case entity
 when 'team_attendance' then array['physical_status','review_status','checked_in_at','left_at','notice_at','notice_type','expected_at']
 when 'team_attendance_strikes' then array['category','quantity','assigned_at','rescinded_at'] else array[]::text[] end)), '{}'::jsonb) end
 $body$ $fn$;
 end if;
end $outer$;
commit;
