-- Additive Competition Operations V1. No existing Pit rows/functions are rewritten.
begin;
create function pit_private.competition_manager() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(pit_private.current_role() in ('mentor','admin') or (pit_private.current_role() in ('student','lead') and exists(
 select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=auth.uid() and mp.revoked_at is null and tp.category in ('Program','Functional Leads','Other Leadership'))),false)
$$;
create table public.pit_event_config(
 event_id uuid primary key references public.pit_events(id),team_number integer not null default 4418 check(team_number between 1 and 99999),
 tba_event_key text not null check(tba_event_key ~ '^[0-9]{4}[a-z0-9]{1,40}$'),nexus_event_key text check(nexus_event_key ~ '^[A-Za-z0-9_-]{1,60}$'),
 version integer not null default 1,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default clock_timestamp()
);
create table public.pit_match_ops(
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.pit_event_config(event_id),match_key text not null,
 battery_id uuid references public.pit_batteries(id),note text not null default '' check(length(note)<=2000),version integer not null default 1,
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default clock_timestamp(),unique(event_id,match_key)
);
create table public.pit_checklist_templates(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 120),description text not null default '' check(length(description)<=1000),
 kind text not null check(kind in ('pre','post','general')),active boolean not null default true,version integer not null default 1,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 60),updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default clock_timestamp()
);
create table public.pit_checklist_runs(
 id uuid primary key,event_id uuid not null references public.pit_events(id),match_id uuid references public.pit_match_ops(id),template_id uuid not null references public.pit_checklist_templates(id),
 template_version integer not null,name text not null,kind text not null,started_by uuid not null references public.profiles(id),started_at timestamptz not null default clock_timestamp()
);
create table public.pit_checklist_run_items(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.pit_checklist_runs(id),text text not null,display_order integer not null,
 required boolean not null,blocking boolean not null,area_id uuid references public.areas(id),completed_by uuid references public.profiles(id),completed_at timestamptz,version integer not null default 1,
 check((completed_by is null)=(completed_at is null)),unique(run_id,display_order)
);
create table public.pit_issue_matches(issue_id uuid primary key references public.pit_issues(id),match_id uuid not null references public.pit_match_ops(id),linked_by uuid not null references public.profiles(id),linked_at timestamptz not null default clock_timestamp());
create index pit_match_battery on public.pit_match_ops(battery_id);
create index pit_run_event on public.pit_checklist_runs(event_id);
create index pit_issue_match on public.pit_issue_matches(match_id);
do $$ declare t text;begin
 foreach t in array array['pit_event_config','pit_match_ops','pit_checklist_templates','pit_checklist_runs','pit_checklist_run_items','pit_issue_matches'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy competition_read on public.%I for select to authenticated using(pit_private.current_role() is not null)',t);
 end loop;
end $$;
create function public.pit_competition_context(event_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if pit_private.current_role() is null then raise exception 'Active team account required' using errcode='42501';end if;
 return jsonb_build_object('can_manage',pit_private.competition_manager(),
 'config',(select to_jsonb(c) from public.pit_event_config c where c.event_id=$1),
 'matches',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.pit_match_ops m where m.event_id=$1),
 'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.pit_checklist_templates t),
 'runs',(select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc),'[]') from public.pit_checklist_runs r where r.event_id=$1),
 'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.display_order),'[]') from public.pit_checklist_run_items i join public.pit_checklist_runs r on r.id=i.run_id where r.event_id=$1),
 'links',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.pit_issue_matches l join public.pit_match_ops m on m.id=l.match_id where m.event_id=$1),
 'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) order by a.name),'[]') from public.areas a where a.active));
