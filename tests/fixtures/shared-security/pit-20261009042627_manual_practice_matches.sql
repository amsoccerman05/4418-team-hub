-- Manual practice matches are local Pit operations, independent of TBA/Nexus configuration.
-- Existing official rows keep their identity, preparation, runs, and history.
begin;

alter table public.pit_match_ops
  add column source text not null default 'tba',
  add column manual_label text,
  add column scheduled_at timestamptz,
  add column finished_at timestamptz,
  add column finished_by uuid references public.profiles(id),
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id),
  drop constraint pit_match_ops_event_id_fkey,
  add constraint pit_match_ops_event_id_fkey foreign key(event_id) references public.pit_events(id),
  add constraint pit_match_ops_source_check check(source in ('tba','manual')),
  add constraint pit_match_ops_manual_label_check check(manual_label is null or
    (length(manual_label) between 1 and 80 and manual_label=regexp_replace(manual_label,'^\s+|\s+$','','g'))),
  add constraint pit_match_ops_manual_identity_check check(
    (source='manual' and manual_label is not null and match_key='manual:'||id::text) or
    (source='tba' and match_key not like 'manual:%' and manual_label is null and scheduled_at is null
      and finished_at is null and finished_by is null and archived_at is null and archived_by is null)),
  add constraint pit_match_ops_finished_actor_check check((finished_at is null)=(finished_by is null)),
  add constraint pit_match_ops_archived_actor_check check((archived_at is null)=(archived_by is null)),
  add constraint pit_match_ops_scheduled_at_check check(scheduled_at is null or isfinite(scheduled_at));

-- Case and repeated whitespace do not distinguish active practice labels. Archived
-- records retain their label/history; restoring must also respect this uniqueness.
create unique index pit_manual_active_label on public.pit_match_ops
  (event_id,lower(regexp_replace(manual_label,'\s+',' ','g')))
  where source='manual' and archived_at is null;

create table public.pit_manual_match_events(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pit_events(id),
  match_id uuid not null references public.pit_match_ops(id),
  action text not null check(action in ('created','metadata_updated','preparation_updated','finished','archived','restored')),
  before_state jsonb,
  after_state jsonb not null,
  performed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create index pit_manual_match_history on public.pit_manual_match_events(match_id,created_at desc);
create index pit_manual_event_history on public.pit_manual_match_events(event_id,created_at desc);
create unique index pit_manual_creation_request on public.pit_manual_match_events(match_id) where action='created';
alter table public.pit_manual_match_events enable row level security;
revoke all on public.pit_manual_match_events from public,anon,authenticated;
grant select on public.pit_manual_match_events to authenticated;
create policy competition_read on public.pit_manual_match_events for select to authenticated
  using ((select pit_private.current_role()) in ('readonly','student','lead','mentor','admin'));

create function pit_private.preserve_manual_match_history() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Manual match history is append-only';
end $$;
revoke all on function pit_private.preserve_manual_match_history() from public,anon,authenticated;
create trigger pit_manual_history_append_only before update or delete on public.pit_manual_match_events
  for each row execute function pit_private.preserve_manual_match_history();

create or replace function public.pit_competition_context(event_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if pit_private.current_role() is null then raise exception 'Active team account required' using errcode='42501';end if;
 return jsonb_build_object('can_manage',pit_private.competition_manager(),'manual_matches_enabled',true,
 'config',(select to_jsonb(c) from public.pit_event_config c where c.event_id=$1),
 'matches',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.pit_match_ops m where m.event_id=$1),
 'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.pit_checklist_templates t),
 'runs',(select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc),'[]') from public.pit_checklist_runs r where r.event_id=$1),
 'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.display_order),'[]') from public.pit_checklist_run_items i join public.pit_checklist_runs r on r.id=i.run_id where r.event_id=$1),
 'links',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.pit_issue_matches l join public.pit_match_ops m on m.id=l.match_id where m.event_id=$1),
 'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) order by a.name),'[]') from public.areas a where a.active));
