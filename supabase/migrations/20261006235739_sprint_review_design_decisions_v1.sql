-- Local additive extension of the existing Sprint Review update. No second register,
-- new role, task mutation, approval, vote or signature. Existing access is unchanged.
begin;
-- Order schema evolution with all existing Planning and Sprint Review writes.
select pg_advisory_xact_lock(4418,30);
alter table public.planning_sprint_review_updates add column decision_workflow jsonb;
comment on column public.planning_sprint_review_updates.decision_workflow is
 'Optional manual design comparison inside this review update; schema version 1. Reported student decision, not approval or signature.';

create function planning_review_private.decision_workflow_valid(v jsonb,previous_workflow jsonb,p jsonb)
returns void language plpgsql set search_path='' as $$
declare item jsonb; field text; owner_id uuid; option_id uuid; chosen_id uuid; option_ids uuid[]:='{}';
 study jsonb; criterion jsonb; assessment jsonb; criterion_id uuid; criterion_ids uuid[]:='{}'; assessment_pairs text[]:='{}'; pair text;
begin
 if v is null then return;end if;
 perform planning_review_private.keys(v-'trade_study',array['schema_version','status','owner_id','target_date','decided_on','requirements','options','chosen_option_id','reopen_criteria']);
 if v->'schema_version' is distinct from '1'::jsonb or jsonb_typeof(v->'status') is distinct from 'string'
 or v->>'status' not in ('comparing','recorded','reopened') then raise exception using errcode='SR422',message='Invalid decision workflow';end if;
 owner_id:=planning_review_private.uid(v->'owner_id');
 if owner_id is not null and not exists(select 1 from public.profiles x where x.id=owner_id and x.active and x.role::text in ('student','lead'))
 and owner_id is distinct from planning_review_private.uid(coalesce(previous_workflow->'owner_id','null'::jsonb))
 then raise exception using errcode='SR422',message='Choose an active student decision owner';end if;
 foreach field in array array['target_date','decided_on'] loop
  if v->field is distinct from 'null'::jsonb then
   perform planning_review_private.text_field(v,field,10,true);
   if (v->>field)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (v->>field)::date not between date '0001-01-01' and date '9999-12-31'
   then raise exception using errcode='SR422',message='Finite decision calendar date required';end if;
  end if;
 end loop;
 perform planning_review_private.references_valid(v->'requirements');
 perform planning_review_private.text_field(v,'reopen_criteria',2000);
 if jsonb_typeof(v->'options') is distinct from 'array' or jsonb_array_length(v->'options') not between 1 and 6
 then raise exception using errcode='SR422',message='Choose one to six decision options';end if;
 for item in select value from jsonb_array_elements(v->'options') loop
  perform planning_review_private.keys(item-'swot',array['id','label','description','weight','space','cost','reliability','time','evidence']);
  option_id:=planning_review_private.uid(item->'id');
  if option_id is null or option_id=any(option_ids) then raise exception using errcode='SR422',message='Unique decision option identity required';end if;
  option_ids:=array_append(option_ids,option_id);
  perform planning_review_private.text_field(item,'label',200,true);
  perform planning_review_private.text_field(item,'description',2000);
  foreach field in array array['weight','space','cost','reliability','time'] loop perform planning_review_private.text_field(item,field,1000);end loop;
  perform planning_review_private.references_valid(item->'evidence');
  if item ? 'swot' and item->'swot'<>'null'::jsonb then
   perform planning_review_private.keys(item->'swot',array['strengths','weaknesses','opportunities','threats']);
   foreach field in array array['strengths','weaknesses','opportunities','threats'] loop perform planning_review_private.text_field(item->'swot',field,2000);end loop;
  end if;
 end loop;
 -- Team-defined raw engineering measurements. No computed score or rank is persisted.
 -- Match the browser's finite IEEE-754 number representation, including ordered scale
 -- endpoints after rounding. Unrepresentable overflow/underflow raises a sanitized SR422.
 if v ? 'trade_study' and v->'trade_study'<>'null'::jsonb then
  study:=v->'trade_study';
  perform planning_review_private.keys(study,array['criteria','assessments']);
  if jsonb_typeof(study->'criteria') is distinct from 'array' or jsonb_array_length(study->'criteria')>8
  or jsonb_typeof(study->'assessments') is distinct from 'array' or jsonb_array_length(study->'assessments')>48
  then raise exception using errcode='SR422',message='Invalid trade study size';end if;
  for criterion in select value from jsonb_array_elements(study->'criteria') loop
   perform planning_review_private.keys(criterion,array['id','label','unit','weight','scale_min','scale_max','direction','must_have','minimum','maximum']);
   criterion_id:=planning_review_private.uid(criterion->'id');
   if criterion_id is null or criterion_id=any(criterion_ids) then raise exception using errcode='SR422',message='Unique criterion identity required';end if;
   criterion_ids:=array_append(criterion_ids,criterion_id);
   perform planning_review_private.text_field(criterion,'label',200,true);
   perform planning_review_private.text_field(criterion,'unit',50,true);
   if jsonb_typeof(criterion->'weight') is distinct from 'number' or (criterion->>'weight')::double precision not between 0 and 1000
   then raise exception using errcode='SR422',message='Invalid criterion weight';end if;
   foreach field in array array['scale_min','scale_max','minimum','maximum'] loop
    if field in ('scale_min','scale_max') or criterion->field<>'null'::jsonb then
     if jsonb_typeof(criterion->field) is distinct from 'number' or (criterion->>field)::double precision not between -1000000000000 and 1000000000000
     then raise exception using errcode='SR422',message='Invalid measurement bound';end if;
    end if;
   end loop;
   if (criterion->>'scale_min')::double precision>=(criterion->>'scale_max')::double precision
   or jsonb_typeof(criterion->'direction') is distinct from 'string' or criterion->>'direction' not in ('higher','lower')
   or jsonb_typeof(criterion->'must_have') is distinct from 'boolean'
   then raise exception using errcode='SR422',message='Invalid normalization definition';end if;
   if (criterion->>'must_have')::boolean then
    if criterion->'minimum'='null'::jsonb and criterion->'maximum'='null'::jsonb
    then raise exception using errcode='SR422',message='A hard constraint requires a minimum or maximum';end if;
   elsif criterion->'minimum'<>'null'::jsonb or criterion->'maximum'<>'null'::jsonb
   then raise exception using errcode='SR422',message='Unmarked hard constraint';end if;
   if criterion->'minimum'<>'null'::jsonb and criterion->'maximum'<>'null'::jsonb and (criterion->>'minimum')::double precision>(criterion->>'maximum')::double precision
   then raise exception using errcode='SR422',message='Invalid hard constraint bounds';end if;
  end loop;
  for assessment in select value from jsonb_array_elements(study->'assessments') loop
   perform planning_review_private.keys(assessment,array['option_id','criterion_id','value','reason','evidence']);
   option_id:=planning_review_private.uid(assessment->'option_id');criterion_id:=planning_review_private.uid(assessment->'criterion_id');
   if option_id is null or criterion_id is null
   or not exists(select 1 from jsonb_array_elements(v->'options') x where x->>'id'=assessment->>'option_id')
   or not exists(select 1 from jsonb_array_elements(study->'criteria') x where x->>'id'=assessment->>'criterion_id')
   then raise exception using errcode='SR422',message='Assessment must reference this comparison';end if;
   pair:=option_id::text||':'||criterion_id::text;
   if pair=any(assessment_pairs) then raise exception using errcode='SR422',message='Duplicate option criterion assessment';end if;
   assessment_pairs:=array_append(assessment_pairs,pair);
   if assessment->'value'<>'null'::jsonb and (jsonb_typeof(assessment->'value') is distinct from 'number' or (assessment->>'value')::double precision not between -1000000000000 and 1000000000000)
   then raise exception using errcode='SR422',message='Invalid raw measurement';end if;
   perform planning_review_private.text_field(assessment,'reason',2000);
   perform planning_review_private.references_valid(assessment->'evidence');
  end loop;
 end if;
 chosen_id:=planning_review_private.uid(v->'chosen_option_id');
 if chosen_id is not null and not exists(select 1 from jsonb_array_elements(v->'options') x where x->>'id'=v->>'chosen_option_id')
 then raise exception using errcode='SR422',message='Chosen option must be in the comparison';end if;
 if v->>'status'='recorded' then
  if owner_id is null or v->'decided_on'='null'::jsonb or chosen_id is null or jsonb_array_length(p->'reported_by_student_ids')=0
  then raise exception using errcode='SR422',message='Complete the reported student decision';end if;
  perform planning_review_private.text_field(p,'reported_decision',5000,true);
  perform planning_review_private.text_field(p,'decision_rationale',5000,true);
  perform planning_review_private.text_field(v,'reopen_criteria',2000,true);
 end if;
