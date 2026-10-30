-- Public Match13 predictions only. A single row serializes requests globally,
-- including event/config changes, across browsers and Edge Function instances.
-- Private scouting/operations data, credentials and raw responses never belong
-- in this cache. Browsers must use the authenticated competition-feed endpoint.
create table public.pit_match13_cache (
  singleton boolean primary key default true check (singleton),
  event_key text not null check (event_key ~ '^[0-9]{4}[a-z0-9]{1,40}$'),
  payload jsonb,
  etag text check (etag is null or octet_length(etag) <= 512),
  fetched_at bigint check (fetched_at > 0 and fetched_at <= 9007199254740991),
  error text check (error = 'Match13 backup unavailable'),
  next_refresh_at bigint not null default 0
    check (next_refresh_at between 0 and 9007199254740991),
  lease_token uuid,
  constraint pit_match13_cache_public_array check (
    case when payload is null then true
      when jsonb_typeof(payload) = 'array' then
        jsonb_array_length(payload) <= 2000 and octet_length(payload::text) <= 1048576
      else false end
  ),
  constraint pit_match13_cache_snapshot check (
    (payload is null and fetched_at is null and etag is null)
    or (payload is not null and fetched_at is not null)
  )
);

alter table public.pit_match13_cache enable row level security;
revoke all on table public.pit_match13_cache from public, anon, authenticated, service_role;
grant select, insert, update on table public.pit_match13_cache to service_role;

