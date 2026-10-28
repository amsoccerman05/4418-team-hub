-- Requires reviewed core160322, Finance160500 and shared160734. No grants/data changes.
begin;
do $$ begin
 if to_regprocedure('finance_private.coach_self_approval_context(uuid)') is null then raise exception 'Reviewed Finance Coach helper required';end if;
 if (select md5(prosrc) from pg_proc where oid='notifications_private.center_rows()'::regprocedure) is distinct from '1b609c0bf031ff9dc6023e5cf3bfa740' then raise exception 'Installed notifications_private.center_rows differs from reviewed shared role definition';end if;
 if (select md5(prosrc) from pg_proc where oid='public.team_dashboard_context()'::regprocedure) is distinct from '723a70c2abae67e509d760f6858855cb' then raise exception 'Installed public.team_dashboard_context differs from reviewed shared role definition';end if;
end $$;
CREATE OR REPLACE FUNCTION notifications_private.center_rows()
 RETURNS TABLE(id uuid, source text, title text, message text, created_at timestamp with time zone, read_at timestamp with time zone, href text, action_needed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with me as materialized (select p.id,p.role::text role,finance_private.cap('finance_approver') fc,finance_private.cap('po_approver') pc,finance_private.cap('school_submitter') sc,finance_private.admin() fa,notifications_private.attendance_reviewer(p.id) reviewer from public.profiles p where p.id=auth.uid() and p.active),
 mine as (select r.id,r.read_at,e.source,e.kind,e.object_id,e.revision,e.title,e.message,e.created_at from notifications_private.recipients r join notifications_private.events e on e.id=r.event_id where r.user_id=auth.uid())
 select r.id,r.source,r.title,r.message,r.created_at,r.read_at,
 case r.source when 'finance' then 'https://finance.frc4418.org/#po/'||r.object_id when 'attendance' then '#attendance/'||case when r.kind='strike_assigned' then 'strikes' when r.kind in ('request_approved','request_denied') and team_attendance_private.is_student_program_manager(me.id) then 'my-requests' else 'notices' end else '#home-announcements' end,
 coalesce(case when r.source='finance' and po.revision=r.revision then
  case when r.kind='ready_for_school' then po.status='approved' and (me.sc or me.fa) and finance_private.revision_approved(po.id,po.revision)
  when r.kind in ('approval_needed','approval_remaining','approval_recorded') then po.status='awaiting_approval' and (po.requester_id<>me.id or coalesce((finance_private.coach_self_approval_context(po.id)->>'allowed')::boolean,false))
   and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and (ap.action='changes_requested' or ap.actor_id=me.id and ap.action='approved'))
   and ((me.fc and po.requester_id<>me.id and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and ap.slot='finance_approver' and ap.action='approved')) or (me.pc and not exists(select 1 from public.finance_po_approvals ap where ap.po_id=po.id and ap.revision=po.revision and ap.slot='po_approver' and ap.action='approved'))) else false end
 when r.source='attendance' and r.kind='request_review' then team_attendance_private.can_review_request(att.student_id,me.id) and att.review_status='pending' else false end,false)
 from mine r cross join me left join public.finance_purchase_orders po on r.source='finance' and po.id=r.object_id
 left join public.team_attendance att on r.source='attendance' and att.id=r.object_id
 where (r.source='finance' and finance_private.visible(po.id)) or
 (r.source='attendance' and ((r.kind='request_review' and team_attendance_private.can_review_request(att.student_id,me.id)) or (r.kind<>'request_review' and att.student_id=me.id and (me.role in ('student','lead','admin_lead') or team_attendance_private.reader())))) or
 (r.source='announcements' and public.team_announcement_visible(r.object_id))
$function$;
CREATE OR REPLACE FUNCTION public.team_dashboard_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare pr public.profiles; leadership boolean; personal jsonb; next_meeting jsonb; orders jsonb; actions jsonb; attention jsonb; robot jsonb; stock jsonb; coach_self jsonb;
begin
 select * into pr from public.profiles where id=auth.uid() and active;
 if not found then raise exception 'Active team account required' using errcode='42501';end if;
 -- Reuse the authenticated public projection; preserve SECURITY INVOKER and private helper ACLs.
 coach_self:=coalesce(public.finance_context()->'coach_self_approvals','[]'::jsonb);
 leadership:=pr.role::text in ('lead','admin_lead','mentor','admin');
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
 select jsonb_build_object('approvals',count(*) filter(where p.status='awaiting_approval' and (p.requester_id<>pr.id or exists(select 1 from jsonb_array_elements(coach_self) c where c->>'po_id'=p.id::text and c->>'allowed'='true'))
 and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and (a.action='changes_requested' or a.actor_id=pr.id))
 and ((finance_private.cap('finance_approver') and p.requester_id<>pr.id and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.slot='finance_approver' and a.action='approved'))
 or (finance_private.cap('po_approver') and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.slot='po_approver' and a.action='approved')))),
 'school',count(*) filter(where p.status='approved' and (finance_private.cap('school_submitter') or pr.role::text in ('mentor','admin'))
 and not exists(select 1 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.action='changes_requested')
 and (select count(distinct a.slot)=2 and count(distinct a.actor_id)=2 from public.finance_po_approvals a where a.po_id=p.id and a.revision=p.revision and a.action='approved')),
 'allowed',leadership or finance_private.cap('finance_approver') or finance_private.cap('po_approver') or finance_private.cap('school_submitter')) into actions from public.finance_purchase_orders p;
 if team_attendance_private.reader() then
 select jsonb_build_object('open_meetings',(select count(*) from public.team_meetings where status='open' and check_in_open and code_expires_at>now() and ends_at>now()),
 'requests',(select count(*) from public.team_attendance where review_status='pending'),
 'strike_actions',(select count(*) from (select student_id from public.team_attendance_strikes where rescinded_at is null group by student_id having sum(quantity)>=3) s)) into attention;
 end if;
 if leadership then
 select jsonb_build_object('event',e.name,'open',count(i.id) filter(where i.status<>'RESOLVED'),
 'blocking',count(i.id) filter(where i.status<>'RESOLVED' and i.severity in ('HIGH','ROBOT DOWN')),
 'readiness',case when bool_or(i.status<>'RESOLVED' and i.severity='ROBOT DOWN') then 'NOT READY' when bool_or(i.status<>'RESOLVED' and i.severity='HIGH') then 'NEEDS ATTENTION' else 'READY' end) into robot
 from public.pit_events e left join public.pit_issues i on i.event_id=e.id where e.status='active' group by e.id,e.name;
 select jsonb_build_object('out',count(*) filter(where qty=0),'low',count(*) filter(where qty>0 and qty<=minimum_quantity)) into stock
 from (select minimum_quantity,quantity as qty from public.inventory_items) counts;
 end if;
 return jsonb_build_object('name',pr.display_name,'role',pr.role,'admin',pr.role::text in ('mentor','admin'),'personal',personal,'next_meeting',next_meeting,'orders',orders,'finance',actions,'attention',attention,'robot',robot,'inventory',stock,
 'announcements',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'severity',severity,'created_at',created_at,'expires_at',expires_at,'image_path',image_path,'audience',audience) order by case severity when 'urgent' then 0 when 'important' then 1 else 2 end,created_at desc),'[]') from public.team_announcements where active and (expires_at is null or expires_at>now())));
end $function$;
commit;