end $$;
create function public.pit_competition_manage(action text,p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid:=nullif(p->>'event_id','')::uuid;mid uuid:=nullif(p->>'match_id','')::uuid;rid uuid:=nullif(p->>'id','')::uuid;
 c public.pit_event_config;m public.pit_match_ops;t public.pit_checklist_templates;r public.pit_checklist_runs;i public.pit_checklist_run_items;
 item jsonb;idx integer:=0;bid uuid;issue public.pit_issues;new_id uuid;
begin
 perform pg_advisory_xact_lock(4418,30);
 perform pit_private.require_role(array['student','lead','mentor','admin']);
 if action in ('config','template','match') and not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
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
 if mid is not null then select * into m from public.pit_match_ops where id=mid for update;if not found then raise exception 'Match operations not found';end if;eid:=m.event_id;end if;
 perform 1 from public.pit_events where id=eid and status='active' for share;
 if not found then raise exception 'Select the active Pit event';end if;
 select * into c from public.pit_event_config where event_id=eid for update;
 if action='config' then
  if found then
   if c.version is distinct from (p->>'version')::int then raise exception 'Configuration changed. Refresh before saving';end if;
   if (c.tba_event_key is distinct from p->>'tba_event_key' or c.team_number is distinct from (p->>'team_number')::int) and exists(select 1 from public.pit_match_ops where event_id=eid) then raise exception 'This event already has match operations. Use a new event for another event/team';end if;
   update public.pit_event_config set team_number=(p->>'team_number')::int,tba_event_key=p->>'tba_event_key',nexus_event_key=nullif(p->>'nexus_event_key',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where event_id=eid;
  else
   if coalesce((p->>'version')::int,0)<>0 then raise exception 'Configuration changed';end if;
   insert into public.pit_event_config(event_id,team_number,tba_event_key,nexus_event_key,updated_by) values(eid,(p->>'team_number')::int,p->>'tba_event_key',nullif(p->>'nexus_event_key',''),auth.uid());
  end if;return eid;
 elsif action='match' then
  if c.event_id is null then raise exception 'Configure this event first';end if;
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
   if m.battery_id is not null then insert into public.pit_battery_events(battery_id,event_id,event_type,match_number,notes,performed_by) values(m.battery_id,eid,'metadata_updated',m.match_key,'Match assignment removed',auth.uid());end if;
   if bid is not null then insert into public.pit_battery_events(battery_id,event_id,event_type,match_number,notes,performed_by) values(bid,eid,'metadata_updated',m.match_key,'Assigned to match; physical battery status unchanged',auth.uid());end if;
  end if;return mid;
 elsif action='run' then
  select * into t from public.pit_checklist_templates where id=(p->>'template_id')::uuid and active for share;
  if not found or t.version is distinct from (p->>'template_version')::int then raise exception 'Template changed or archived. Refresh';end if;
  if t.kind<>'general' and mid is null then raise exception 'Select match operations first';end if;
  select * into r from public.pit_checklist_runs where id=rid;
  if found then if r.started_by<>auth.uid() or r.template_id<>t.id or r.event_id<>eid or r.match_id is distinct from mid then raise exception 'Request ID already used';end if;return rid;end if;
  insert into public.pit_checklist_runs(id,event_id,match_id,template_id,template_version,name,kind,started_by) values(rid,eid,mid,t.id,t.version,t.name,t.kind,auth.uid());
  for item in select value from jsonb_array_elements(t.items) loop
   insert into public.pit_checklist_run_items(run_id,text,display_order,required,blocking,area_id) values(rid,trim(item->>'text'),idx,(item->>'required')::boolean,(item->>'blocking')::boolean,nullif(item->>'area_id','')::uuid);idx:=idx+1;
  end loop;return rid;
 elsif action in ('link_issue','report_issue') then
  if mid is null then raise exception 'Select a match';end if;
  if action='report_issue' then
   new_id:=public.pit_report_issue(p||jsonb_build_object('event_id',eid,'discovered_match',m.match_key));
  else
   perform pit_private.require_role(array['lead','mentor','admin']);new_id:=(p->>'issue_id')::uuid;
  end if;
  select * into issue from public.pit_issues where id=new_id and event_id=eid for update;if not found then raise exception 'Issue belongs to a different event';end if;
  if exists(select 1 from public.pit_issue_matches where issue_id=new_id and match_id<>mid) then raise exception 'Issue already associated with another match';end if;
  insert into public.pit_issue_matches(issue_id,match_id,linked_by) values(new_id,mid,auth.uid()) on conflict(issue_id) do nothing;
  if found then insert into public.pit_issue_events(issue_id,performed_by,changes) values(new_id,auth.uid(),jsonb_build_object('competition_match',jsonb_build_object('from',null,'to',m.match_key)));end if;return new_id;
 else raise exception 'Unknown competition action';end if;
end $$;
revoke all on function pit_private.competition_manager(),public.pit_competition_context(uuid),public.pit_competition_manage(text,jsonb) from public,anon,authenticated;
grant execute on function public.pit_competition_context(uuid),public.pit_competition_manage(text,jsonb) to authenticated;
commit;
