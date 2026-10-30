-- Additive, independently implemented IMPULSE scouting. Existing Inventory,
-- profile authorization, competition, checklist and battery APIs are unchanged.
begin;

-- Versioned observation schemas are deliberately game-specific. Unknown ratings
-- are JSON null, not zero. Counts are observations, never official FRC scores.
create function pit_private.validate_scouting_data(kind text, data jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; allowed text[];
begin
 if jsonb_typeof(data) is distinct from 'object' or data->'schema_version' is distinct from '1'::jsonb then
  raise exception 'Scouting schema version 1 required';
 end if;
 if kind='match' then
  allowed:=array['schema_version','match_label','alliance','station','start_position','auto_fuel','teleop_fuel','auto_climb','endgame','accuracy','role','traversal','intake','driver','defense','disabled','no_show','notes'];
 elsif kind='pit' then
  allowed:=array['schema_version','drive','intake','capacity','traversal','climb','auto_notes','notes'];
 else raise exception 'Scouting kind must be match or pit';end if;
 if not data ?& allowed or exists(select 1 from jsonb_object_keys(data) key where not key=any(allowed)) then
  raise exception 'Scouting data has missing or unsupported fields';
 end if;
 foreach k in array case when kind='match' then array['notes','match_label'] else array['notes','auto_notes'] end loop
  if jsonb_typeof(data->k) is distinct from 'string' or length(data->>k)>2000 then raise exception 'Scouting text must be at most 2000 characters';end if;
 end loop;
 if kind='match' and length(btrim(data->>'match_label')) not between 1 and 100 then raise exception 'Match label must be 1–100 characters';end if;
 foreach k in array case when kind='match' then array['auto_fuel','teleop_fuel'] else array['capacity'] end loop
  if data->k='null'::jsonb then continue;end if;
  if jsonb_typeof(data->k) is distinct from 'number' then raise exception 'Scouting counts must be whole numbers or null';end if;
  if (data->>k)::numeric<>trunc((data->>k)::numeric) or (data->>k)::numeric not between 0 and (case when k='capacity' then 200 else 999 end) then
   raise exception 'Scouting count out of range';
  end if;
 end loop;
 if data->>'intake' not in ('unknown','ground','outpost','both','neither') or jsonb_typeof(data->'intake') is distinct from 'string'
  or data->>'traversal' not in ('unknown','trench','bump','both','none') or jsonb_typeof(data->'traversal') is distinct from 'string' then raise exception 'Invalid scouting intake or traversal';end if;
 if kind='match' then
  foreach k in array array['driver','defense','station'] loop
   if data->k<>'null'::jsonb then
    if jsonb_typeof(data->k) is distinct from 'number' then raise exception 'Scouting rating or station must be numeric or null';end if;
    if (data->>k)::numeric<>trunc((data->>k)::numeric) or (data->>k)::numeric not between 1 and (case when k='station' then 3 else 5 end) then raise exception 'Scouting rating or station out of range';end if;
   end if;
  end loop;
  if jsonb_typeof(data->'disabled') is distinct from 'boolean' or jsonb_typeof(data->'no_show') is distinct from 'boolean' then raise exception 'Scouting flags must be boolean';end if;
  if data->>'alliance' not in ('red','blue','unknown') or jsonb_typeof(data->'alliance') is distinct from 'string'
   or data->>'start_position' not in ('trench','bump','hub','unknown') or jsonb_typeof(data->'start_position') is distinct from 'string'
   or data->>'auto_climb' not in ('unknown','not_attempted','failed','succeeded') or jsonb_typeof(data->'auto_climb') is distinct from 'string'
   or data->>'endgame' not in ('unknown','not_attempted','failed','L1','L2','L3') or jsonb_typeof(data->'endgame') is distinct from 'string'
   or data->>'accuracy' not in ('unknown','under50','50to60','60to70','70to80','80to90','90to100') or jsonb_typeof(data->'accuracy') is distinct from 'string'
   or data->>'role' not in ('unknown','cycling','scoring','feeding','defending','immobile') or jsonb_typeof(data->'role') is distinct from 'string' then raise exception 'Invalid match scouting choice';end if;
 else
  if data->>'drive' not in ('unknown','swerve','tank','other') or jsonb_typeof(data->'drive') is distinct from 'string'
   or data->>'climb' not in ('unknown','none','L1','L2','L3') or jsonb_typeof(data->'climb') is distinct from 'string' then raise exception 'Invalid pit scouting choice';end if;
 end if;
 return true;
end $$;

create function pit_private.scouting_match_key(event_id uuid,kind text,raw_key text)
returns text language plpgsql stable set search_path='' as $$
declare key text:=nullif(lower(btrim(raw_key)),''); prefix text; parts text[];
begin
 if kind='pit' then
  if key is not null then raise exception 'Pit scouting cannot have a match key';end if;
  return null;
 end if;
 if kind is distinct from 'match' or key is null or length(key)>120 then raise exception 'Valid match key required';end if;
 -- Official event-prefixed and shorthand keys identify the same event match.
 if key ~ '^[0-9]{4}[a-z0-9]+_' then
  prefix:=split_part(key,'_',1);
  if not exists(select 1 from public.pit_event_config c where c.event_id=$1 and c.tba_event_key=prefix) then raise exception 'Match key belongs to a different or unconfigured event';end if;
  key:=substr(key,length(prefix)+2);
 end if;
 if key ~ '^(qm|p)[0-9]{1,6}$' then
  parts:=regexp_match(key,'^(qm|p)([0-9]+)$');
  if parts[2]::integer<1 then raise exception 'Match number must be positive';end if;
  return parts[1]||parts[2]::integer::text;
 elsif key ~ '^(ef|qf|sf|f)[0-9]{1,4}m[0-9]{1,4}$' then
  parts:=regexp_match(key,'^(ef|qf|sf|f)([0-9]+)m([0-9]+)$');
  if parts[2]::integer<1 or parts[3]::integer<1 then raise exception 'Match number must be positive';end if;
  return parts[1]||parts[2]::integer::text||'m'||parts[3]::integer::text;
 elsif key ~ '^practice:[a-z0-9][a-z0-9_.:-]{0,59}$' then return key;
 elsif key ~ '^manual:[0-9a-f-]{36}$' then
  if not exists(select 1 from public.pit_match_ops m where m.event_id=$1 and m.match_key=key and m.source='manual') then raise exception 'Manual match belongs to a different event or does not exist';end if;
  return key;
 end if;
 raise exception 'Use a qualification, playoff or practice match key';
end $$;

create table public.pit_scouting_observations(
 id uuid primary key,
 event_id uuid not null references public.pit_events(id),
 kind text not null check(kind in ('match','pit')),
 team_number integer not null check(team_number between 1 and 99999),
 match_key text,
 data jsonb not null check(pit_private.validate_scouting_data(kind,data)),
 supersedes_id uuid unique references public.pit_scouting_observations(id),
 scout_id uuid not null references public.profiles(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 check((kind='pit' and match_key is null) or (kind='match' and match_key is not null and length(match_key) between 1 and 120)),
 check(supersedes_id is distinct from id)
);
-- One original report per scout/robot/match. Extra observations by other scouts
-- are retained as independent evidence. Corrections form a single append-only chain.
create unique index pit_scouting_original_slot on public.pit_scouting_observations(event_id,kind,team_number,coalesce(match_key,''),scout_id) where supersedes_id is null;
create index pit_scouting_event_team on public.pit_scouting_observations(event_id,team_number,created_at);
create index pit_scouting_observer on public.pit_scouting_observations(scout_id);
create index pit_scouting_creator on public.pit_scouting_observations(created_by);

create table pit_private.scouting_receipts(
 id uuid primary key references public.pit_scouting_observations(id),
 actor_id uuid not null references public.profiles(id),
 request_payload jsonb not null
);
create index pit_scouting_receipt_actor on pit_private.scouting_receipts(actor_id);
alter table pit_private.scouting_receipts enable row level security;
revoke all on pit_private.scouting_receipts from public,anon,authenticated;

create table public.pit_scouting_assignments(
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.pit_events(id),
 kind text not null check(kind in ('match','pit')),
 team_number integer not null check(team_number between 1 and 99999),
 match_key text,
 assignee_id uuid references public.profiles(id),
 notes text not null default '' check(length(notes)<=2000),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default clock_timestamp(),
 check((kind='pit' and match_key is null) or (kind='match' and match_key is not null and length(match_key) between 1 and 120))
);
create unique index pit_scouting_assignment_slot on public.pit_scouting_assignments(event_id,kind,team_number,coalesce(match_key,''));
create index pit_scouting_assignment_scout on public.pit_scouting_assignments(assignee_id);
create index pit_scouting_assignment_updater on public.pit_scouting_assignments(updated_by);
create table public.pit_scouting_picklist(
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.pit_events(id),
 team_number integer not null check(team_number between 1 and 99999),
 rank integer not null check(rank between 1 and 99999),
 status text not null default 'available' check(status in ('available','picked','avoid')),
 notes text not null default '' check(length(notes)<=2000),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default clock_timestamp(),
 unique(event_id,team_number)
);
create index pit_scouting_picklist_updater on public.pit_scouting_picklist(updated_by);
create table public.pit_scouting_management_events(
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.pit_events(id),
 action text not null check(action in ('assignment','picklist')),
 before_state jsonb,
 after_state jsonb not null,
 performed_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp()
);
create index pit_scouting_management_history on public.pit_scouting_management_events(event_id,created_at);
create index pit_scouting_management_actor on public.pit_scouting_management_events(performed_by);

create function pit_private.scouting_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Submitted scouting records are immutable; submit a correction instead';end $$;
create trigger pit_scouting_immutable before update or delete on public.pit_scouting_observations for each row execute function pit_private.scouting_immutable();
create trigger pit_scouting_receipt_immutable before update or delete on pit_private.scouting_receipts for each row execute function pit_private.scouting_immutable();
create trigger pit_scouting_management_immutable before update or delete on public.pit_scouting_management_events for each row execute function pit_private.scouting_immutable();

do $$ declare t text;begin
 foreach t in array array['pit_scouting_observations','pit_scouting_assignments','pit_scouting_picklist','pit_scouting_management_events'] loop
  execute format('alter table public.%I enable row level security',t);
  -- Hosted projects may automatically grant all privileges on new public tables.
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy scouting_read on public.%I for select to authenticated using ((select pit_private.current_role()) in (''readonly'',''student'',''lead'',''mentor'',''admin''))',t);
 end loop;
end $$;

-- Privileged implementations live outside the exposed API schema. Thin invoker
-- wrappers below expose exactly three operations; every operation rechecks the
-- existing trusted active profile/leadership helpers, never JWT user metadata.
create function pit_private.scouting_context(event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform pit_private.require_role(array['readonly','student','lead','mentor','admin']);
 return jsonb_build_object(
  'can_scout',pit_private.current_role() in ('student','lead','mentor','admin'),
  'can_manage',pit_private.competition_manager(),
  'observations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at,o.id),'[]'::jsonb) from public.pit_scouting_observations o where o.event_id=$1),
  'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.kind,a.match_key,a.team_number),'[]'::jsonb) from public.pit_scouting_assignments a where a.event_id=$1),
  'picklist',(select coalesce(jsonb_agg(to_jsonb(p) order by p.rank,p.team_number),'[]'::jsonb) from public.pit_scouting_picklist p where p.event_id=$1)
 );
end $$;

create function pit_private.scouting_submit(p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid; eid uuid; sid uuid; team integer; key text; v_kind text; scout uuid;
 receipt pit_private.scouting_receipts; prior public.pit_scouting_observations;
begin
 perform pit_private.require_role(array['student','lead','mentor','admin']);
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
 insert into public.pit_scouting_observations(id,event_id,kind,team_number,match_key,data,supersedes_id,scout_id,created_by)
 values(rid,eid,v_kind,team,key,p->'data',sid,scout,auth.uid());
 insert into pit_private.scouting_receipts(id,actor_id,request_payload) values(rid,auth.uid(),p);
 return rid;
exception when unique_violation then
 raise exception 'Scouting observation already submitted or corrected. Refresh before submitting';
end $$;

create function pit_private.scouting_manage(action text,p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare eid uuid; team integer; key text; v_kind text; aid uuid; rid uuid; ver integer;
 prior_assignment public.pit_scouting_assignments; prior_pick public.pit_scouting_picklist; before_value jsonb; after_value jsonb;
begin
 perform pit_private.require_role(array['student','lead','mentor','admin']);
 if not pit_private.competition_manager() then raise exception 'Active competition leadership required' using errcode='42501';end if;
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Scouting management object required';end if;
 if action is null or action not in ('assignment','picklist') then raise exception 'Unknown scouting management action';end if;
 if exists(select 1 from jsonb_object_keys(p) k where not k=any(case when action='assignment' then array['event_id','kind','team_number','match_key','assignee_id','notes','version'] else array['event_id','team_number','rank','status','notes','version'] end)) then raise exception 'Unsupported scouting management fields';end if;
 eid:=(p->>'event_id')::uuid;
 if jsonb_typeof(p->'team_number') is distinct from 'number' then raise exception 'Team number must be a whole number from 1 to 99999';end if;
 if (p->>'team_number')::numeric<>trunc((p->>'team_number')::numeric) or (p->>'team_number')::numeric not between 1 and 99999 then raise exception 'Team number must be a whole number from 1 to 99999';end if;
 team:=(p->>'team_number')::integer;
 if jsonb_typeof(p->'version') is distinct from 'number' then raise exception 'Scouting record changed. Refresh before saving';end if;
 if (p->>'version')::numeric<>trunc((p->>'version')::numeric) or (p->>'version')::numeric not between 0 and 2147483646 then raise exception 'Scouting record changed. Refresh before saving';end if;
 ver:=(p->>'version')::integer;
 if p?'notes' and (jsonb_typeof(p->'notes') is distinct from 'string' or length(p->>'notes')>2000) then raise exception 'Scouting notes must be at most 2000 characters';end if;
 perform pg_advisory_xact_lock(hashtextextended('pit-scouting-management:'||eid::text,0));
 -- Coordinate event identity with the configuration guard below. Shared locks
 -- allow independent scouts to submit concurrently.
 perform pg_advisory_xact_lock_shared(hashtextextended('pit-scouting-event:'||eid::text,0));
 perform 1 from public.pit_events e where e.id=eid and e.status='active' for share;
 if not found then raise exception 'Select the active Pit event before managing scouting';end if;
 if action='assignment' then
  v_kind:=p->>'kind';key:=pit_private.scouting_match_key(eid,v_kind,p->>'match_key');aid:=nullif(p->>'assignee_id','')::uuid;
  if aid is not null and not exists(select 1 from public.profiles pr where pr.id=aid and pr.active and pr.role::text in ('student','lead','mentor','admin')) then raise exception 'Assign an active scouting team member';end if;
  select * into prior_assignment from public.pit_scouting_assignments a where a.event_id=eid and a.kind=v_kind and a.team_number=team and a.match_key is not distinct from key for update;
  if found then
   if ver<>prior_assignment.version then raise exception 'Scouting assignment changed. Refresh before saving';end if;
   before_value:=to_jsonb(prior_assignment);
   update public.pit_scouting_assignments set assignee_id=aid,notes=coalesce(p->>'notes',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=prior_assignment.id returning id,to_jsonb(pit_scouting_assignments) into rid,after_value;
  else
   if ver<>0 then raise exception 'Scouting assignment changed. Refresh before saving';end if;
   insert into public.pit_scouting_assignments(event_id,kind,team_number,match_key,assignee_id,notes,updated_by) values(eid,v_kind,team,key,aid,coalesce(p->>'notes',''),auth.uid()) returning id,to_jsonb(pit_scouting_assignments) into rid,after_value;
  end if;
 else
  if jsonb_typeof(p->'rank') is distinct from 'number' then raise exception 'Picklist rank must be a whole number from 1 to 99999';end if;
  if (p->>'rank')::numeric<>trunc((p->>'rank')::numeric) or (p->>'rank')::numeric not between 1 and 99999 then raise exception 'Picklist rank must be a whole number from 1 to 99999';end if;
  if p->>'status' is null or p->>'status' not in ('available','picked','avoid') then raise exception 'Invalid picklist status';end if;
  select * into prior_pick from public.pit_scouting_picklist l where l.event_id=eid and l.team_number=team for update;
  if found then
   if ver<>prior_pick.version then raise exception 'Picklist changed. Refresh before saving';end if;
   before_value:=to_jsonb(prior_pick);
   update public.pit_scouting_picklist set rank=(p->>'rank')::integer,status=p->>'status',notes=coalesce(p->>'notes',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=prior_pick.id returning id,to_jsonb(pit_scouting_picklist) into rid,after_value;
  else
   if ver<>0 then raise exception 'Picklist changed. Refresh before saving';end if;
   insert into public.pit_scouting_picklist(event_id,team_number,rank,status,notes,updated_by) values(eid,team,(p->>'rank')::integer,p->>'status',coalesce(p->>'notes',''),auth.uid()) returning id,to_jsonb(pit_scouting_picklist) into rid,after_value;
  end if;
 end if;
 insert into public.pit_scouting_management_events(event_id,action,before_state,after_state,performed_by) values(eid,action,before_value,after_value,auth.uid());
 return rid;
end $$;

-- Once scouting refers to this local event, rebinding its external identity
-- would silently mix different competitions. Configuration metadata and initial
-- configuration remain editable; existing public API bodies are untouched.
create function pit_private.scouting_event_identity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.tba_event_key is distinct from old.tba_event_key then
  perform pg_advisory_xact_lock(hashtextextended('pit-scouting-event:'||old.event_id::text,0));
  if exists(select 1 from public.pit_scouting_observations o where o.event_id=old.event_id)
   or exists(select 1 from public.pit_scouting_assignments a where a.event_id=old.event_id)
   or exists(select 1 from public.pit_scouting_picklist p where p.event_id=old.event_id) then
   raise exception 'This event already has scouting data. Use a new event for a different competition';
  end if;
 end if;
 return new;
end $$;
create trigger pit_scouting_event_identity before update on public.pit_event_config for each row execute function pit_private.scouting_event_identity_guard();
revoke all on function pit_private.scouting_event_identity_guard() from public,anon,authenticated;

create function public.pit_scouting_context(event_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$ select pit_private.scouting_context($1) $$;
create function public.pit_scouting_submit(p jsonb) returns uuid language sql security invoker set search_path='' as $$ select pit_private.scouting_submit($1) $$;
create function public.pit_scouting_manage(action text,p jsonb) returns uuid language sql security invoker set search_path='' as $$ select pit_private.scouting_manage($1,$2) $$;
revoke all on function pit_private.validate_scouting_data(text,jsonb),pit_private.scouting_match_key(uuid,text,text),pit_private.scouting_immutable(),pit_private.scouting_context(uuid),pit_private.scouting_submit(jsonb),pit_private.scouting_manage(text,jsonb),public.pit_scouting_context(uuid),public.pit_scouting_submit(jsonb),public.pit_scouting_manage(text,jsonb) from public,anon,authenticated;
grant execute on function pit_private.scouting_context(uuid),pit_private.scouting_submit(jsonb),pit_private.scouting_manage(text,jsonb),public.pit_scouting_context(uuid),public.pit_scouting_submit(jsonb),public.pit_scouting_manage(text,jsonb) to authenticated;
commit;