end $$;
revoke all on function planning_review_private.decision_workflow_valid(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Resolve only this already-readable update's owner through the existing bounded person
-- projection, preserving historical inactive/unavailable identities without expanding members.
create or replace function planning_review_private.update_json(u public.planning_sprint_review_updates) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(u)||jsonb_build_object('decision_owner',planning_review_private.person(planning_review_private.uid(coalesce(u.decision_workflow->'owner_id','null'::jsonb))),'evidence',planning_review_private.safe_references(u.evidence),'decision_references',planning_review_private.safe_references(u.decision_references),
 'linked_task',planning_review_private.task(u.linked_task_id),
 'reported_students',(select coalesce(jsonb_agg(planning_review_private.person(x) order by x),'[]') from unnest(u.reported_by_student_ids) x),
 'carried_from',(select jsonb_build_object('update_id',p.id,'review_id',r.id,'review_title',r.title,'review_date',to_char(r.review_date,'YYYY-MM-DD'))
 from public.planning_sprint_review_updates p join public.planning_sprint_reviews r on r.id=p.review_id where p.id=u.carry_from_update_id and planning_review_private.board_visible(p.board_id)))
$$;

-- Only changes to this existing guarded RPC: optional-key validation, effective workflow
-- validation, and the inserted/updated JSON column. Lock/auth/replay/version/audit stay intact.
create or replace function public.sprint_review_save(action text,request_id uuid,expected_actor uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ident uuid; old jsonb; result jsonb; prior planning_review_private.requests; previous_version integer;
 r public.planning_sprint_reviews; u public.planning_sprint_review_updates; a public.planning_project_review_assignments;
 workflow jsonb; member_ids uuid[]; student_ids uuid[]; person_id uuid; task_id uuid; carried_id uuid; item jsonb; field text;
begin
 perform pg_advisory_xact_lock(4418,30);
 perform planning_review_private.actor(expected_actor);
 if request_id is null or p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>64000 then raise exception using errcode='SR422',message='Invalid request';end if;
 perform planning_review_private.authorize(action,p);
 select * into prior from planning_review_private.requests q where q.actor_id=expected_actor and q.request_id=sprint_review_save.request_id;
 if found then
  if prior.status='applied' and (prior.action is distinct from action or prior.payload is distinct from p) then raise exception using errcode='SR412',message='Request conflict';end if;
  return planning_review_private.receipt(request_id,expected_actor);
 end if;
 if action='review' then
  perform planning_review_private.keys(p,array['id','version','season_id','title','review_date','chair_id','agenda']);
  ident:=planning_review_private.uid(p->'id');select * into r from public.planning_sprint_reviews where id=ident;
  if r.id is not null then old:=to_jsonb(r);previous_version:=r.version;if r.season_id is distinct from planning_review_private.uid(p->'season_id') then raise exception using errcode='SR403',message='Stable season required';end if;end if;
 elsif action='assignment' then
  perform planning_review_private.keys(p,array['board_id','version','lead_id','supporter_ids']);
  ident:=planning_review_private.uid(p->'board_id');select * into a from public.planning_project_review_assignments where board_id=ident;
  if a.board_id is not null then old:=planning_review_private.assignment_json(ident);previous_version:=a.version;end if;
 else
  perform planning_review_private.keys(p-'decision_workflow',array['id','version','review_id','board_id','progress','blockers','evidence','tradeoffs','decisions_needed','decision_references','reported_decision','decision_rationale','reported_by_student_ids','next_test','linked_task_id','carry_from_update_id','unresolved']);
  ident:=planning_review_private.uid(p->'id');select * into u from public.planning_sprint_review_updates where id=ident;
  if u.id is not null then old:=to_jsonb(u);previous_version:=u.version;
   if u.review_id is distinct from planning_review_private.uid(p->'review_id') or u.board_id is distinct from planning_review_private.uid(p->'board_id') then raise exception using errcode='SR403',message='Stable update scope required';end if;
  elsif exists(select 1 from public.planning_sprint_review_updates x where x.review_id=planning_review_private.uid(p->'review_id') and x.board_id=planning_review_private.uid(p->'board_id')) then raise exception using errcode='SR409',message='Update already exists';end if;
 end if;
 if ident is null then raise exception using errcode='SR422',message='Identity required';end if;
 if previous_version is null then
  if p->'version' is distinct from 'null'::jsonb then raise exception using errcode='SR409',message='New version required';end if;
 elsif jsonb_typeof(p->'version') is distinct from 'number' or (p->>'version') !~'^[1-9][0-9]{0,9}$' or (p->>'version')::bigint is distinct from previous_version then raise exception using errcode='SR409',message='Stale version';end if;
 if action='review' then
  perform planning_review_private.text_field(p,'title',200,true);perform planning_review_private.text_field(p,'review_date',10,true);
  if (p->>'review_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (p->>'review_date')::date not between date '0001-01-01' and date '9999-12-31' then raise exception using errcode='SR422',message='Finite calendar date required';end if;
  -- A date correction must preserve the order of existing carry-forward links.
  -- Otherwise later writes could create a cycle by first reversing meeting dates.
  if r.id is not null and exists(
   select 1 from public.planning_sprint_review_updates child
   join public.planning_sprint_review_updates source on source.id=child.carry_from_update_id
   join public.planning_sprint_reviews cr on cr.id=child.review_id
   join public.planning_sprint_reviews sr on sr.id=source.review_id
   where (cr.id=r.id or sr.id=r.id) and
   (case when sr.id=r.id then (p->>'review_date')::date else sr.review_date end,sr.created_at,sr.id)>=
   (case when cr.id=r.id then (p->>'review_date')::date else cr.review_date end,cr.created_at,cr.id)
  ) then raise exception using errcode='SR422',message='Keep carry-forward meeting order';end if;
  person_id:=planning_review_private.uid(p->'chair_id');
  if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead','mentor','admin')) and person_id is distinct from r.chair_id then raise exception using errcode='SR422',message='Choose an active chair';end if;
  if jsonb_typeof(p->'agenda') is distinct from 'array' or jsonb_array_length(p->'agenda')>30 then raise exception using errcode='SR422',message='Invalid agenda';end if;
  for item in select value from jsonb_array_elements(p->'agenda') loop
   perform planning_review_private.keys(item,array['title','presenter_id','duration_minutes']);perform planning_review_private.text_field(item,'title',200,true);
   if jsonb_typeof(item->'duration_minutes') is distinct from 'number' or (item->>'duration_minutes') !~'^[1-9][0-9]{0,2}$' or (item->>'duration_minutes')::integer>240 then raise exception using errcode='SR422',message='Invalid agenda duration';end if;
   person_id:=planning_review_private.uid(item->'presenter_id');
   if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead','mentor','admin'))
   and not exists(select 1 from jsonb_array_elements(coalesce(r.agenda,'[]')) x where x->>'presenter_id'=person_id::text) then raise exception using errcode='SR422',message='Choose an active presenter';end if;
  end loop;
  insert into public.planning_sprint_reviews(id,season_id,title,review_date,chair_id,agenda,recorded_by)
  values(ident,planning_review_private.uid(p->'season_id'),planning_review_private.clean(p->>'title'),(p->>'review_date')::date,planning_review_private.uid(p->'chair_id'),p->'agenda',auth.uid())
  on conflict(id) do update set title=excluded.title,review_date=excluded.review_date,chair_id=excluded.chair_id,agenda=excluded.agenda,version=planning_sprint_reviews.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp()
  returning to_jsonb(planning_sprint_reviews.*) into result;
 elsif action='assignment' then
  person_id:=planning_review_private.uid(p->'lead_id');member_ids:=planning_review_private.ids(p->'supporter_ids');
  if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead')) and person_id is distinct from a.lead_id then raise exception using errcode='SR422',message='Choose an active student lead';end if;
  if person_id=any(member_ids) then raise exception using errcode='SR422',message='Lead already participates';end if;
  if exists(select 1 from unnest(member_ids) x where not exists(select 1 from public.profiles y where y.id=x and y.active and y.role::text in ('student','lead','mentor','admin'))
   and not exists(select 1 from public.planning_project_review_supporters z where z.board_id=ident and z.user_id=x)) then raise exception using errcode='SR422',message='Choose active supporters';end if;
  insert into public.planning_project_review_assignments(board_id,lead_id,recorded_by) values(ident,person_id,auth.uid())
  on conflict(board_id) do update set lead_id=excluded.lead_id,version=planning_project_review_assignments.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp();
  delete from public.planning_project_review_supporters where board_id=ident and not(user_id=any(member_ids));
  insert into public.planning_project_review_supporters(board_id,user_id) select ident,x from unnest(member_ids) x on conflict do nothing;
  result:=planning_review_private.assignment_json(ident);
 else
  foreach field in array array['progress','blockers','tradeoffs','decisions_needed','reported_decision','decision_rationale','next_test'] loop perform planning_review_private.text_field(p,field,5000);end loop;
  perform planning_review_private.references_valid(p->'evidence');perform planning_review_private.references_valid(p->'decision_references');
  student_ids:=planning_review_private.ids(p->'reported_by_student_ids');
  if exists(select 1 from unnest(student_ids) x where not exists(select 1 from public.profiles y where y.id=x and y.active and y.role::text in ('student','lead')) and not(x=any(coalesce(u.reported_by_student_ids,'{}')))) then raise exception using errcode='SR422',message='Choose reported student participants';end if;
  -- Omitted field is a legacy client: preserve the existing workflow. JSON null explicitly clears it.
  workflow:=case when p ? 'decision_workflow' then nullif(p->'decision_workflow','null'::jsonb) else u.decision_workflow end;
  perform planning_review_private.decision_workflow_valid(workflow,u.decision_workflow,p);
  task_id:=planning_review_private.uid(p->'linked_task_id');carried_id:=planning_review_private.uid(p->'carry_from_update_id');
  select * into r from public.planning_sprint_reviews where id=planning_review_private.uid(p->'review_id');
  if task_id is not null and task_id is distinct from u.linked_task_id and not exists(select 1 from public.planning_tasks t join public.planning_boards b on b.id=t.board_id
   where t.id=task_id and b.active and (b.season_id=r.season_id or b.kind='area') and planning_review_private.board_visible(b.id)) then raise exception using errcode='SR422',message='Choose visible Planning work';end if;
  if carried_id is not null and not exists(select 1 from public.planning_sprint_review_updates x join public.planning_sprint_reviews y on y.id=x.review_id
   where x.id=carried_id and x.board_id=planning_review_private.uid(p->'board_id') and y.season_id=r.season_id and (y.review_date,y.created_at,y.id)<(r.review_date,r.created_at,r.id)) then raise exception using errcode='SR422',message='Choose an earlier update for this project';end if;
  if jsonb_typeof(p->'unresolved') is distinct from 'boolean' then raise exception using errcode='SR422',message='Invalid unresolved flag';end if;
  insert into public.planning_sprint_review_updates(id,review_id,board_id,progress,blockers,evidence,tradeoffs,decisions_needed,decision_references,reported_decision,decision_rationale,reported_by_student_ids,next_test,linked_task_id,carry_from_update_id,unresolved,decision_workflow,recorded_by)
  values(ident,r.id,planning_review_private.uid(p->'board_id'),p->>'progress',p->>'blockers',p->'evidence',p->>'tradeoffs',p->>'decisions_needed',p->'decision_references',p->>'reported_decision',p->>'decision_rationale',student_ids,p->>'next_test',task_id,carried_id,(p->>'unresolved')::boolean,workflow,auth.uid())
  on conflict(id) do update set progress=excluded.progress,blockers=excluded.blockers,evidence=excluded.evidence,tradeoffs=excluded.tradeoffs,decisions_needed=excluded.decisions_needed,decision_references=excluded.decision_references,reported_decision=excluded.reported_decision,decision_rationale=excluded.decision_rationale,reported_by_student_ids=excluded.reported_by_student_ids,next_test=excluded.next_test,linked_task_id=excluded.linked_task_id,carry_from_update_id=excluded.carry_from_update_id,unresolved=excluded.unresolved,decision_workflow=excluded.decision_workflow,version=planning_sprint_review_updates.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp()
  returning to_jsonb(planning_sprint_review_updates.*) into result;
 end if;
 insert into planning_review_private.history(action,entity_id,actor_id,request_id,before_data,after_data) values(action,ident,auth.uid(),request_id,old,result);
 insert into planning_review_private.requests(actor_id,request_id,action,payload,status,entity_id,version) values(auth.uid(),request_id,action,p,'applied',ident,(result->>'version')::integer);
 return planning_review_private.receipt(request_id,expected_actor);
exception when others then raise exception using errcode=case when sqlstate like 'SR%' then sqlstate else 'SR422' end,message=planning_review_private.error_message(case when sqlstate like 'SR%' then sqlstate else 'SR422' end),detail='',hint='';
end $$;

commit;