create function public.pit_match13_claim(event_key text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snapshot public.pit_match13_cache%rowtype;
  now_ms bigint;
  claimed boolean := false;
  token uuid;
begin
  if event_key is null or event_key !~ '^[0-9]{4}[a-z0-9]{1,40}$' then
    raise exception 'Invalid Match13 event' using errcode = '22023';
  end if;

  insert into public.pit_match13_cache (singleton, event_key)
  values (true, pit_match13_claim.event_key)
  on conflict (singleton) do nothing;

  select c.* into strict snapshot
  from public.pit_match13_cache c where c.singleton = true for update;
  -- Read the wall clock after taking the lock, not the transaction start time.
  now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  if snapshot.next_refresh_at <= now_ms then
    token := gen_random_uuid();
    update public.pit_match13_cache c set
      event_key = pit_match13_claim.event_key,
      payload = case when c.event_key = pit_match13_claim.event_key then c.payload else null end,
      etag = case when c.event_key = pit_match13_claim.event_key then c.etag else null end,
      fetched_at = case when c.event_key = pit_match13_claim.event_key then c.fetched_at else null end,
      error = case when c.event_key = pit_match13_claim.event_key then c.error else null end,
      next_refresh_at = now_ms + 60000,
      lease_token = token
    where c.singleton = true
    returning c.* into snapshot;
    claimed := true;
  end if;

  return jsonb_build_object(
    'claimed', claimed,
    'token', case when claimed then token::text else null end,
    'event', pit_match13_claim.event_key,
    'data', case when snapshot.event_key = pit_match13_claim.event_key then snapshot.payload else null end,
    'etag', case when snapshot.event_key = pit_match13_claim.event_key then snapshot.etag else null end,
    'at', case when snapshot.event_key = pit_match13_claim.event_key then snapshot.fetched_at else null end,
    'error', case when snapshot.event_key = pit_match13_claim.event_key then snapshot.error else null end,
    'until', snapshot.next_refresh_at
  );
end;
$$;

create function public.pit_match13_finish(
  event_key text,
  lease_token text,
  payload jsonb,
  response_etag text,
  fetched_at bigint,
  retry_at bigint,
  failure text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snapshot public.pit_match13_cache%rowtype;
  now_ms bigint;
  prediction jsonb;
  seen_keys text[] := array[]::text[];
begin
  select c.* into snapshot from public.pit_match13_cache c
  where c.singleton = true for update;
  -- Token equality is deliberately text equality: malformed or stale tokens
  -- are harmless no-ops, and cannot overwrite a newer lease or another event.
  if not found or snapshot.event_key is distinct from pit_match13_finish.event_key
    or snapshot.lease_token is null
    or snapshot.lease_token::text is distinct from pit_match13_finish.lease_token then
    return false;
  end if;

  now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  if retry_at is null or retry_at < 0 or retry_at > 9007199254740991 then
    raise exception 'Invalid Match13 retry time' using errcode = '22023';
  end if;

  if failure is null then
    if fetched_at is null or fetched_at <= 0 or fetched_at > now_ms + 60000 then
      raise exception 'Invalid Match13 fetch time' using errcode = '22023';
    end if;
    if response_etag is not null and octet_length(response_etag) > 512 then
      raise exception 'Invalid Match13 ETag' using errcode = '22023';
    end if;
    if payload is null or jsonb_typeof(payload) is distinct from 'array' then
      raise exception 'Invalid Match13 payload' using errcode = '22023';
    end if;
    if jsonb_array_length(payload) > 2000 or octet_length(payload::text) > 1048576 then
      raise exception 'Invalid Match13 payload size' using errcode = '22023';
    end if;

    for prediction in select value from jsonb_array_elements(payload) loop
      if jsonb_typeof(prediction) is distinct from 'object'
        or not (prediction ?& array['event', 'key', 'teams', 'redWinProbability'])
        or (prediction - array['event', 'key', 'teams', 'redWinProbability']) <> '{}'::jsonb
        or prediction->>'event' is distinct from event_key
        or jsonb_typeof(prediction->'key') is distinct from 'string'
        or prediction->>'key' !~ ('^' || event_key || '_(qm[1-9][0-9]*|(ef|qf|sf|f)[1-9][0-9]*m[1-9][0-9]*)$')
        or prediction->>'key' = any(seen_keys) then
        raise exception 'Invalid Match13 prediction identity' using errcode = '22023';
      end if;
      seen_keys := array_append(seen_keys, prediction->>'key');
      if jsonb_typeof(prediction->'teams') is distinct from 'array' then
        raise exception 'Invalid Match13 roster' using errcode = '22023';
      end if;
      if jsonb_array_length(prediction->'teams') <> 6
        or exists (
          select 1 from jsonb_array_elements(prediction->'teams') team
          where jsonb_typeof(team) <> 'string' or team #>> '{}' !~ '^[1-9][0-9]{0,4}$'
        ) or (select count(distinct team) from jsonb_array_elements(prediction->'teams') team) <> 6 then
        raise exception 'Invalid Match13 roster' using errcode = '22023';
      end if;
      if prediction->'redWinProbability' <> 'null'::jsonb then
        if jsonb_typeof(prediction->'redWinProbability') is distinct from 'number' then
          raise exception 'Invalid Match13 probability' using errcode = '22023';
        end if;
        if (prediction->>'redWinProbability')::numeric not between 0 and 1 then
          raise exception 'Invalid Match13 probability' using errcode = '22023';
        end if;
      end if;
    end loop;
  end if;

  update public.pit_match13_cache c set
    payload = case when failure is null then pit_match13_finish.payload else c.payload end,
    etag = case when failure is null then response_etag else c.etag end,
    fetched_at = case when failure is null then pit_match13_finish.fetched_at else c.fetched_at end,
    error = case when failure is null then null else 'Match13 backup unavailable' end,
    next_refresh_at = greatest(c.next_refresh_at, retry_at),
    lease_token = null
  where c.singleton = true;
  return true;
end;
$$;

revoke all on function public.pit_match13_claim(text) from public, anon, authenticated;
revoke all on function public.pit_match13_finish(text, text, jsonb, text, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.pit_match13_claim(text) to service_role;
grant execute on function public.pit_match13_finish(text, text, jsonb, text, bigint, bigint, text) to service_role;

comment on table public.pit_match13_cache is
  'Service-only singleton quota gate and normalized public Match13 predictions. No credentials or private team data.';