end $$;
create or replace function public.pit_competition_manage(action text,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid:=nullif(p->>'event_id','')::uuid;mid uuid:=nullif(p->>'match_id','')::uuid;rid uuid:=nullif(p->>'id','')::uuid;
 c public.pit_event_config;m public.pit_match_ops;t public.pit_checklist_templates;r public.pit_checklist_runs;i public.pit_checklist_run_items;
 item jsonb;idx integer:=0;bid uuid;issue public.pit_issues;new_id uuid;
 manual_name text;manual_time timestamptz;manual_note text;creation public.pit_manual_match_events;
 after_match jsonb;archive_target boolean;manual_action text;
begin
 perform pg_advisory_xact_lock(4418,30);
 perform pit_private.require_role(array['student','lead','mentor','admin']);
 if action in ('config','template','match','manual_match','finish_manual_match','archive_manual_match') and not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 if action='template' then
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 60 then raise exception 'Add 1–60 checklist items';end if;
  for item in select value from jsonb_array_elements(p->'items') loop
   if length(trim(coalesce(item->>'text',''))) not between 1 and 300 or (item->>'required') is null or (item->>'blocking') is null then raise exception 'Valid checklist item required';end if;
   if nullif(item->>'area_id','') is not null and not exists(select 1 from public.areas where id=(item->>'area_id')::uuid and active) then raise exception 'Choose an active area';end if;
  end loop;
  if rid is null then
   insert into public.pit_checklist_templates(name,description,kind,items,updated_by) values(trim(p->>'name'),coalesce(p->>'description',''),p->>'kind',p->'items',auth.uid()) returning id into rid;
  else
   update public.pit_checklist_templates set name=trim(p->>'name'),description=coalesce(p->>'description',''),kind=p->>'kind',items=p->'items',active=(p->>'active')::boolean,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=rid and version=(p->>'version')::int;
   if not found then raise exception 'Template changed. Refresh before saving';end if;
  end if;return rid;
 elsif action='item' then
  select * into i from public.pit_checklist_run_items where id=rid for update;
  if not found or i.version is distinct from (p->>'version')::int or p->>'complete' is null then raise exception 'Checklist item changed. Refresh before saving';end if;
  select * into r from public.pit_checklist_runs where id=i.run_id;
  perform 1 from public.pit_events where id=r.event_id and status='active' for share;if not found then raise exception 'Event is no longer active';end if;
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
   update public.pit_event_config set team_number=(p->>'team_number')::int,tba_event_key=p->>'tba_event_key',nexus_event_key=nullif(p->>'nexus_event_key',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where event_id=eid;
  else
   if coalesce((p->>'version')::int,0)<>0 then raise exception 'Configuration changed';end if;
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
   insert into public.pit_match_ops(event_id,match_key,updated_by) values(eid,p->>'match_key',auth.uid()) on conflict(event_id,match_key) do nothing;
   select * into m from public.pit_match_ops where event_id=eid and match_key=p->>'match_key';return m.id;
  end if;
  if m.version is distinct from (p->>'version')::int then raise exception 'Match operations changed. Refresh before saving';end if;
  bid:=nullif(p->>'battery_id','')::uuid;
  if bid is not null and not exists(select 1 from public.pit_batteries where id=bid and active and status<>'RETIRED') then raise exception 'Choose an active battery';end if;
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
  insert into public.pit_checklist_runs(id,event_id,match_id,template_id,template_version,name,kind,started_by) values(rid,eid,mid,t.id,t.version,t.name,t.kind,auth.uid());
  for item in select value from jsonb_array_elements(t.items) loop
   insert into public.pit_checklist_run_items(run_id,text,display_order,required,blocking,area_id) values(rid,trim(item->>'text'),idx,(item->>'required')::boolean,(item->>'blocking')::boolean,nullif(item->>'area_id','')::uuid);idx:=idx+1;
  end loop;return rid;
 elsif action in ('link_issue','report_issue') then
  if mid is null then raise exception 'Select a match';end if;
  if action='report_issue' then
   new_id:=public.pit_report_issue(p||jsonb_build_object('event_id',eid,'discovered_match',case when m.source='manual' then 'Manual: '||m.manual_label else m.match_key end));
  else
   perform pit_private.require_role(array['lead','mentor','admin']);new_id:=(p->>'issue_id')::uuid;
  end if;
  select * into issue from public.pit_issues where id=new_id and event_id=eid for update;if not found then raise exception 'Issue belongs to a different event';end if;
  if exists(select 1 from public.pit_issue_matches where issue_id=new_id and match_id<>mid) then raise exception 'Issue already associated with another match';end if;
  insert into public.pit_issue_matches(issue_id,match_id,linked_by) values(new_id,mid,auth.uid()) on conflict(issue_id) do nothing;
  if found then insert into public.pit_issue_events(issue_id,performed_by,changes) values(new_id,auth.uid(),jsonb_build_object('competition_match',jsonb_build_object('from',null,'to',m.match_key)));end if;return new_id;
 else raise exception 'Unknown competition action';end if;
end $$;
-- CREATE OR REPLACE retains existing ACLs; make the authenticated-only RPC
-- boundary explicit and keep all new history writes behind the checked RPC.
revoke all on function public.pit_competition_context(uuid),public.pit_competition_manage(text,jsonb) from public,anon,authenticated;
grant execute on function public.pit_competition_context(uuid),public.pit_competition_manage(text,jsonb) to authenticated;
commit;
