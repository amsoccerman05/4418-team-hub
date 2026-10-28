-- Insert-only roster reconciliation for accepted, active Attendance participants.
-- Called automatically before authenticated Home / Attendance reads, never from
-- Auth triggers: failures cannot break invitation acceptance or password setup.
-- No backfill runs here. No RLS, existing snapshots, attendance, or strikes change.
begin;

create function team_attendance_private.sync_missing_rosters(target_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare candidate record; m public.team_meetings; mm public.team_meeting_members;
 next_required boolean; added integer:=0;
begin
 if auth.uid() is null or (target_id is distinct from auth.uid() and not team_attendance_private.manager()) then
  raise exception 'Own participant or leadership access required' using errcode='42501';
 end if;
 -- Same serialization order as all existing Attendance mutations.
 perform pg_advisory_xact_lock(4418,10);
 if target_id is distinct from auth.uid() and not team_attendance_private.manager() then
  raise exception 'Leadership access required' using errcode='42501';
 end if;
 perform 1 from public.profiles where id=target_id for share;
 perform 1 from public.team_attendance_members where student_id=target_id for share;
 perform 1 from public.team_positions where key in ('program_manager','operations_lead') order by key for share;
 perform 1 from public.team_member_positions where user_id=target_id order by position_key for share;
 -- Auth readiness is server-owned, never derived from editable user metadata.
 -- A pending invitation must not start a required-attendance obligation.
 perform 1 from auth.users where id=target_id and email_confirmed_at is not null
  and last_sign_in_at is not null and deleted_at is null and not coalesce(is_anonymous,false)
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found or not team_attendance_private.is_participant(target_id) then return 0;end if;
 select p.id,coalesce(r.member_status,'prospective') member_status,coalesce(r.team_area,'') team_area
 into candidate from public.profiles p left join public.team_attendance_members r on r.student_id=p.id where p.id=target_id;
 if candidate.member_status='inactive' then return 0;end if;
 for m in select * from public.team_meetings x where x.ends_at>clock_timestamp()
  and x.status in ('draft','open') and not exists(select 1 from public.team_meeting_members s where s.meeting_id=x.id and s.student_id=target_id)
  order by x.starts_at,x.id for update loop
  -- Lock waits cannot enroll somebody after an occurrence ends or closes.
  if m.ends_at<=clock_timestamp() or m.status not in ('draft','open') then continue;end if;
  -- Mirror creation's audience: all eligible participants can see meetings;
  -- only the existing requirement/area/selection determines future obligations.
  -- Never impose a retrospective obligation on someone joining mid-meeting.
  next_required:=m.starts_at>clock_timestamp() and m.meeting_type<>'stem_outreach' and case m.requirement
   when 'active' then true when 'registered' then candidate.member_status='registered'
   when 'areas' then candidate.member_status='registered' and candidate.team_area=any(m.areas)
   when 'selected' then target_id=any(m.selected_students) else false end;
  insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
   values(m.id,target_id,next_required,candidate.member_status,candidate.team_area)
   on conflict(meeting_id,student_id) do nothing returning * into mm;
  if not found then continue;end if;
  insert into public.team_attendance(meeting_id,student_id,review_status)
   values(m.id,target_id,case when mm.required then 'none' else 'not_required' end);
  insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,after_data,performed_by)
   values(m.id,target_id,'team_meeting_members',target_id::text,'ROSTER_AUTO_ADD',to_jsonb(mm)-'attempts'-'attempt_window',auth.uid());
  added:=added+1;
 end loop;
 return added;
end $$;
revoke all on function team_attendance_private.sync_missing_rosters(uuid) from public,anon,authenticated;

-- No target argument: a client cannot enroll anyone else or choose obligations.
create function public.team_attendance_sync_my_rosters() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object('added',team_attendance_private.sync_missing_rosters(auth.uid()));
end $$;
revoke all on function public.team_attendance_sync_my_rosters() from public,anon,authenticated;
grant execute on function public.team_attendance_sync_my_rosters() to authenticated;
commit;
