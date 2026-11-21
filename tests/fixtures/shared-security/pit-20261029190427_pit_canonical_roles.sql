-- Apply only after the reviewed Hub canonical-five-role migration converts the
-- explicitly approved legacy account. No account or position changes here.
-- Mentor is the only suite-administration role; Admin Lead keeps existing scope.
-- Full live definition, ACL and policy pins prevent overwriting unseen changes.
begin;
select pg_advisory_xact_lock(4418);
do $canonical_guard$ begin
 if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.profiles') and conname='profiles_role_check' and contype='c' and convalidated and pg_get_constraintdef(oid)='CHECK ((role = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''mentor''::text])))') then raise exception 'pit requires the reviewed canonical five-role CHECK';end if;
 if exists(select 1 from public.profiles where role::text='admin') then raise exception 'Legacy Owner Admin account must be explicitly converted by Hub first';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pit_activate_event(jsonb)') and md5(pg_get_functiondef(oid))='61308608b153a0cd3005af8fdcca4224' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: public.pit_activate_event(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pit_competition_manage(text,jsonb)') and md5(pg_get_functiondef(oid))='901938ae96f70170d2cbb4fb1bf8613a' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: public.pit_competition_manage(text,jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('pit_private.competition_manager()') and md5(pg_get_functiondef(oid))='45aff54cb0789f3da59b072e362be688' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}') then raise exception 'Canonical role function/ACL drift: pit_private.competition_manager()';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('pit_private.scouting_context(uuid)') and md5(pg_get_functiondef(oid))='4448c251edf7d0567d3a995bc35231d4' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: pit_private.scouting_context(uuid)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('pit_private.scouting_manage(text,jsonb)') and md5(pg_get_functiondef(oid))='33fda1cc3b0e1bbf3b7019d94f0736bc' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: pit_private.scouting_manage(text,jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('pit_private.scouting_submit(jsonb)') and md5(pg_get_functiondef(oid))='b0a2486b58b9ce109c474f13ab5362dd' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: pit_private.scouting_submit(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pit_report_issue(jsonb)') and md5(pg_get_functiondef(oid))='26077f35f3acecfd04f66ef34c72f714' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: public.pit_report_issue(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pit_save_battery(jsonb)') and md5(pg_get_functiondef(oid))='3de31e7c6d91b3b16f5c2d640ecb9c5b' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: public.pit_save_battery(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pit_save_event(jsonb)') and md5(pg_get_functiondef(oid))='fa11170e4d0bf5dcc0af7ea5673a4872' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: public.pit_save_event(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pit_transition_battery(jsonb)') and md5(pg_get_functiondef(oid))='74fb5b55e546e45815188ebef8b575d1' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: public.pit_transition_battery(jsonb)';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pit_update_issue(jsonb)') and md5(pg_get_functiondef(oid))='8d85876af6de872c5773950f524c5b4f' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}') then raise exception 'Canonical role function/ACL drift: public.pit_update_issue(jsonb)';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_batteries' and policyname='pit_member_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''admin''::text, ''mentor''::text]))","roles":["authenticated"],"tablename":"pit_batteries","permissive":"PERMISSIVE","policyname":"pit_member_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_batteries.pit_member_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_battery_events' and policyname='pit_member_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''admin''::text, ''mentor''::text]))","roles":["authenticated"],"tablename":"pit_battery_events","permissive":"PERMISSIVE","policyname":"pit_member_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_battery_events.pit_member_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_events' and policyname='pit_member_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''admin''::text, ''mentor''::text]))","roles":["authenticated"],"tablename":"pit_events","permissive":"PERMISSIVE","policyname":"pit_member_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_events.pit_member_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_issue_events' and policyname='pit_member_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''admin''::text, ''mentor''::text]))","roles":["authenticated"],"tablename":"pit_issue_events","permissive":"PERMISSIVE","policyname":"pit_member_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_issue_events.pit_member_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_issues' and policyname='pit_member_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''admin''::text, ''mentor''::text]))","roles":["authenticated"],"tablename":"pit_issues","permissive":"PERMISSIVE","policyname":"pit_member_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_issues.pit_member_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_manual_match_events' and policyname='competition_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''mentor''::text, ''admin''::text]))","roles":["authenticated"],"tablename":"pit_manual_match_events","permissive":"PERMISSIVE","policyname":"competition_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_manual_match_events.competition_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_scouting_assignments' and policyname='scouting_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''mentor''::text, ''admin''::text]))","roles":["authenticated"],"tablename":"pit_scouting_assignments","permissive":"PERMISSIVE","policyname":"scouting_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_scouting_assignments.scouting_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_scouting_management_events' and policyname='scouting_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''mentor''::text, ''admin''::text]))","roles":["authenticated"],"tablename":"pit_scouting_management_events","permissive":"PERMISSIVE","policyname":"scouting_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_scouting_management_events.scouting_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_scouting_observations' and policyname='scouting_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''mentor''::text, ''admin''::text]))","roles":["authenticated"],"tablename":"pit_scouting_observations","permissive":"PERMISSIVE","policyname":"scouting_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_scouting_observations.scouting_read';end if;
 if (select to_jsonb(p) from pg_policies p where schemaname='public' and tablename='pit_scouting_picklist' and policyname='scouting_read') is distinct from '{"cmd":"SELECT","qual":"(( SELECT pit_private.\"current_role\"() AS \"current_role\") = ANY (ARRAY[''readonly''::text, ''student''::text, ''lead''::text, ''admin_lead''::text, ''mentor''::text, ''admin''::text]))","roles":["authenticated"],"tablename":"pit_scouting_picklist","permissive":"PERMISSIVE","policyname":"scouting_read","schemaname":"public","with_check":null}'::jsonb then raise exception 'Canonical role policy drift: pit_scouting_picklist.scouting_read';end if;
