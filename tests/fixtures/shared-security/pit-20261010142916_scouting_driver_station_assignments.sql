-- Event-scoped Red 1–3 / Blue 1–3 scout coverage. Preserve all legacy match,
-- pit and audit rows; a historical match number cannot identify a driver station.
begin;

alter table public.pit_scouting_assignments
 add column alliance text,
 add column station integer,
 alter column team_number drop not null,
 drop constraint pit_scouting_assignments_check,
 add constraint pit_scouting_assignment_target check (
  (alliance is null and station is null and team_number is not null
   and ((kind='pit' and match_key is null)
    or (kind='match' and match_key is not null and length(match_key) between 1 and 120)))
  or
  (kind='match' and team_number is null and match_key is null
   and alliance is not null and alliance in ('red','blue')
   and station is not null and station between 1 and 3)
 );

-- A slot has one row (including a cleared assignee). Different stations may
-- intentionally share a scout. Keep the original legacy target unique index.
create unique index pit_scouting_assignment_driver_station
 on public.pit_scouting_assignments(event_id,kind,alliance,station)
 where station is not null;

create or replace function pit_private.scouting_context(event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform pit_private.require_role(array['readonly','student','lead','mentor','admin']);
 return jsonb_build_object(
  'can_scout',pit_private.current_role() in ('student','lead','mentor','admin'),
  'can_manage',pit_private.competition_manager(),
  'observations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at,o.id),'[]'::jsonb) from public.pit_scouting_observations o where o.event_id=$1),
  'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.kind,case a.alliance when 'red' then 0 when 'blue' then 1 else 2 end,a.station,a.match_key,a.team_number,a.id),'[]'::jsonb) from public.pit_scouting_assignments a where a.event_id=$1),
  'picklist',(select coalesce(jsonb_agg(to_jsonb(p) order by p.rank,p.team_number),'[]'::jsonb) from public.pit_scouting_picklist p where p.event_id=$1)
 );
end $$;

create or replace function pit_private.scouting_manage(action text,p jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare eid uuid; team integer; key text; v_kind text; aid uuid; rid uuid; ver integer;
 v_alliance text; v_station integer; station_target boolean:=false;
 prior_assignment public.pit_scouting_assignments; prior_pick public.pit_scouting_picklist; before_value jsonb; after_value jsonb;
begin
 perform pit_private.require_role(array['student','lead','mentor','admin']);
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
  if aid is not null and not exists(select 1 from public.profiles pr where pr.id=aid and pr.active and pr.role::text in ('student','lead','mentor','admin')) then raise exception 'Assign an active scouting team member';end if;
  select * into prior_assignment from public.pit_scouting_assignments a
   where a.event_id=eid and a.kind=v_kind
    and ((station_target and a.alliance=v_alliance and a.station=v_station)
     or (not station_target and a.alliance is null and a.station is null and a.team_number=team and a.match_key is not distinct from key))
   for update;
  if found then
   if ver<>prior_assignment.version then raise exception 'Scouting assignment changed. Refresh before saving';end if;
   before_value:=to_jsonb(prior_assignment);
   update public.pit_scouting_assignments set assignee_id=aid,notes=coalesce(p->>'notes',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=prior_assignment.id returning id,to_jsonb(pit_scouting_assignments) into rid,after_value;
  else
   if ver<>0 then raise exception 'Scouting assignment changed. Refresh before saving';end if;
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
   update public.pit_scouting_picklist set rank=(p->>'rank')::integer,status=p->>'status',notes=coalesce(p->>'notes',''),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=prior_pick.id returning id,to_jsonb(pit_scouting_picklist) into rid,after_value;
  else
   if ver<>0 then raise exception 'Picklist changed. Refresh before saving';end if;
   insert into public.pit_scouting_picklist(event_id,team_number,rank,status,notes,updated_by) values(eid,team,(p->>'rank')::integer,p->>'status',coalesce(p->>'notes',''),auth.uid()) returning id,to_jsonb(pit_scouting_picklist) into rid,after_value;
  end if;
 end if;
 insert into public.pit_scouting_management_events(event_id,action,before_state,after_state,performed_by) values(eid,action,before_value,after_value,auth.uid());
 return rid;
end $$;

-- CREATE OR REPLACE keeps existing privileges; state the narrow grants again
-- so the upgrade is safe under permissive hosted-project default privileges.
revoke all on function pit_private.scouting_manage(text,jsonb),pit_private.scouting_context(uuid) from public,anon,authenticated;
grant execute on function pit_private.scouting_manage(text,jsonb),pit_private.scouting_context(uuid) to authenticated;

-- Existing public invoker wrappers, table RLS/read grants, observation APIs,
-- picklist validation and append-only management audit protections are unchanged.
commit;
