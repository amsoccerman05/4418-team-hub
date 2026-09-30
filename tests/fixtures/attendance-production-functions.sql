-- Read-only production inspection, 2026-09-30. Existing public audit-table variant.
CREATE OR REPLACE FUNCTION team_attendance_private.audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b jsonb; a jsonb; r jsonb;
begin
 if TG_OP<>'INSERT' then b:=to_jsonb(old)-'code_hash'-'code_expires_at'; end if;
 if TG_OP<>'DELETE' then a:=to_jsonb(new)-'code_hash'-'code_expires_at'; end if;
 r:=coalesce(a,b);
 insert into public.team_attendance_history(meeting_id,student_id,entity,entity_id,action,before_data,after_data,performed_by)
 values(case when TG_TABLE_NAME='team_meetings' then (r->>'id')::uuid else (r->>'meeting_id')::uuid end,
 (r->>'student_id')::uuid,TG_TABLE_NAME,coalesce(r->>'id',r->>'student_id'),TG_OP,b,a,auth.uid());
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.team_attendance_manage(action text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 coalesce((p->>'late_minutes')::integer,10),coalesce(p->>'requirement','active'),array(select jsonb_array_elements_text(coalesce(p->'areas','[]'))),
 array(select jsonb_array_elements_text(coalesce(p->'selected_students','[]'))::uuid),auth.uid()) returning * into m;
 insert into public.team_meeting_members(meeting_id,student_id,required,member_status,team_area)
 select m.id,pr.id,case m.requirement when 'active' then true when 'registered' then coalesce(mem.member_status,'prospective')='registered'
 when 'areas' then coalesce(mem.member_status,'prospective')='registered' and coalesce(mem.team_area,'')=any(m.areas)
 when 'selected' then pr.id=any(m.selected_students) else false end,coalesce(mem.member_status,'prospective'),coalesce(mem.team_area,'')
 from public.profiles pr left join public.team_attendance_members mem on mem.student_id=pr.id
 where pr.active and pr.role::text in ('student','lead') and coalesce(mem.member_status,'prospective')<>'inactive';
 insert into public.team_attendance(meeting_id,student_id,review_status) select meeting_id,student_id,case when required then 'none' else 'not_required' end from public.team_meeting_members where meeting_id=m.id;
 -- Audit the initial required roster using the existing production history table.
 insert into public.team_attendance_history(meeting_id,entity,entity_id,action,after_data,performed_by)
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
end $function$;

CREATE OR REPLACE FUNCTION public.team_attendance_check_in(meeting_id uuid, code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