end $canonical_guard$;

CREATE OR REPLACE FUNCTION public.pit_activate_event(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pit_private.require_role(array['mentor']);
 perform pg_advisory_xact_lock(4418,2);
 if not exists(select 1 from public.pit_events where id=(p->>'id')::uuid) then raise exception 'Event not found'; end if;
 perform 1 from public.pit_events where status='active' or id=(p->>'id')::uuid order by id for update;
 -- Recheck current Mentor authority after business locks and hold it through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text='mentor' for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 update public.pit_events set status='completed',updated_at=clock_timestamp() where status='active' and id<>(p->>'id')::uuid;
 update public.pit_events set status='active',updated_at=clock_timestamp() where id=(p->>'id')::uuid;
end $function$
;
CREATE OR REPLACE FUNCTION public.pit_competition_manage(action text, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare eid uuid:=nullif(p->>'event_id','')::uuid;mid uuid:=nullif(p->>'match_id','')::uuid;rid uuid:=nullif(p->>'id','')::uuid;
 c public.pit_event_config;m public.pit_match_ops;t public.pit_checklist_templates;r public.pit_checklist_runs;i public.pit_checklist_run_items;
 item jsonb;idx integer:=0;bid uuid;issue public.pit_issues;new_id uuid;
 manual_name text;manual_time timestamptz;manual_note text;creation public.pit_manual_match_events;
 after_match jsonb;archive_target boolean;manual_action text;
begin
 perform pg_advisory_xact_lock(4418,30);
 perform pit_private.require_role(array['student','lead','admin_lead','mentor']);
 if action in ('config','template','match','manual_match','finish_manual_match','archive_manual_match') and not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 if action='template' then
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 60 then raise exception 'Add 1–60 checklist items';end if;
  for item in select value from jsonb_array_elements(p->'items') loop
   if length(trim(coalesce(item->>'text',''))) not between 1 and 300 or (item->>'required') is null or (item->>'blocking') is null then raise exception 'Valid checklist item required';end if;
   if nullif(item->>'area_id','') is not null and not exists(select 1 from public.areas where id=(item->>'area_id')::uuid and active) then raise exception 'Choose an active area';end if;
  end loop;
  if rid is null then
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   insert into public.pit_checklist_templates(name,description,kind,items,updated_by) values(trim(p->>'name'),coalesce(p->>'description',''),p->>'kind',p->'items',auth.uid()) returning id into rid;
  else
 -- BEGIN CURRENT AUTHORITY RECHECK
 perform 1 from public.pit_checklist_templates where id=rid for update;
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   update public.pit_checklist_templates set name=trim(p->>'name'),description=coalesce(p->>'description',''),kind=p->>'kind',items=p->'items',active=(p->>'active')::boolean,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=rid and version=(p->>'version')::int;
   if not found then raise exception 'Template changed. Refresh before saving';end if;
  end if;return rid;
 elsif action='item' then
  select * into i from public.pit_checklist_run_items where id=rid for update;
  if not found or i.version is distinct from (p->>'version')::int or p->>'complete' is null then raise exception 'Checklist item changed. Refresh before saving';end if;
  select * into r from public.pit_checklist_runs where id=i.run_id;
  perform 1 from public.pit_events where id=r.event_id and status='active' for share;if not found then raise exception 'Event is no longer active';end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
  update public.pit_checklist_run_items set completed_by=case when (p->>'complete')::boolean then auth.uid() end,completed_at=case when (p->>'complete')::boolean then clock_timestamp() end,version=version+1 where id=rid;return rid;
 end if;
 if mid is not null then select * into m from public.pit_match_ops where id=mid for update;if not found then raise exception 'Match operations not found';end if;if eid is not null and eid<>m.event_id then raise exception 'Match belongs to a different event';end if;eid:=m.event_id;end if;
 perform 1 from public.pit_events where id=eid and status='active' for share;
 if not found then raise exception 'Select the active Pit event';end if;
 select * into c from public.pit_event_config where event_id=eid for update;
 if action='config' then
  if found then
   if c.version is distinct from (p->>'version')::int then raise exception 'Configuration changed. Refresh before saving';end if;
   if (c.tba_event_key is distinct from p->>'tba_event_key' or c.team_number is distinct from (p->>'team_number')::int) and exists(select 1 from public.pit_match_ops where event_id=eid and source='tba') then raise exception 'This event already has match operations. Use a new event for another event/team';end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   update public.pit_event_config set team_number=(p->>'team_number')::int,tba_event_key=p->>'tba_event_key',nexus_event_key=nullif(p->>'nexus_event_key',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where event_id=eid;
  else
   if coalesce((p->>'version')::int,0)<>0 then raise exception 'Configuration changed';end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   insert into public.pit_event_config(event_id,team_number,tba_event_key,nexus_event_key,updated_by) values(eid,(p->>'team_number')::int,p->>'tba_event_key',nullif(p->>'nexus_event_key',''),auth.uid());
  end if;return eid;
 elsif action='manual_match' then
  if jsonb_typeof(p->'manual_label') is distinct from 'string' then raise exception 'Enter a practice label (1–80 characters)';end if;
  manual_name:=regexp_replace(p->>'manual_label','^\s+|\s+$','','g');
  if length(manual_name) not between 1 and 80 then raise exception 'Enter a practice label (1–80 characters)';end if;
  manual_time:=nullif(p->>'scheduled_at','')::timestamptz;
  if manual_time is not null and not isfinite(manual_time) then raise exception 'Enter a valid practice time';end if;
  if mid is null then
   if rid is null then raise exception 'A practice request ID is required';end if;
   manual_note:=coalesce(p->>'note','');
   -- The creation snapshot, rather than mutable current metadata, proves that a
   -- retry is the same actor/event/payload even after a later preparation edit.
   select * into m from public.pit_match_ops where id=rid for update;
   if found then
    select * into creation from public.pit_manual_match_events e where e.match_id=rid and e.action='created';
    if m.source<>'manual' or m.event_id<>eid or creation.performed_by is distinct from auth.uid()
      or creation.after_state->>'manual_label' is distinct from manual_name
      or (creation.after_state->>'scheduled_at')::timestamptz is distinct from manual_time
      or creation.after_state->>'note' is distinct from manual_note then raise exception 'Request ID already used';end if;
    return rid;
   end if;
   if exists(select 1 from public.pit_match_ops where event_id=eid and source='manual' and archived_at is null
     and lower(regexp_replace(manual_label,'\s+',' ','g'))=lower(regexp_replace(manual_name,'\s+',' ','g'))) then
    raise exception 'A practice with this label already exists in this event';
   end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   insert into public.pit_match_ops(id,event_id,match_key,source,manual_label,scheduled_at,note,updated_by)
     values(rid,eid,'manual:'||rid::text,'manual',manual_name,manual_time,manual_note,auth.uid()) returning to_jsonb(pit_match_ops) into after_match;
   insert into public.pit_manual_match_events(event_id,match_id,action,after_state,performed_by)
     values(eid,rid,'created',after_match,auth.uid());
   return rid;
  end if;
  if m.source<>'manual' then raise exception 'Select a manual practice match';end if;
  if m.archived_at is not null then raise exception 'Restore this practice before editing';end if;
  if m.version is distinct from (p->>'version')::int then raise exception 'Match operations changed. Refresh before saving';end if;
  if exists(select 1 from public.pit_match_ops where event_id=eid and source='manual' and archived_at is null and id<>mid
    and lower(regexp_replace(manual_label,'\s+',' ','g'))=lower(regexp_replace(manual_name,'\s+',' ','g'))) then
   raise exception 'A practice with this label already exists in this event';
  end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
  update public.pit_match_ops set manual_label=manual_name,scheduled_at=manual_time,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=mid returning to_jsonb(pit_match_ops) into after_match;
  insert into public.pit_manual_match_events(event_id,match_id,action,before_state,after_state,performed_by)
    values(eid,mid,'metadata_updated',to_jsonb(m),after_match,auth.uid());
  return mid;
 elsif action in ('finish_manual_match','archive_manual_match') then
  if mid is null or m.source<>'manual' then raise exception 'Select a manual practice match';end if;
  if m.version is distinct from (p->>'version')::int then raise exception 'Match operations changed. Refresh before saving';end if;
  if action='finish_manual_match' then
   if m.archived_at is not null then raise exception 'Restore this practice before finishing';end if;
   if m.finished_at is not null then raise exception 'Practice already finished';end if;
   -- Finishing records only the local lifecycle. It does not invent a score,
   -- complete checklist work, or install/remove/cool the assigned battery.
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   update public.pit_match_ops set finished_at=clock_timestamp(),finished_by=auth.uid(),
     version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=mid returning to_jsonb(pit_match_ops) into after_match;
   manual_action:='finished';
  else
   if jsonb_typeof(p->'archived') is distinct from 'boolean' then raise exception 'Choose archive or restore';end if;
   archive_target:=(p->>'archived')::boolean;
   if archive_target=(m.archived_at is not null) then return mid;end if;
   if not archive_target and exists(select 1 from public.pit_match_ops where event_id=eid and source='manual' and archived_at is null and id<>mid
     and lower(regexp_replace(manual_label,'\s+',' ','g'))=lower(regexp_replace(m.manual_label,'\s+',' ','g'))) then
    raise exception 'A practice with this label already exists in this event';
   end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   update public.pit_match_ops set archived_at=case when archive_target then clock_timestamp() end,
     archived_by=case when archive_target then auth.uid() end,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
     where id=mid returning to_jsonb(pit_match_ops) into after_match;
   manual_action:=case when archive_target then 'archived' else 'restored' end;
  end if;
  insert into public.pit_manual_match_events(event_id,match_id,action,before_state,after_state,performed_by)
    values(eid,mid,manual_action,to_jsonb(m),after_match,auth.uid());
  return mid;
 elsif action='match' then
  if (mid is null or m.source='tba') and c.event_id is null then raise exception 'Configure this event first';end if;
  if m.source='manual' and m.archived_at is not null then raise exception 'Restore this practice before editing';end if;
  if mid is null then
   if p->>'match_key' is null or p->>'match_key' !~ ('^'||c.tba_event_key||'_(qm[0-9]+|(ef|qf|sf|f)[0-9]+m[0-9]+)$') then raise exception 'Match key must belong to this event';end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   insert into public.pit_match_ops(event_id,match_key,updated_by) values(eid,p->>'match_key',auth.uid()) on conflict(event_id,match_key) do nothing;
   select * into m from public.pit_match_ops where event_id=eid and match_key=p->>'match_key';return m.id;
  end if;
  if m.version is distinct from (p->>'version')::int then raise exception 'Match operations changed. Refresh before saving';end if;
  bid:=nullif(p->>'battery_id','')::uuid;
  if bid is not null and not exists(select 1 from public.pit_batteries where id=bid and active and status<>'RETIRED') then raise exception 'Choose an active battery';end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
  update public.pit_match_ops set battery_id=bid,note=coalesce(p->>'note',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=mid;
  if bid is distinct from m.battery_id then
   if m.battery_id is not null then insert into public.pit_battery_events(battery_id,event_id,event_type,match_number,notes,performed_by) values(m.battery_id,eid,'metadata_updated',case when m.source='manual' then 'Manual: '||m.manual_label else m.match_key end,'Match assignment removed',auth.uid());end if;
   if bid is not null then insert into public.pit_battery_events(battery_id,event_id,event_type,match_number,notes,performed_by) values(bid,eid,'metadata_updated',case when m.source='manual' then 'Manual: '||m.manual_label else m.match_key end,'Assigned to match; physical battery status unchanged',auth.uid());end if;
  end if;
  if m.source='manual' then
   select to_jsonb(o) into after_match from public.pit_match_ops o where o.id=mid;
   insert into public.pit_manual_match_events(event_id,match_id,action,before_state,after_state,performed_by)
     values(eid,mid,'preparation_updated',to_jsonb(m),after_match,auth.uid());
  end if;return mid;
 elsif action='run' then
  select * into t from public.pit_checklist_templates where id=(p->>'template_id')::uuid and active for share;
  if not found or t.version is distinct from (p->>'template_version')::int then raise exception 'Template changed or archived. Refresh';end if;
  if t.kind<>'general' and mid is null then raise exception 'Select match operations first';end if;
  select * into r from public.pit_checklist_runs where id=rid;
  if found then if r.started_by<>auth.uid() or r.template_id<>t.id or r.event_id<>eid or r.match_id is distinct from mid then raise exception 'Request ID already used';end if;return rid;end if;
  -- Retried starts above return their original snapshot. New runs respect the
  -- current lifecycle. Archived finished practices may still need inspection;
  -- existing items always remain completable while the Pit event is active.
  if m.source='manual' then
   if m.archived_at is not null and not (m.finished_at is not null and t.kind='post') then raise exception 'Practice is archived';end if;
   if t.kind='pre' and m.finished_at is not null then raise exception 'Practice is finished. Start a post-match inspection';end if;
   if t.kind='post' and m.finished_at is null then raise exception 'Finish this practice before starting a post-match inspection';end if;
  end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
  insert into public.pit_checklist_runs(id,event_id,match_id,template_id,template_version,name,kind,started_by) values(rid,eid,mid,t.id,t.version,t.name,t.kind,auth.uid());
  for item in select value from jsonb_array_elements(t.items) loop
   insert into public.pit_checklist_run_items(run_id,text,display_order,required,blocking,area_id) values(rid,trim(item->>'text'),idx,(item->>'required')::boolean,(item->>'blocking')::boolean,nullif(item->>'area_id','')::uuid);idx:=idx+1;
  end loop;return rid;
 elsif action in ('link_issue','report_issue') then
  if mid is null then raise exception 'Select a match';end if;
  if action='report_issue' then
   new_id:=public.pit_report_issue(p||jsonb_build_object('event_id',eid,'discovered_match',case when m.source='manual' then 'Manual: '||m.manual_label else m.match_key end));
  else
   perform pit_private.require_role(array['lead','admin_lead','mentor']);new_id:=(p->>'issue_id')::uuid;
  end if;
  select * into issue from public.pit_issues where id=new_id and event_id=eid for update;if not found then raise exception 'Issue belongs to a different event';end if;
  if exists(select 1 from public.pit_issue_matches where issue_id=new_id and match_id<>mid) then raise exception 'Issue already associated with another match';end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if action='link_issue' then perform pit_private.require_role(array['lead','admin_lead','mentor']);end if;
 -- END CURRENT AUTHORITY RECHECK
  insert into public.pit_issue_matches(issue_id,match_id,linked_by) values(new_id,mid,auth.uid()) on conflict(issue_id) do nothing;
  if found then insert into public.pit_issue_events(issue_id,performed_by,changes) values(new_id,auth.uid(),jsonb_build_object('competition_match',jsonb_build_object('from',null,'to',m.match_key)));end if;return new_id;
 else raise exception 'Unknown competition action';end if;
end $function$
;
CREATE OR REPLACE FUNCTION pit_private.competition_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(pit_private.current_role() in ('mentor') or (pit_private.current_role() in ('student','lead','admin_lead') and exists(
 select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership'))),false)
$function$
;
CREATE OR REPLACE FUNCTION pit_private.scouting_context(event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pit_private.require_role(array['readonly','student','lead','admin_lead','mentor']);
 return jsonb_build_object(
  'can_scout',pit_private.current_role() in ('student','lead','admin_lead','mentor'),
  'can_manage',pit_private.competition_manager(),
  'observations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at,o.id),'[]'::jsonb) from public.pit_scouting_observations o where o.event_id=$1),
  'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.kind,case a.alliance when 'red' then 0 when 'blue' then 1 else 2 end,a.station,a.match_key,a.team_number,a.id),'[]'::jsonb) from public.pit_scouting_assignments a where a.event_id=$1),
  'picklist',(select coalesce(jsonb_agg(to_jsonb(p) order by p.rank,p.team_number),'[]'::jsonb) from public.pit_scouting_picklist p where p.event_id=$1)
 );
end $function$
;
CREATE OR REPLACE FUNCTION pit_private.scouting_manage(action text, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare eid uuid; team integer; key text; v_kind text; aid uuid; rid uuid; ver integer;
 v_alliance text; v_station integer; station_target boolean:=false;
 prior_assignment public.pit_scouting_assignments; prior_pick public.pit_scouting_picklist; before_value jsonb; after_value jsonb;
begin
 perform pit_private.require_role(array['student','lead','admin_lead','mentor']);
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Scouting management object required';end if;
 if action is null or action not in ('assignment','picklist') then raise exception 'Unknown scouting management action';end if;
 if exists(select 1 from jsonb_object_keys(p) k where not k=any(case when action='assignment' then array['event_id','kind','team_number','match_key','alliance','station','assignee_id','notes','version'] else array['event_id','team_number','rank','status','notes','version'] end)) then raise exception 'Unsupported scouting management fields';end if;
 eid:=(p->>'event_id')::uuid;
 if action='assignment' then
  v_kind:=p->>'kind';
  station_target:=coalesce(p->'alliance','null'::jsonb)<>'null'::jsonb or coalesce(p->'station','null'::jsonb)<>'null'::jsonb;
 end if;
 if station_target then
  if v_kind is distinct from 'match' then raise exception 'Driver station assignments must be match scouting';end if;
  if jsonb_typeof(p->'alliance') is distinct from 'string' or p->>'alliance' not in ('red','blue') then raise exception 'Driver station alliance must be red or blue';end if;
  if jsonb_typeof(p->'station') is distinct from 'number' then raise exception 'Driver station must be a whole number from 1 to 3';end if;
  if (p->>'station')::numeric<>trunc((p->>'station')::numeric) or (p->>'station')::numeric not between 1 and 3 then raise exception 'Driver station must be a whole number from 1 to 3';end if;
  if coalesce(p->'team_number','null'::jsonb)<>'null'::jsonb or coalesce(p->'match_key','null'::jsonb)<>'null'::jsonb then raise exception 'Driver station assignments cannot have a team number or match key';end if;
  v_alliance:=p->>'alliance';v_station:=(p->>'station')::numeric::integer;
 else
  if jsonb_typeof(p->'team_number') is distinct from 'number' then raise exception 'Team number must be a whole number from 1 to 99999';end if;
  if (p->>'team_number')::numeric<>trunc((p->>'team_number')::numeric) or (p->>'team_number')::numeric not between 1 and 99999 then raise exception 'Team number must be a whole number from 1 to 99999';end if;
  team:=(p->>'team_number')::integer;
 end if;
 if jsonb_typeof(p->'version') is distinct from 'number' then raise exception 'Scouting record changed. Refresh before saving';end if;
 if (p->>'version')::numeric<>trunc((p->>'version')::numeric) or (p->>'version')::numeric not between 0 and 2147483646 then raise exception 'Scouting record changed. Refresh before saving';end if;
 ver:=(p->>'version')::integer;
 if p?'notes' and (jsonb_typeof(p->'notes') is distinct from 'string' or length(p->>'notes')>2000) then raise exception 'Scouting notes must be at most 2000 characters';end if;
 perform pg_advisory_xact_lock(hashtextextended('pit-scouting-management:'||eid::text,0));
 -- Coordinate event identity with the existing configuration guard. Shared locks
 -- allow independent scouts to submit concurrently.
 perform pg_advisory_xact_lock_shared(hashtextextended('pit-scouting-event:'||eid::text,0));
 perform 1 from public.pit_events e where e.id=eid and e.status='active' for share;
 if not found then raise exception 'Select the active Pit event before managing scouting';end if;
 if action='assignment' then
  if not station_target then key:=pit_private.scouting_match_key(eid,v_kind,p->>'match_key');end if;
  aid:=nullif(p->>'assignee_id','')::uuid;
  if aid is not null and not exists(select 1 from public.profiles pr where pr.id=aid and pr.active and pr.role::text in ('student','lead','admin_lead','mentor')) then raise exception 'Assign an active scouting team member';end if;
  select * into prior_assignment from public.pit_scouting_assignments a
   where a.event_id=eid and a.kind=v_kind
    and ((station_target and a.alliance=v_alliance and a.station=v_station)
     or (not station_target and a.alliance is null and a.station is null and a.team_number=team and a.match_key is not distinct from key))
   for update;
  if found then
   if ver<>prior_assignment.version then raise exception 'Scouting assignment changed. Refresh before saving';end if;
   before_value:=to_jsonb(prior_assignment);
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   update public.pit_scouting_assignments set assignee_id=aid,notes=coalesce(p->>'notes',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=prior_assignment.id returning id,to_jsonb(pit_scouting_assignments) into rid,after_value;
  else
   if ver<>0 then raise exception 'Scouting assignment changed. Refresh before saving';end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   insert into public.pit_scouting_assignments(event_id,kind,team_number,match_key,alliance,station,assignee_id,notes,updated_by) values(eid,v_kind,team,key,v_alliance,v_station,aid,coalesce(p->>'notes',''),auth.uid()) returning id,to_jsonb(pit_scouting_assignments) into rid,after_value;
  end if;
 else
  if jsonb_typeof(p->'rank') is distinct from 'number' then raise exception 'Picklist rank must be a whole number from 1 to 99999';end if;
  if (p->>'rank')::numeric<>trunc((p->>'rank')::numeric) or (p->>'rank')::numeric not between 1 and 99999 then raise exception 'Picklist rank must be a whole number from 1 to 99999';end if;
  if p->>'status' is null or p->>'status' not in ('available','picked','avoid') then raise exception 'Invalid picklist status';end if;
  select * into prior_pick from public.pit_scouting_picklist l where l.event_id=eid and l.team_number=team for update;
  if found then
   if ver<>prior_pick.version then raise exception 'Picklist changed. Refresh before saving';end if;
   before_value:=to_jsonb(prior_pick);
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   update public.pit_scouting_picklist set rank=(p->>'rank')::integer,status=p->>'status',notes=coalesce(p->>'notes',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=prior_pick.id returning id,to_jsonb(pit_scouting_picklist) into rid,after_value;
  else
   if ver<>0 then raise exception 'Picklist changed. Refresh before saving';end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if pit_private.current_role() not in ('mentor') then
  perform 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
   where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership') for share of mp,tp;
 end if;
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
   insert into public.pit_scouting_picklist(event_id,team_number,rank,status,notes,updated_by) values(eid,team,(p->>'rank')::integer,p->>'status',coalesce(p->>'notes',''),auth.uid()) returning id,to_jsonb(pit_scouting_picklist) into rid,after_value;
  end if;
 end if;
 insert into public.pit_scouting_management_events(event_id,action,before_state,after_state,performed_by) values(eid,action,before_value,after_value,auth.uid());
 return rid;
end $function$
;
CREATE OR REPLACE FUNCTION pit_private.scouting_submit(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rid uuid; eid uuid; sid uuid; team integer; key text; v_kind text; scout uuid;
 receipt pit_private.scouting_receipts; prior public.pit_scouting_observations;
begin
 perform pit_private.require_role(array['student','lead','admin_lead','mentor']);
 if jsonb_typeof(p) is distinct from 'object' or p->>'id' is null then raise exception 'Scouting request ID required';end if;
 rid:=(p->>'id')::uuid;
 -- Same UUID is serialized before receipt lookup, including a dropped response.
 perform pg_advisory_xact_lock(hashtextextended('pit-scouting-request:'||rid::text,0));
 select * into receipt from pit_private.scouting_receipts r where r.id=rid;
 if found then
  if receipt.actor_id is distinct from auth.uid() or receipt.request_payload is distinct from p then raise exception 'Request ID already used with a different scouting payload or actor';end if;
  return rid;
 end if;
 if exists(select 1 from jsonb_object_keys(p) k where not k=any(array['id','event_id','kind','team_number','match_key','data','supersedes_id'])) then raise exception 'Unsupported scouting request fields';end if;
 eid:=(p->>'event_id')::uuid; v_kind:=p->>'kind'; sid:=nullif(p->>'supersedes_id','')::uuid;
 if jsonb_typeof(p->'team_number') is distinct from 'number' then raise exception 'Team number must be a whole number from 1 to 99999';end if;
 if (p->>'team_number')::numeric<>trunc((p->>'team_number')::numeric) or (p->>'team_number')::numeric not between 1 and 99999 then raise exception 'Team number must be a whole number from 1 to 99999';end if;
 team:=(p->>'team_number')::integer;
 -- Coordinate event identity with the configuration guard below. Shared locks
 -- allow independent scouts to submit concurrently.
 perform pg_advisory_xact_lock_shared(hashtextextended('pit-scouting-event:'||eid::text,0));
 perform 1 from public.pit_events e where e.id=eid and e.status='active' for share;
 if not found then raise exception 'Select the active Pit event before submitting scouting';end if;
 key:=pit_private.scouting_match_key(eid,v_kind,p->>'match_key');
 perform pit_private.validate_scouting_data(v_kind,p->'data');
 scout:=auth.uid();
 if sid is not null then
  select * into prior from public.pit_scouting_observations o where o.id=sid for update;
  if not found then raise exception 'Scouting observation to correct was not found';end if;
  if prior.event_id<>eid or prior.kind<>v_kind or prior.team_number<>team or prior.match_key is distinct from key then raise exception 'Correction must keep the same event, team and match identity';end if;
  if prior.scout_id<>auth.uid() and not pit_private.competition_manager() then raise exception 'Only the original scout or active competition leadership may correct this observation' using errcode='42501';end if;
  if exists(select 1 from public.pit_scouting_observations o where o.supersedes_id=sid) then raise exception 'Observation already corrected. Refresh before submitting another correction';end if;
  scout:=prior.scout_id;
 elsif exists(select 1 from public.pit_scouting_observations o where o.event_id=eid and o.kind=v_kind and o.team_number=team and o.match_key is not distinct from key and o.scout_id=scout and o.supersedes_id is null) then
  raise exception 'You already submitted this team and match. Correct the existing observation';
 end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if sid is not null and prior.scout_id<>auth.uid() and not pit_private.competition_manager() then raise exception 'Only the original scout or active competition leadership may correct this observation' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
 insert into public.pit_scouting_observations(id,event_id,kind,team_number,match_key,data,supersedes_id,scout_id,created_by)
 values(rid,eid,v_kind,team,key,p->'data',sid,scout,auth.uid());
 insert into pit_private.scouting_receipts(id,actor_id,request_payload) values(rid,auth.uid(),p);
 return rid;
exception when unique_violation then
 raise exception 'Scouting observation already submitted or corrected. Refresh before submitting';
end $function$
;
CREATE OR REPLACE FUNCTION public.pit_report_issue(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_event uuid:=(p->>'event_id')::uuid; v_battery uuid:=nullif(p->>'battery_id','')::uuid;
begin
 perform pit_private.require_role(array['student','lead','admin_lead','mentor']);
 perform 1 from public.pit_events where id=v_event and status='active' for share;
 if not found then raise exception 'Select the active event before reporting an issue'; end if;
 if v_battery is not null and not exists(select 1 from public.pit_batteries where id=v_battery and active) then raise exception 'Battery is unavailable'; end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
 insert into public.pit_issues(event_id,title,subsystem,severity,description,reported_by,discovered_match,battery_id)
 values(v_event,left(trim(p->>'description'),100),p->>'subsystem',p->>'severity',trim(p->>'description'),auth.uid(),coalesce(p->>'discovered_match',''),v_battery) returning id into v_id;
 insert into public.pit_issue_events(issue_id,performed_by,changes) values(v_id,auth.uid(),jsonb_build_object('status',jsonb_build_object('from',null,'to','OPEN')));
 if v_battery is not null then insert into public.pit_battery_events(battery_id,event_id,event_type,issue_id,performed_by) values(v_battery,v_event,'issue_linked',v_id,auth.uid()); end if;
 return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.pit_save_battery(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=nullif(p->>'id','')::uuid; b public.pit_batteries;
begin
 perform pit_private.require_role(array['mentor']);
 if v_id is null then
 -- Recheck current Mentor authority after business locks and hold it through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text='mentor' for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 insert into public.pit_batteries(battery_number,label,notes) values(upper(trim(p->>'battery_number')),coalesce(p->>'label',''),coalesce(p->>'notes','')) returning id into v_id;
 insert into public.pit_battery_events(battery_id,event_type,to_status,performed_by) values(v_id,'created','TESTING',auth.uid());
 else
 select * into b from public.pit_batteries where id=v_id for update;
 if not found then raise exception 'Battery not found'; end if;
 if p->>'active'='false' and b.status<>'RETIRED' then raise exception 'Retire the battery before archiving it'; end if;
 -- Recheck current Mentor authority after business locks and hold it through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text='mentor' for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 update public.pit_batteries set battery_number=upper(trim(p->>'battery_number')),label=coalesce(p->>'label',''),notes=coalesce(p->>'notes',''),active=coalesce((p->>'active')::boolean,active),updated_at=clock_timestamp() where id=v_id;
 insert into public.pit_battery_events(battery_id,event_type,notes,performed_by) values(v_id,'metadata_updated','Battery details updated',auth.uid());
 end if;return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.pit_save_event(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=nullif(p->>'id','')::uuid;
begin
 perform pit_private.require_role(array['mentor']);
 if v_id is null then
 -- Recheck current Mentor authority after business locks and hold it through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text='mentor' for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 insert into public.pit_events(name,location,start_date,end_date,notes,created_by) values(trim(p->>'name'),coalesce(p->>'location',''),(p->>'start_date')::date,(p->>'end_date')::date,coalesce(p->>'notes',''),auth.uid()) returning id into v_id;
 else
 if p?'status' and p->>'status'<>'completed' then raise exception 'Use Activate event to change the active event'; end if;
 perform 1 from public.pit_events where id=v_id for update;
 if not found then raise exception 'Event not found';end if;
 -- Recheck current Mentor authority after business locks and hold it through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text='mentor' for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 update public.pit_events set name=trim(p->>'name'),location=coalesce(p->>'location',''),start_date=(p->>'start_date')::date,end_date=(p->>'end_date')::date,notes=coalesce(p->>'notes',''),status=coalesce(p->>'status',status),updated_at=clock_timestamp() where id=v_id;
 if not found then raise exception 'Event not found'; end if;
 end if; return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.pit_transition_battery(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.pit_batteries; target text:=p->>'status'; v_event uuid:=nullif(p->>'event_id','')::uuid; v_voltage numeric:=nullif(p->>'voltage','')::numeric;
begin
 perform pit_private.require_role(array['student','lead','admin_lead','mentor']);
 -- Serialize installs so another device cannot silently replace the current battery.
 perform pg_advisory_xact_lock(4418,1);
 select * into b from public.pit_batteries where id=(p->>'id')::uuid for update;
 if not found then raise exception 'Battery not found'; end if;
 if b.status is distinct from p->>'expected_status' then raise exception 'Battery status changed. Refresh and try again.'; end if;
 if not b.active then raise exception 'Reactivate this battery before changing its status'; end if;
 if b.status='RETIRED' or target='RETIRED' then perform pit_private.require_role(array['mentor']); end if;
 if b.status='FLAGGED' and target<>'FLAGGED' then perform pit_private.require_role(array['lead','admin_lead','mentor']); end if;
 if target='ON ROBOT' and exists(select 1 from public.pit_batteries where status='ON ROBOT' and id<>b.id) then raise exception 'Remove the current battery before installing another.'; end if;
 if v_event is not null then
 perform 1 from public.pit_events where id=v_event and status='active' for share;
 if not found then raise exception 'Event changed. Refresh and try again.'; end if; end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['student','lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 if b.status='RETIRED' or target='RETIRED' then perform pit_private.require_role(array['mentor']);end if;
 if b.status='FLAGGED' and target<>'FLAGGED' then perform pit_private.require_role(array['lead','admin_lead','mentor']);end if;
 -- END CURRENT AUTHORITY RECHECK
 update public.pit_batteries set status=target,updated_at=clock_timestamp() where id=b.id;
 insert into public.pit_battery_events(battery_id,event_id,event_type,from_status,to_status,voltage,voltage_kind,match_number,notes,performed_by)
 values(b.id,v_event,case when target=b.status then 'measurement' else 'status_changed' end,b.status,target,v_voltage,case when v_voltage is null then null else p->>'voltage_kind' end,coalesce(p->>'match_number',''),coalesce(p->>'notes',''),auth.uid());
end $function$
;
CREATE OR REPLACE FUNCTION public.pit_update_issue(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old_row public.pit_issues; new_row public.pit_issues; changes jsonb:='{}'; k text;
begin
 perform pit_private.require_role(array['lead','admin_lead','mentor']);
 select * into old_row from public.pit_issues where id=(p->>'id')::uuid for update;
 if not found then raise exception 'Issue not found'; end if;
 if old_row.updated_at is distinct from (p->>'expected_updated_at')::timestamptz then raise exception 'This issue changed on another device. Close and reopen it before saving.'; end if;
 if nullif(p->>'assigned_to','') is not null and not exists(select 1 from public.profiles where id=(p->>'assigned_to')::uuid and active) then raise exception 'Assignee must be an active team member'; end if;
 -- BEGIN CURRENT AUTHORITY RECHECK
 -- Recheck after blocking business locks; hold current actor authority through commit.
 perform 1 from public.profiles where id=auth.uid() and active and role::text=any(array['lead','admin_lead','mentor']) for share;
 if not found then raise exception 'Insufficient Pit Operations permissions' using errcode='42501';end if;
 -- END CURRENT AUTHORITY RECHECK
 update public.pit_issues set title=coalesce(p->>'title',title),severity=coalesce(p->>'severity',severity),status=coalesce(p->>'status',status),
 assigned_to=case when p?'assigned_to' then nullif(p->>'assigned_to','')::uuid else assigned_to end,
 battery_id=case when p?'battery_id' then nullif(p->>'battery_id','')::uuid else battery_id end,
 root_cause=coalesce(p->>'root_cause',root_cause),repair_notes=coalesce(p->>'repair_notes',repair_notes),resolution_notes=coalesce(p->>'resolution_notes',resolution_notes),
 resolved_at=case when coalesce(p->>'status',status)='RESOLVED' then coalesce(resolved_at,clock_timestamp()) else null end,
 resolved_by=case when coalesce(p->>'status',status)='RESOLVED' then coalesce(resolved_by,auth.uid()) else null end,updated_at=clock_timestamp()
 where id=old_row.id returning * into new_row;
 foreach k in array array['title','severity','status','assigned_to','battery_id','root_cause','repair_notes','resolution_notes'] loop
 if (to_jsonb(old_row)->k) is distinct from (to_jsonb(new_row)->k) then changes:=changes||jsonb_build_object(k,jsonb_build_object('from',to_jsonb(old_row)->k,'to',to_jsonb(new_row)->k)); end if;
 end loop;
 if changes<>'{}' then insert into public.pit_issue_events(issue_id,performed_by,changes) values(old_row.id,auth.uid(),changes); end if;
 if new_row.battery_id is not null and new_row.battery_id is distinct from old_row.battery_id then
 insert into public.pit_battery_events(battery_id,event_id,event_type,issue_id,performed_by) values(new_row.battery_id,new_row.event_id,'issue_linked',new_row.id,auth.uid()); end if;
end $function$
;
alter policy pit_member_read on public.pit_batteries using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy pit_member_read on public.pit_battery_events using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy pit_member_read on public.pit_events using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy pit_member_read on public.pit_issue_events using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy pit_member_read on public.pit_issues using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy competition_read on public.pit_manual_match_events using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy scouting_read on public.pit_scouting_assignments using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy scouting_read on public.pit_scouting_management_events using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy scouting_read on public.pit_scouting_observations using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

alter policy scouting_read on public.pit_scouting_picklist using ((( SELECT pit_private."current_role"() AS "current_role") = ANY (ARRAY['readonly'::text, 'student'::text, 'lead'::text, 'admin_lead'::text, 'mentor'::text])));

do $canonical_verify$ begin
 if md5(pg_get_functiondef('public.pit_activate_event(jsonb)'::regprocedure))<>'1f457af2e646a11a91b8e6f6b790ff02' then raise exception 'Canonical role output mismatch: public.pit_activate_event(jsonb)';end if;
 if md5(pg_get_functiondef('public.pit_competition_manage(text,jsonb)'::regprocedure))<>'7bff6b6c8991487306885de1679685dd' then raise exception 'Canonical role output mismatch: public.pit_competition_manage(text,jsonb)';end if;
 if md5(pg_get_functiondef('pit_private.competition_manager()'::regprocedure))<>'511d4c123e2b467c23f413153bdb5155' then raise exception 'Canonical role output mismatch: pit_private.competition_manager()';end if;
 if md5(pg_get_functiondef('pit_private.scouting_context(uuid)'::regprocedure))<>'458556f5e4d87ec97b58d562d6047d9c' then raise exception 'Canonical role output mismatch: pit_private.scouting_context(uuid)';end if;
 if md5(pg_get_functiondef('pit_private.scouting_manage(text,jsonb)'::regprocedure))<>'3c413db2ba450a7a755400b75249bd0c' then raise exception 'Canonical role output mismatch: pit_private.scouting_manage(text,jsonb)';end if;
 if md5(pg_get_functiondef('pit_private.scouting_submit(jsonb)'::regprocedure))<>'06844eded7ed2f6cc913dd2cd2836cd5' then raise exception 'Canonical role output mismatch: pit_private.scouting_submit(jsonb)';end if;
 if md5(pg_get_functiondef('public.pit_report_issue(jsonb)'::regprocedure))<>'eb486feff49d58dfa2a51b9cdda8227d' then raise exception 'Canonical role output mismatch: public.pit_report_issue(jsonb)';end if;
 if md5(pg_get_functiondef('public.pit_save_battery(jsonb)'::regprocedure))<>'9ebab3c54d347bcd1e28204dede0e619' then raise exception 'Canonical role output mismatch: public.pit_save_battery(jsonb)';end if;
 if md5(pg_get_functiondef('public.pit_save_event(jsonb)'::regprocedure))<>'063b2f83d571805f3d84328d596fc4c6' then raise exception 'Canonical role output mismatch: public.pit_save_event(jsonb)';end if;
 if md5(pg_get_functiondef('public.pit_transition_battery(jsonb)'::regprocedure))<>'6e3944fc06b4c14a85a0d85504ddefda' then raise exception 'Canonical role output mismatch: public.pit_transition_battery(jsonb)';end if;
 if md5(pg_get_functiondef('public.pit_update_issue(jsonb)'::regprocedure))<>'081153466497d0cba6a3731bfe8b0912' then raise exception 'Canonical role output mismatch: public.pit_update_issue(jsonb)';end if;
end $canonical_verify$;
commit;
