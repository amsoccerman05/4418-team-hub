-- MANUAL ONLY. After Attendance, Inventory, Pit, Finance and Team Management.
-- Existing tables, policies and workflow RPCs are unchanged.
begin;
create table public.team_announcements (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(trim(title)) between 1 and 150),
 body text not null check(length(trim(body)) between 1 and 5000),
 severity text not null default 'normal' check(severity in ('normal','important','urgent')),
 area_id uuid references public.areas(id), active boolean not null default true,
 expires_at timestamptz, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
alter table public.team_announcements enable row level security;
revoke all on public.team_announcements from public,anon,authenticated;
grant select on public.team_announcements to authenticated;
create policy announcement_read on public.team_announcements for select to authenticated using (
 team_private.admin() or (active and (expires_at is null or expires_at>now()) and exists(
 select 1 from public.profiles p where p.id=auth.uid() and p.active and (area_id is null or p.primary_area_id=area_id)))
);
create function public.team_announcement_save(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare aid uuid:=nullif(p->>'id','')::uuid; target uuid:=nullif(p->>'area_id','')::uuid;
begin
 if not team_private.admin() then raise exception 'Active mentor or admin required' using errcode='42501';end if;
 if coalesce((p->>'active')::boolean,true) and target is not null and not exists(select 1 from public.areas where id=target and active) then raise exception 'Choose an active area';end if;
 if aid is null then
 insert into public.team_announcements(title,body,severity,area_id,active,expires_at,created_by)
 values(trim(p->>'title'),trim(p->>'body'),p->>'severity',target,coalesce((p->>'active')::boolean,true),nullif(p->>'expires_at','')::timestamptz,auth.uid()) returning id into aid;
 else
 update public.team_announcements set title=trim(p->>'title'),body=trim(p->>'body'),severity=p->>'severity',area_id=target,
 active=coalesce((p->>'active')::boolean,true),expires_at=nullif(p->>'expires_at','')::timestamptz,version=version+1,updated_at=clock_timestamp()
 where id=aid and version=(p->>'version')::integer;
 if not found then raise exception 'Announcement changed. Refresh before saving.';end if;
 end if;return aid;
end $$;
-- SECURITY INVOKER is deliberate: every source query retains its existing RLS.
-- No raw audit, notice explanations, school notes, or other students' PO data returned.
create function public.team_dashboard_context() returns jsonb language plpgsql security invoker set search_path='' as $$
declare pr public.profiles; leadership boolean; personal jsonb; next_meeting jsonb; orders jsonb; actions jsonb; attention jsonb; robot jsonb; stock jsonb;
begin
 select * into pr from public.profiles where id=auth.uid() and active;
 if not found then raise exception 'Active team account required' using errcode='42501';end if;
 leadership:=pr.role::text in ('lead','mentor','admin');
 select jsonb_build_object('percent',case when count(*)=0 then null else round(100.0*count(*) filter(where a.physical_status in ('present','late','left_early'))/count(*)) end,
 'strikes',(select coalesce(sum(quantity),0) from public.team_attendance_strikes where student_id=pr.id and rescinded_at is null),
 'pending',(select count(*) from public.team_attendance where student_id=pr.id and review_status='pending')) into personal
 from public.team_attendance a join public.team_meetings m on m.id=a.meeting_id
 join public.team_meeting_members mm on mm.meeting_id=a.meeting_id and mm.student_id=a.student_id
 where a.student_id=pr.id and m.status='finalized' and mm.required and a.review_status not in ('excused','not_required');
 select jsonb_build_object('id',m.id,'title',m.title,'type',m.meeting_type,'starts_at',m.starts_at,'ends_at',m.ends_at,'required',true,
 'code_expires_at',m.code_expires_at,'check_in_open',m.status='open' and m.check_in_open and m.code_expires_at>now(),'physical_status',a.physical_status) into next_meeting
 from public.team_meetings m join public.team_meeting_members mm on mm.meeting_id=m.id and mm.student_id=pr.id and mm.required
 left join public.team_attendance a on a.meeting_id=m.id and a.student_id=pr.id
 where m.ends_at>now() and m.status in ('draft','open','closed') order by m.starts_at limit 1;
 select coalesce(jsonb_agg(x order by x.updated_at desc),'[]') into orders from (
 select p.id,p.po_number,p.vendor,p.amount,p.status,p.updated_at,
 (select count(distinct slot) from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.action='approved'
 and p.status in ('awaiting_approval','approved','submitted_to_school') and not exists(select 1 from public.finance_po_approvals c where c.po_id=p.id and c.revision=p.revision and c.action='changes_requested')) as approvals
 from public.finance_purchase_orders p where p.requester_id=pr.id order by p.updated_at desc limit 5) x;
 select jsonb_build_object('approvals',count(*) filter(where p.status='awaiting_approval' and p.requester_id<>pr.id
 and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and (a.action='changes_requested' or a.actor_id=pr.id))
 and ((finance_private.cap('finance_approver') and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.slot='finance_approver' and a.action='approved'))
 or (finance_private.cap('po_approver') and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.slot='po_approver' and a.action='approved')))),
 'school',count(*) filter(where p.status='approved' and (finance_private.cap('school_submitter') or pr.role::text in ('mentor','admin'))
 and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.action='changes_requested')
 and (select count(distinct a.slot)=2 and count(distinct a.actor_id)=2 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.action='approved')),
 'allowed',leadership or finance_private.cap('finance_approver') or finance_private.cap('po_approver') or finance_private.cap('school_submitter')) into actions from public.finance_purchase_orders p;
 if leadership then
 select jsonb_build_object('open_meetings',(select count(*) from public.team_meetings where status='open' and check_in_open and code_expires_at>now() and ends_at>now()),
 'requests',(select count(*) from public.team_attendance where review_status='pending'),
 'strike_actions',(select count(*) from (select student_id from public.team_attendance_strikes where rescinded_at is null group by student_id having sum(quantity)>=3) s)) into attention;
 select jsonb_build_object('event',e.name,'open',count(i.id) filter(where i.status<>'RESOLVED'),
 'blocking',count(i.id) filter(where i.status<>'RESOLVED' and i.severity in ('HIGH','ROBOT DOWN')),
 'readiness',case when bool_or(i.status<>'RESOLVED' and i.severity='ROBOT DOWN') then 'NOT READY' when bool_or(i.status<>'RESOLVED' and i.severity='HIGH') then 'NEEDS ATTENTION' else 'READY' end) into robot
 from public.pit_events e left join public.pit_issues i on i.event_id=e.id where e.status='active' group by e.id,e.name;
 select jsonb_build_object('out',count(*) filter(where qty=0),'low',count(*) filter(where qty>0 and qty<=minimum_quantity)) into stock
 from (select minimum_quantity,quantity as qty from public.inventory_items) counts;
 end if;
 return jsonb_build_object('name',pr.display_name,'role',pr.role,'admin',pr.role::text in ('mentor','admin'),'personal',personal,'next_meeting',next_meeting,'orders',orders,'finance',actions,'attention',attention,'robot',robot,'inventory',stock,
 'announcements',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'severity',severity,'created_at',created_at,'expires_at',expires_at) order by case severity when 'urgent' then 0 when 'important' then 1 else 2 end,created_at desc),'[]') from public.team_announcements where active and (expires_at is null or expires_at>now())));
end $$;
revoke all on function public.team_dashboard_context(),public.team_announcement_save(jsonb) from public,anon,authenticated;
grant execute on function public.team_dashboard_context(),public.team_announcement_save(jsonb) to authenticated;
commit;
