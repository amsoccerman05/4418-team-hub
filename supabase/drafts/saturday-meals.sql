-- LOCAL REVIEW DRAFT ONLY. Not a migration; never applied to a remote project.
-- Requires existing public.profiles(id, role, active), auth.uid(), and Supabase roles.
-- Keep meals_private OUT of PostgREST exposed schemas. No new roles or credentials.
begin;
create schema meals_private;
revoke all on schema meals_private from public, anon, authenticated, service_role;
-- PostgreSQL's default PUBLIC function grant is global: a per-schema default
-- REVOKE cannot remove it. Every function is explicitly revoked before COMMIT
-- below; additions must extend this same atomic revoke/grant block.
alter default privileges in schema meals_private revoke all on tables from public, anon, authenticated, service_role;

create table meals_private.meals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120 and title !~ '[[:cntrl:]]'),
  service_at timestamptz not null check (isfinite(service_at)),
  timezone text not null check (length(timezone) between 1 and 80),
  expected_headcount integer not null check (expected_headcount between 1 and 1000),
  guidance text not null default '' check (length(guidance) <= 2000),
  status text not null check (status in ('open','closed','cancelled')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table meals_private.slots (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals_private.meals(id),
  label text not null check (length(btrim(label)) between 1 and 100 and label !~ '[[:cntrl:]]'),
  category text not null check (category in ('main','side','drink','supply','other')),
  unit text not null check (length(btrim(unit)) between 1 and 40 and unit !~ '[[:cntrl:]]'),
  needed integer not null check (needed between 1 and 1000),
  active boolean not null default true,
  unique (id, meal_id)
);
create table meals_private.parent_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
  email text not null check (length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default clock_timestamp()
);
create table meals_private.claims (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals_private.meals(id),
  slot_id uuid,
  contact_id uuid not null references meals_private.parent_contacts(id),
  whole_meal boolean not null,
  quantity integer not null check (quantity between 1 and 1000),
  status text not null check (status in ('pending','confirmed','cancelled','expired')),
  hold_expires_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (slot_id, meal_id) references meals_private.slots(id, meal_id),
  check ((whole_meal and slot_id is null and quantity = 1) or (not whole_meal and slot_id is not null)),
  check (status <> 'pending' or hold_expires_at is not null)
);
create index meals_claims_meal_active on meals_private.claims(meal_id, status, hold_expires_at);
create table meals_private.tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  claim_id uuid not null references meals_private.claims(id),
  purpose text not null check (purpose in ('verify','manage','access')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at)
);
create index meals_tokens_claim on meals_private.tokens(claim_id);
-- Exact immutable provider bytes are envelope-encrypted before the atomic hold
-- transaction. Only the Edge runtime has the wrapping key; tokens remain hashed
-- in tokens. Ciphertext is removed on terminal delivery/cancellation/expiry.
create table meals_private.outbox (
  id uuid primary key,
  claim_id uuid not null references meals_private.claims(id),
  status text not null default 'queued' check (status in ('queued','retry','sent','failed','uncertain')),
  envelope text check (octet_length(envelope) <= 131072),
  idempotency_key text not null unique,
  budget_day date not null default (clock_timestamp() at time zone 'UTC')::date,
  attempts integer not null default 0 check (attempts between 0 and 5),
  delivery_uncertain boolean not null default false,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  retry_until timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  terminal_at timestamptz,
  provider_id text check (length(provider_id)<=200),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (claim_id),
  check ((lease_token is null) = (lease_until is null)),
  check (terminal_at is null or envelope is null)
);
create index meals_outbox_due on meals_private.outbox(next_attempt_at) where envelope is not null and terminal_at is null;
create index meals_outbox_budget_day on meals_private.outbox(budget_day);
create table meals_private.idempotency (
  request_hash bytea primary key check (octet_length(request_hash) = 32),
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  claim_id uuid not null references meals_private.claims(id),
  expires_at timestamptz not null
);
create table meals_private.mail_budget (
  singleton boolean primary key default true check (singleton),
  utc_day date not null default (clock_timestamp() at time zone 'UTC')::date,
  used integer not null default 0 check (used >= 0),
  daily_limit integer not null default 0 check (daily_limit between 0 and 10000),
  attempts_used integer not null default 0 check (attempts_used>=0),
  mail_enabled boolean not null default false,
  quota_approved_until timestamptz,
  reserved_daily integer not null default 0 check (reserved_daily>=0),
  reserved_monthly integer not null default 0 check (reserved_monthly>=0),
  notification_daily_allowance integer not null default 0 check (notification_daily_allowance>=0)
);
insert into meals_private.mail_budget(singleton) values(true);
create table meals_private.rate_windows (
  kind text not null check (kind in ('ip','email','request','global_request','ip_day','email_day')),
  key_hash bytea not null check (octet_length(key_hash) = 32),
  window_start timestamptz not null,
  used integer not null check (used > 0),
  primary key(kind, key_hash, window_start)
);
create index meals_rate_windows_expiry on meals_private.rate_windows(window_start);
create table meals_private.history (
  id bigint generated always as identity primary key,
  meal_id uuid not null references meals_private.meals(id),
  claim_id uuid references meals_private.claims(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  version integer not null,
  reason text check (length(reason) <= 300),
  created_at timestamptz not null default clock_timestamp()
);

-- No policies: browser roles cannot read or mutate any base table, even if a future
-- accidental table grant is added. All security-definer bodies use a fixed path.
do $$declare t text; begin
  foreach t in array array['meals','slots','parent_contacts','claims','tokens','outbox','idempotency','mail_budget','rate_windows','history'] loop
    execute format('alter table meals_private.%I enable row level security',t);
  end loop;
end$$;

create function meals_private.manager() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  select p.id into actor from public.profiles p where p.id=auth.uid() and p.active=true and p.role in ('mentor','admin') for share;
  if actor is null then raise exception 'Meal coordinator access required' using errcode='42501'; end if;
  return actor;
end$$;

-- Called only while the meal row is held FOR UPDATE by a mutation.
create function meals_private.expire_holds(p_meal uuid) returns void language plpgsql set search_path='' as $$
declare expired_count integer;
begin
  with expired as (
    update meals_private.claims set status='expired',version=version+1,updated_at=clock_timestamp()
    where meal_id=p_meal and status='pending' and hold_expires_at<=clock_timestamp() returning id,version
  ) insert into meals_private.history(meal_id,claim_id,action,version) select p_meal,id,'expired',version from expired;
  get diagnostics expired_count = row_count;
  if expired_count > 0 then
    update meals_private.meals set version=version+1,updated_at=clock_timestamp() where id=p_meal;
  end if;
  update meals_private.outbox o set envelope=null, terminal_at=coalesce(terminal_at,clock_timestamp()),
    status=case when attempts=0 or status='retry' then 'failed' else status end,
    lease_token=null,lease_until=null,updated_at=clock_timestamp()
    where envelope is not null and exists(select 1 from meals_private.claims c where c.id=o.claim_id and c.meal_id=p_meal and c.status='expired');
  update meals_private.tokens t set revoked_at=clock_timestamp() where t.revoked_at is null and exists(
    select 1 from meals_private.claims c where c.id=t.claim_id and c.meal_id=p_meal and c.status='expired');
end$$;

create function meals_private.public_meal(p_meal uuid) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',m.id,'title',m.title,'service_at',m.service_at,'timezone',m.timezone,
    'expected_headcount',m.expected_headcount,'guidance',m.guidance,'status',m.status,'version',m.version,
    'whole_meal',case when exists(select 1 from meals_private.claims c where c.meal_id=m.id and c.whole_meal and c.status='confirmed') then 'confirmed'
      when exists(select 1 from meals_private.claims c where c.meal_id=m.id and c.whole_meal and c.status='pending' and c.hold_expires_at>clock_timestamp()) then 'held'
      when exists(select 1 from meals_private.claims c where c.meal_id=m.id and (c.status='confirmed' or (c.status='pending' and c.hold_expires_at>clock_timestamp()))) then 'coordination_required'
      else 'available' end,
    'slots',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'category',s.category,'unit',s.unit,'needed',s.needed,
      'confirmed',q.confirmed,'held',q.held,'remaining',greatest(0,s.needed-q.confirmed-q.held)) order by s.category,s.label,s.id)
      from meals_private.slots s cross join lateral (
        select coalesce(sum(case when c.whole_meal then s.needed else c.quantity end) filter(where c.status='confirmed'),0)::integer confirmed,
          coalesce(sum(case when c.whole_meal then s.needed else c.quantity end) filter(where c.status='pending' and c.hold_expires_at>clock_timestamp()),0)::integer held
        from meals_private.claims c where c.meal_id=m.id and (c.slot_id=s.id or c.whole_meal)
      ) q where s.meal_id=m.id and s.active), '[]'::jsonb))
  from meals_private.meals m where m.id=p_meal;
$$;
create function meals_private.list_public() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(meals_private.public_meal(m.id) order by m.service_at,m.id),'[]'::jsonb) from meals_private.meals m;
$$;
create function meals_private.private_claim(p_claim uuid,p_expires timestamptz) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',c.id,'meal',meals_private.public_meal(c.meal_id),'slot_id',c.slot_id,'whole_meal',c.whole_meal,
    'quantity',c.quantity,'name',p.name,'status',case when c.status='pending' and c.hold_expires_at<=clock_timestamp() then 'expired' else c.status end,
    'version',c.version,'access_expires_at',p_expires)
  from meals_private.claims c join meals_private.parent_contacts p on p.id=c.contact_id where c.id=p_claim;
$$;

create function public.meals_manager_context() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform meals_private.manager();
  return jsonb_build_object('meals',meals_private.list_public(),'claims',coalesce((
    select jsonb_agg(jsonb_build_object('id',c.id,'meal_id',c.meal_id,'slot_id',c.slot_id,'whole_meal',c.whole_meal,
      'quantity',c.quantity,'name',p.name,'email',p.email,
      'status',case when c.status='pending' and c.hold_expires_at<=clock_timestamp() then 'expired' else c.status end,
      'email_status',o.status,'hold_expires_at',c.hold_expires_at,'version',c.version) order by c.created_at,c.id)
    from meals_private.claims c join meals_private.parent_contacts p on p.id=c.contact_id join meals_private.outbox o on o.claim_id=c.id),'[]'::jsonb),
    'mail_mode','disabled','daily_budget_remaining',(select greatest(0,daily_limit-case when utc_day=(clock_timestamp() at time zone 'UTC')::date then used else 0 end) from meals_private.mail_budget));
end$$;

create function public.meals_manager_save(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; mid uuid; existing meals_private.meals; s jsonb; sid uuid; seen uuid[]:='{}'; allocation integer; v integer; tz text; at_time timestamptz;
begin
  actor:=meals_private.manager();
  if jsonb_typeof(p)<>'object' or (p-array['id','version','title','service_at','timezone','expected_headcount','guidance','status','slots','cancellation_reason','acknowledge_cancellation'])<>'{}'::jsonb
    or not (p ?& array['title','service_at','timezone','expected_headcount','guidance','status','slots'])
    or jsonb_typeof(p->'title')<>'string' or jsonb_typeof(p->'service_at')<>'string' or jsonb_typeof(p->'timezone')<>'string'
    or jsonb_typeof(p->'guidance')<>'string' or jsonb_typeof(p->'status')<>'string'
    or jsonb_typeof(p->'expected_headcount')<>'number' or (p->>'expected_headcount')!~'^[0-9]+$'
    or jsonb_typeof(p->'slots')<>'array' or jsonb_array_length(p->'slots') not between 1 and 30 then raise exception 'Invalid meal'; end if;
  if p ? 'acknowledge_cancellation' and jsonb_typeof(p->'acknowledge_cancellation') is distinct from 'boolean' then raise exception 'Invalid cancellation acknowledgement'; end if;
  if p->>'status'='cancelled' and (jsonb_typeof(p->'cancellation_reason') is distinct from 'string' or length(btrim(p->>'cancellation_reason')) not between 1 and 300) then raise exception 'Cancellation reason required'; end if;
  tz:=p->>'timezone'; at_time:=(p->>'service_at')::timestamptz;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) or not isfinite(at_time)
    or extract(isodow from at_time at time zone tz)<>6 then raise exception 'Choose a valid Saturday and timezone'; end if;
  if p ? 'id' then
    mid:=(p->>'id')::uuid;
    if jsonb_typeof(p->'version') is distinct from 'number' or (p->>'version')!~'^[0-9]+$' then raise exception 'Invalid version'; end if;
    select * into existing from meals_private.meals where id=mid for update;
    if not found then raise exception 'Meal unavailable'; end if;
    if existing.version<>(p->>'version')::integer then raise exception 'Meal changed; reload before saving'; end if;
    perform meals_private.expire_holds(mid);
    select version+1 into v from meals_private.meals where id=mid;
    if p->>'status'='cancelled' and exists(select 1 from meals_private.claims where meal_id=mid and status in ('pending','confirmed'))
      and (p->>'acknowledge_cancellation')::boolean is distinct from true then raise exception 'Please acknowledge cancellation of existing contributions'; end if;
    if exists(select 1 from meals_private.claims where meal_id=mid and (status='confirmed' or (status='pending' and hold_expires_at>clock_timestamp()))) then
      if existing.service_at<>at_time or existing.timezone<>tz then raise exception 'Existing contributions require coordination before rescheduling'; end if;
      if existing.expected_headcount<>(p->>'expected_headcount')::integer and exists(select 1 from meals_private.claims where meal_id=mid and whole_meal and (status='confirmed' or (status='pending' and hold_expires_at>clock_timestamp()))) then raise exception 'Whole-meal commitment requires coordination before headcount changes'; end if;
    end if;
  else
    if p ? 'version' then raise exception 'Invalid version'; end if;
    mid:=gen_random_uuid(); v:=1;
    insert into meals_private.meals(id,title,service_at,timezone,expected_headcount,guidance,status,created_by)
      values(mid,p->>'title',at_time,tz,(p->>'expected_headcount')::integer,p->>'guidance',p->>'status',actor);
  end if;
  for s in select value from jsonb_array_elements(p->'slots') loop
    if jsonb_typeof(s)<>'object' or (s-array['id','label','category','unit','needed'])<>'{}'::jsonb
      or not (s ?& array['label','category','unit','needed']) or jsonb_typeof(s->'label')<>'string'
      or jsonb_typeof(s->'category')<>'string' or jsonb_typeof(s->'unit')<>'string'
      or jsonb_typeof(s->'needed')<>'number' or (s->>'needed')!~'^[0-9]+$' then raise exception 'Invalid slot'; end if;
    if s ? 'id' and not exists(select 1 from meals_private.slots where id=(s->>'id')::uuid and meal_id=mid) then
      raise exception 'New slot identifiers must be assigned by the server';
    end if;
    sid:=coalesce((s->>'id')::uuid,gen_random_uuid());
    if sid=any(seen) then raise exception 'Duplicate slot'; end if;
    seen:=array_append(seen,sid);
    if exists(select 1 from meals_private.slots where id=sid and meal_id<>mid) then raise exception 'Slot unavailable'; end if;
    select coalesce(sum(quantity),0)::integer into allocation from meals_private.claims where slot_id=sid and (status='confirmed' or (status='pending' and hold_expires_at>clock_timestamp()));
    if allocation>(s->>'needed')::integer then raise exception 'Capacity is below current allocations'; end if;
    -- A whole-meal pledge cannot silently expand when coordinator increases requirements.
    if existing.id is not null and exists(select 1 from meals_private.claims where meal_id=mid and whole_meal and (status='confirmed' or (status='pending' and hold_expires_at>clock_timestamp())))
      and (not exists(select 1 from meals_private.slots where id=sid) or exists(select 1 from meals_private.slots where id=sid and (needed<>(s->>'needed')::integer or label<>s->>'label' or unit<>s->>'unit' or category<>s->>'category'))) then raise exception 'Whole-meal commitment requires coordination before capacity changes'; end if;
    if exists(select 1 from meals_private.slots where id=sid and (label<>s->>'label' or unit<>s->>'unit' or category<>s->>'category'))
      and exists(select 1 from meals_private.claims where slot_id=sid and (status='confirmed' or (status='pending' and hold_expires_at>clock_timestamp()))) then raise exception 'Claimed slot specifications require coordination'; end if;
    insert into meals_private.slots(id,meal_id,label,category,unit,needed) values(sid,mid,s->>'label',s->>'category',s->>'unit',(s->>'needed')::integer)
      on conflict(id) do update set label=excluded.label,category=excluded.category,unit=excluded.unit,needed=excluded.needed,active=true;
  end loop;
  if exists(select 1 from meals_private.slots s where s.meal_id=mid and s.active and not(s.id=any(seen)) and exists(
    select 1 from meals_private.claims c where c.meal_id=mid and (c.slot_id=s.id or c.whole_meal))) then raise exception 'A claimed slot cannot be removed'; end if;
  update meals_private.slots set active=false where meal_id=mid and not(id=any(seen));
  update meals_private.meals set title=p->>'title',service_at=at_time,timezone=tz,expected_headcount=(p->>'expected_headcount')::integer,
    guidance=p->>'guidance',status=p->>'status',version=v,updated_at=clock_timestamp() where id=mid;
  if p->>'status'='cancelled' then
    with cancelled as (
      update meals_private.claims set status='cancelled',version=version+1,updated_at=clock_timestamp() where meal_id=mid and status in ('pending','confirmed') returning id,version
    ) insert into meals_private.history(meal_id,claim_id,actor_id,action,version,reason) select mid,id,actor,'meal_cancelled',version,btrim(p->>'cancellation_reason') from cancelled;
    update meals_private.tokens set revoked_at=clock_timestamp() where revoked_at is null and claim_id in (select id from meals_private.claims where meal_id=mid);
    update meals_private.outbox set status=case when status in ('queued','retry') then 'failed' else status end,envelope=null,terminal_at=coalesce(terminal_at,clock_timestamp()),lease_token=null,lease_until=null,updated_at=clock_timestamp() where envelope is not null and claim_id in (select id from meals_private.claims where meal_id=mid);
  end if;
  insert into meals_private.history(meal_id,actor_id,action,version) values(mid,actor,'meal_saved',v);
  return meals_private.public_meal(mid);
end$$;

-- Separate short transaction at the gateway: a rejected operation must still
-- consume its distributed per-IP request charge. Never store the raw IP.
create function meals_private.reserve_request(p_ip_hash bytea) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; global_n integer;
begin
  if octet_length(p_ip_hash) is distinct from 32 then raise exception 'Invalid request hash'; end if;
  -- Charge the bounded global bucket first. Once exhausted, attacker-selected
  -- fresh IP hashes must not create an unbounded number of per-IP rows.
  insert into meals_private.rate_windows(kind,key_hash,window_start,used)
    values('global_request',sha256(convert_to('all-meal-requests','UTF8')),date_trunc('minute',clock_timestamp()),1)
    on conflict(kind,key_hash,window_start) do update
      set used=least(meals_private.rate_windows.used+1,601) returning used into global_n;
  if global_n>600 then return false; end if;
  insert into meals_private.rate_windows(kind,key_hash,window_start,used)
    values('request',p_ip_hash,date_trunc('minute',clock_timestamp()),1)
    on conflict(kind,key_hash,window_start) do update
      set used=least(meals_private.rate_windows.used+1,121) returning used into n;
  return n<=120;
end$$;

-- Called under the singleton budget lock. This is an atomic FEATURE budget,
-- not a global account semaphore: Auth and existing notifications do not take
-- this lock. Fresh provider usage, an approved reserve for those other senders,
-- and a count-only notification backlog guard are conservative protections.
-- Unknown/stale usage or expired operator approval fail closed. No contacts,
-- notification bodies, Auth accounts, or credentials are read here.
create function meals_private.mail_capacity(p_usage jsonb,p_new integer) returns boolean language plpgsql set search_path='' as $$
declare b meals_private.mail_budget; notification_count bigint:=0; monthly_reserved bigint; carried bigint; v text; fetched timestamptz;
begin
  select * into b from meals_private.mail_budget where singleton;
  if not b.mail_enabled or b.quota_approved_until is null or b.quota_approved_until<=clock_timestamp() or b.daily_limit=0 then return false; end if;
  if p_usage is null or jsonb_typeof(p_usage)<>'object' then return false; end if;
  foreach v in array array['dailyUsed','monthlyUsed'] loop
    if jsonb_typeof(p_usage->v) is distinct from 'number' or (p_usage->>v)!~'^[0-9]+$' or (p_usage->>v)::numeric>2147483647 then return false; end if;
  end loop;
  foreach v in array array['dailyLimit','monthlyLimit'] loop
    if not p_usage ? v or (p_usage->v<>'null'::jsonb and (jsonb_typeof(p_usage->v)<>'number' or (p_usage->>v)!~'^[0-9]+$' or (p_usage->>v)::numeric>2147483647)) then return false; end if;
  end loop;
  fetched:=(p_usage->>'fetchedAt')::timestamptz;
  if fetched is null or not isfinite(fetched) or fetched>clock_timestamp()+interval '5 seconds' or fetched<clock_timestamp()-interval '60 seconds'
    or (fetched at time zone 'UTC')::date<>(clock_timestamp() at time zone 'UTC')::date
    or (p_usage->>'dailyResetsAt')::timestamptz is null or (p_usage->>'dailyResetsAt')::timestamptz<=clock_timestamp()+interval '10 seconds'
    or (p_usage->>'monthlyResetsAt')::timestamptz is null or (p_usage->>'monthlyResetsAt')::timestamptz<=clock_timestamp()+interval '10 seconds' then return false; end if;
  if to_regclass('public.team_notifications') is not null then
    execute 'select count(*) from public.team_notifications where channel=''email'' and (status in (''pending'',''sending'',''review'') or first_attempt_at >= date_trunc(''day'',clock_timestamp() at time zone ''UTC'') at time zone ''UTC'')' into notification_count;
  end if;
  -- Feature reservations are deliberately counted again on top of usage. This
  -- can leave unused capacity but cannot assume a provider snapshot includes a
  -- concurrent send. Other senders still require operator monitoring/headroom.
  select count(*) into carried from meals_private.outbox where budget_day<>(clock_timestamp() at time zone 'UTC')::date and envelope is not null and terminal_at is null;
  select count(*) into monthly_reserved from meals_private.outbox where budget_day>=date_trunc('month',clock_timestamp() at time zone 'UTC')::date;
  return (b.used+carried+p_new<=b.daily_limit)
    and ((p_usage->>'dailyLimit') is null or (p_usage->>'dailyUsed')::bigint+b.used+carried+p_new+b.reserved_daily+greatest(b.notification_daily_allowance,notification_count)<=(p_usage->>'dailyLimit')::bigint)
    and ((p_usage->>'monthlyLimit') is null or (p_usage->>'monthlyUsed')::bigint+monthly_reserved+carried+p_new+b.reserved_monthly+greatest(b.notification_daily_allowance,notification_count)<=(p_usage->>'monthlyLimit')::bigint);
exception when others then return false;
end$$;

-- Gateway hashes normalized email+meal+idempotency-key and IP before calling.
-- The gateway must validate Origin, request sizes, token entropy and human input.
create function meals_private.create_hold(p_meal uuid,p_slot uuid,p_whole boolean,p_quantity integer,p_name text,p_email text,
  p_request_hash bytea,p_verify_hash bytea,p_manage_hash bytea,p_ip_hash bytea,
  p_claim uuid,p_outbox uuid,p_envelope text,p_usage jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m meals_private.meals; c meals_private.claims; prior meals_private.idempotency; contact uuid; cid uuid; oid uuid; fp bytea;
  allocated integer; capacity integer; email_hash bytea; bucket timestamptz; n integer; day_now date; until_time timestamptz;
begin
  if p_meal is null or p_whole is null or p_quantity is null or p_quantity not between 1 and 1000
    or p_name is null or length(btrim(p_name)) not between 1 and 80 or p_email is null or length(p_email)>254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or octet_length(p_manage_hash) is distinct from 32 or p_manage_hash=p_verify_hash
    or octet_length(p_request_hash) is distinct from 32 or octet_length(p_verify_hash) is distinct from 32 or octet_length(p_ip_hash) is distinct from 32
    or (p_whole and (p_slot is not null or p_quantity<>1)) or (not p_whole and p_slot is null) then raise exception 'Invalid claim'; end if;
  if p_claim is null or p_outbox is null or p_envelope is null or octet_length(p_envelope) not between 80 and 131072
    or jsonb_typeof(p_envelope::jsonb)<>'object' or (p_envelope::jsonb->>'v') is distinct from '1'
    or not (p_envelope::jsonb ?& array['iv','keyIv','wrappedKey','ciphertext']) then raise exception 'Invalid claim'; end if;
  p_email:=lower(btrim(p_email)); p_name:=btrim(p_name);
  fp:=sha256(convert_to(jsonb_build_array(p_meal,p_slot,p_whole,p_quantity,p_name,p_email)::text,'UTF8'));
  -- Consistent lock order: budget row, meal row, then claim/token rows.
  perform 1 from meals_private.mail_budget where singleton for update;
  select * into m from meals_private.meals where id=p_meal for update;
  if not found then raise exception 'Meal unavailable'; end if;
  select * into prior from meals_private.idempotency where request_hash=p_request_hash;
  if found then
    if prior.fingerprint<>fp then raise exception 'Request key already used'; end if;
    select * into c from meals_private.claims where id=prior.claim_id;
    return jsonb_build_object('claim_id',c.id,'status','pending_verification','hold_expires_at',case when c.status='pending' and c.hold_expires_at>clock_timestamp() then c.hold_expires_at else null end,'replayed',true,
      'email_status',(select status from meals_private.outbox where claim_id=c.id),'outbox_id',(select id from meals_private.outbox where claim_id=c.id),'can_send',false);
  end if;
  if m.status<>'open' or m.service_at<=clock_timestamp() then raise exception 'Meal is not accepting contributions'; end if;
  perform meals_private.expire_holds(p_meal);
  if exists(select 1 from meals_private.claims where meal_id=p_meal and (status='confirmed' or (status='pending' and hold_expires_at>clock_timestamp())) and (p_whole or whole_meal)) then raise exception 'Whole meal needs coordinator review'; end if;
  if not p_whole then
    select needed into capacity from meals_private.slots where id=p_slot and meal_id=p_meal and active;
    if not found then raise exception 'Slot unavailable'; end if;
    select coalesce(sum(quantity),0)::integer into allocated from meals_private.claims where slot_id=p_slot and (status='confirmed' or (status='pending' and hold_expires_at>clock_timestamp()));
    if allocated+p_quantity>capacity then raise exception 'Requested quantity is no longer available'; end if;
  end if;
  day_now:=(clock_timestamp() at time zone 'UTC')::date;
  update meals_private.mail_budget set used=0,attempts_used=0,utc_day=day_now where utc_day<>day_now;
  if p_usage is null then raise exception 'Email usage could not be verified'; end if;
  if not meals_private.mail_capacity(p_usage,1) then raise exception 'Email service daily budget reached'; end if;
  update meals_private.mail_budget set used=used+1 where used<daily_limit returning used into n;
  if not found then raise exception 'Email service daily budget reached'; end if;
  bucket:=date_trunc('hour',clock_timestamp()); email_hash:=sha256(convert_to(p_email,'UTF8'));
  insert into meals_private.rate_windows(kind,key_hash,window_start,used) values('email',email_hash,bucket,1)
    on conflict(kind,key_hash,window_start) do update set used=meals_private.rate_windows.used+1 returning used into n;
  if n>4 then raise exception 'Too many requests; try later'; end if;
  insert into meals_private.rate_windows(kind,key_hash,window_start,used) values('ip',p_ip_hash,bucket,1)
    on conflict(kind,key_hash,window_start) do update set used=meals_private.rate_windows.used+1 returning used into n;
  if n>12 then raise exception 'Too many requests; try later'; end if;
  insert into meals_private.rate_windows(kind,key_hash,window_start,used) values('email_day',email_hash,date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC',1)
    on conflict(kind,key_hash,window_start) do update set used=meals_private.rate_windows.used+1 returning used into n;
  if n>8 then raise exception 'Too many requests; try later'; end if;
  insert into meals_private.rate_windows(kind,key_hash,window_start,used) values('ip_day',p_ip_hash,date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC',1)
    on conflict(kind,key_hash,window_start) do update set used=meals_private.rate_windows.used+1 returning used into n;
  if n>30 then raise exception 'Too many requests; try later'; end if;
  until_time:=least(clock_timestamp()+interval '15 minutes',m.service_at);
  insert into meals_private.parent_contacts(name,email) values(p_name,p_email) returning id into contact;
  insert into meals_private.claims(id,meal_id,slot_id,contact_id,whole_meal,quantity,status,hold_expires_at)
    values(p_claim,p_meal,p_slot,contact,p_whole,p_quantity,'pending',until_time) returning id into cid;
  insert into meals_private.tokens(token_hash,claim_id,purpose,expires_at) values(p_verify_hash,cid,'verify',until_time);
  insert into meals_private.tokens(token_hash,claim_id,purpose,expires_at) values(p_manage_hash,cid,'manage',least(m.service_at,clock_timestamp()+interval '90 days'));
  insert into meals_private.outbox(id,claim_id,envelope,idempotency_key,retry_until) values(p_outbox,cid,p_envelope,'meal-verification:'||p_outbox::text,until_time) returning id into oid;
  insert into meals_private.idempotency(request_hash,fingerprint,claim_id,expires_at) values(p_request_hash,fp,cid,clock_timestamp()+interval '24 hours');
  update meals_private.meals set version=version+1,updated_at=clock_timestamp() where id=p_meal;
  insert into meals_private.history(meal_id,claim_id,action,version) values(p_meal,cid,'hold_created',1);
  return jsonb_build_object('claim_id',cid,'outbox_id',oid,'status','pending_verification','hold_expires_at',until_time,'replayed',false,'email_status','queued','can_send',true);
end$$;

create function meals_private.verify(p_verify_hash bytea,p_access_hash bytea) returns jsonb language plpgsql security definer set search_path='' as $$
declare t meals_private.tokens; c meals_private.claims; m meals_private.meals; until_time timestamptz;
begin
  if octet_length(p_verify_hash) is distinct from 32 or octet_length(p_access_hash) is distinct from 32 or p_verify_hash=p_access_hash then raise exception 'Invalid or expired link'; end if;
  select * into t from meals_private.tokens where token_hash=p_verify_hash and purpose='verify';
  if not found then raise exception 'Invalid or expired link'; end if;
  select * into c from meals_private.claims where id=t.claim_id;
  select * into m from meals_private.meals where id=c.meal_id for update;
  perform meals_private.expire_holds(c.meal_id);
  select * into t from meals_private.tokens where token_hash=p_verify_hash for update;
  select * into c from meals_private.claims where id=t.claim_id for update;
  if t.revoked_at is not null or t.used_at is not null or t.expires_at<=clock_timestamp() or c.status<>'pending' or c.hold_expires_at<=clock_timestamp()
    or m.status<>'open' or m.service_at<=clock_timestamp() then raise exception 'Invalid or expired link'; end if;
  update meals_private.tokens set used_at=clock_timestamp(),revoked_at=clock_timestamp() where token_hash=p_verify_hash;
  until_time:=least(clock_timestamp()+interval '30 minutes',m.service_at);
  insert into meals_private.tokens(token_hash,claim_id,purpose,expires_at) values(p_access_hash,c.id,'access',until_time);
  update meals_private.claims set status='confirmed',version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  update meals_private.meals set version=version+1,updated_at=clock_timestamp() where id=c.meal_id;
  insert into meals_private.history(meal_id,claim_id,action,version) values(c.meal_id,c.id,'confirmed',c.version);
  return meals_private.private_claim(c.id,until_time);
end$$;

create function meals_private.inspect(p_access_hash bytea) returns jsonb language plpgsql security definer set search_path='' as $$
declare t meals_private.tokens;
begin
  select * into t from meals_private.tokens where token_hash=p_access_hash and purpose in ('access','manage') and revoked_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'Invalid or expired link'; end if;
  if not exists(select 1 from meals_private.claims where id=t.claim_id and status='confirmed') then raise exception 'Invalid or expired link'; end if;
  return meals_private.private_claim(t.claim_id,t.expires_at);
end$$;

create function meals_private.change_claim(p_access_hash bytea,p_version integer,p_quantity integer,p_cancel boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare t meals_private.tokens; c meals_private.claims; m meals_private.meals; allocated integer; capacity integer;
begin
  if p_cancel is null or p_version is null or (not p_cancel and (p_quantity is null or p_quantity not between 1 and 1000)) then raise exception 'Invalid claim change'; end if;
  select * into t from meals_private.tokens where token_hash=p_access_hash and purpose in ('access','manage');
  if not found then raise exception 'Invalid or expired link'; end if;
  select * into c from meals_private.claims where id=t.claim_id;
  select * into m from meals_private.meals where id=c.meal_id for update;
  perform meals_private.expire_holds(c.meal_id);
  select * into t from meals_private.tokens where token_hash=p_access_hash for update;
  select * into c from meals_private.claims where id=t.claim_id for update;
  if t.revoked_at is not null or t.expires_at<=clock_timestamp() then raise exception 'Invalid or expired link'; end if;
  if c.version<>p_version then raise exception 'Contribution changed; reload before editing'; end if;
  if c.status<>'confirmed' then raise exception 'Contribution is not editable'; end if;
  if not p_cancel then
    if m.status<>'open' or m.service_at<=clock_timestamp() then raise exception 'Meal is not accepting changes'; end if;
    if c.whole_meal and p_quantity<>1 then raise exception 'Whole-meal quantity must be one'; end if;
    if not c.whole_meal then
      select needed into capacity from meals_private.slots where id=c.slot_id and active;
      select coalesce(sum(quantity),0)::integer into allocated from meals_private.claims where slot_id=c.slot_id and id<>c.id and (status='confirmed' or (status='pending' and hold_expires_at>clock_timestamp()));
      if capacity is null or allocated+p_quantity>capacity then raise exception 'Requested quantity is no longer available'; end if;
    end if;
  end if;
  update meals_private.claims set quantity=case when p_cancel then quantity else p_quantity end,status=case when p_cancel then 'cancelled' else status end,
    version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  if p_cancel then
    update meals_private.tokens set revoked_at=clock_timestamp() where claim_id=c.id and revoked_at is null;
    update meals_private.outbox set status=case when status in ('queued','retry') then 'failed' else status end,envelope=null,terminal_at=coalesce(terminal_at,clock_timestamp()),lease_token=null,lease_until=null,updated_at=clock_timestamp() where claim_id=c.id and envelope is not null;
  end if;
  update meals_private.meals set version=version+1,updated_at=clock_timestamp() where id=c.meal_id;
  insert into meals_private.history(meal_id,claim_id,action,version) values(c.meal_id,c.id,case when p_cancel then 'cancelled' else 'quantity_changed' end,c.version);
  return meals_private.private_claim(c.id,t.expires_at);
end$$;

create function public.meals_manager_cancel_claim(p_claim uuid,p_version integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; c meals_private.claims;
begin
  actor:=meals_private.manager();
  if p_version is null or p_reason is null or length(btrim(p_reason)) not between 1 and 300 then raise exception 'Cancellation reason required'; end if;
  select * into c from meals_private.claims where id=p_claim;
  if not found then raise exception 'Contribution unavailable'; end if;
  perform 1 from meals_private.meals where id=c.meal_id for update;
  select * into c from meals_private.claims where id=p_claim for update;
  if c.version<>p_version then raise exception 'Contribution changed; reload before editing'; end if;
  if c.status not in ('pending','confirmed') then raise exception 'Contribution is not cancellable'; end if;
  update meals_private.claims set status='cancelled',version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  update meals_private.tokens set revoked_at=clock_timestamp() where claim_id=c.id and revoked_at is null;
  update meals_private.meals set version=version+1,updated_at=clock_timestamp() where id=c.meal_id;
  update meals_private.outbox set status=case when status in ('queued','retry') then 'failed' else status end,envelope=null,terminal_at=coalesce(terminal_at,clock_timestamp()),lease_token=null,lease_until=null,updated_at=clock_timestamp() where claim_id=c.id and envelope is not null;
  -- Reason is private coordinator audit only; never in public projection.
  insert into meals_private.history(meal_id,claim_id,actor_id,action,version,reason) values(c.meal_id,c.id,actor,'coordinator_cancelled',c.version,btrim(p_reason));
end$$;

-- Email carries a separate reusable management capability, not a short session.
-- Opening it after verification issues a fresh 30-minute session without tokens
-- at rest, valid only until the meal cutoff (and at most 90 days from signup).
create function meals_private.reopen_session(p_manage_hash bytea,p_access_hash bytea) returns jsonb language plpgsql security definer set search_path='' as $$
declare t meals_private.tokens; c meals_private.claims; m meals_private.meals; until_time timestamptz;
begin
  if octet_length(p_manage_hash) is distinct from 32 or octet_length(p_access_hash) is distinct from 32 or p_manage_hash=p_access_hash then raise exception 'Invalid or expired link'; end if;
  select * into t from meals_private.tokens where token_hash=p_manage_hash and purpose='manage';
  if not found then raise exception 'Invalid or expired link'; end if;
  select * into c from meals_private.claims where id=t.claim_id;
  select * into m from meals_private.meals where id=c.meal_id for update;
  select * into t from meals_private.tokens where token_hash=p_manage_hash for update;
  select * into c from meals_private.claims where id=t.claim_id for update;
  if t.revoked_at is not null or t.expires_at<=clock_timestamp() or c.status<>'confirmed' or m.service_at<=clock_timestamp() then raise exception 'Invalid or expired link'; end if;
  until_time:=least(clock_timestamp()+interval '30 minutes',m.service_at,t.expires_at);
  insert into meals_private.tokens(token_hash,claim_id,purpose,expires_at) values(p_access_hash,c.id,'access',until_time);
  return meals_private.private_claim(c.id,until_time);
end$$;

-- A lease is committed before network I/O. Every subsequent attempt recovers
-- the SAME envelope and idempotency key; a crashed caller never replaces tokens.
-- Budget -> meal -> claim -> outbox is the common lock order. A 45-second lease
-- outlives the provider's 8-second deadline, and fencing defeats stale finishes.
create function meals_private.begin_delivery(p_outbox uuid,p_usage jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c meals_private.claims; o meals_private.outbox; b meals_private.mail_budget; day_now date;
begin
  select * into b from meals_private.mail_budget where singleton for update;
  select x.* into c from meals_private.outbox xout join meals_private.claims x on x.id=xout.claim_id where xout.id=p_outbox;
  if not found then return null; end if;
  perform 1 from meals_private.meals where id=c.meal_id for update;
  perform meals_private.expire_holds(c.meal_id);
  select * into c from meals_private.claims where id=c.id for update;
  select * into o from meals_private.outbox where id=p_outbox for update;
  if o.envelope is null or o.terminal_at is not null then return null; end if;
  -- Never exhaust/terminalize a worker that still owns its active final lease.
  if o.lease_until>clock_timestamp() then return null; end if;
  if c.status<>'pending' or c.hold_expires_at<=clock_timestamp()+interval '10 seconds' or o.retry_until<=clock_timestamp()+interval '10 seconds'
    or (o.first_attempt_at is not null and o.first_attempt_at<=clock_timestamp()-interval '23 hours') or o.attempts>=5
    or not exists(select 1 from meals_private.meals where id=c.meal_id and status='open' and service_at>clock_timestamp()+interval '10 seconds') then
    update meals_private.outbox set envelope=null,terminal_at=clock_timestamp(),lease_token=null,lease_until=null,
      status=case when attempts=0 or status='retry' then 'failed' else status end,updated_at=clock_timestamp() where id=o.id;
    if c.status='pending' and (o.attempts=0 or o.status='retry') then
      update meals_private.claims set status='expired',version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
      update meals_private.tokens set revoked_at=clock_timestamp() where claim_id=c.id and revoked_at is null;
      update meals_private.meals set version=version+1,updated_at=clock_timestamp() where id=c.meal_id;
      insert into meals_private.history(meal_id,claim_id,action,version) values(c.meal_id,c.id,'delivery_expired',c.version);
    end if;
    return null;
  end if;
  if o.next_attempt_at>clock_timestamp() then return null; end if;
  day_now:=(clock_timestamp() at time zone 'UTC')::date;
  update meals_private.mail_budget set used=0,attempts_used=0,utc_day=day_now where utc_day<>day_now;
  if not meals_private.mail_capacity(p_usage,0) then return null; end if;
  if o.budget_day<>day_now then
    update meals_private.mail_budget set used=used+1 where singleton;
    update meals_private.outbox set budget_day=day_now where id=o.id;
  end if;
  update meals_private.mail_budget set attempts_used=attempts_used+1 where singleton and attempts_used<daily_limit*5;
  if not found then return null; end if;
  update meals_private.outbox set delivery_uncertain=delivery_uncertain or (attempts>0 and status='uncertain'),status='uncertain',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),
    lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp() where id=o.id returning * into o;
  return jsonb_build_object('id',o.id,'claim_id',o.claim_id,'envelope',o.envelope,'idempotency_key',o.idempotency_key,'lease_token',o.lease_token,'attempts',o.attempts);
end$$;
create function meals_private.finish_delivery(p_outbox uuid,p_lease uuid,p_status text,p_retryable boolean,p_provider_id text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare c meals_private.claims; o meals_private.outbox; retry boolean; outcome text;
begin
  if p_status is null or p_status not in ('sent','failed','uncertain') or p_retryable is null or length(p_provider_id)>200 then raise exception 'Invalid delivery status'; end if;
  select x.* into c from meals_private.outbox xout join meals_private.claims x on x.id=xout.claim_id where xout.id=p_outbox;
  if not found then return false; end if;
  perform 1 from meals_private.meals where id=c.meal_id for update;
  select * into c from meals_private.claims where id=c.id for update;
  select * into o from meals_private.outbox where id=p_outbox for update;
  if o.lease_token is distinct from p_lease or p_lease is null or o.lease_until<=clock_timestamp() or o.terminal_at is not null then return false; end if;
  retry:=p_status<>'sent' and p_retryable and o.attempts<5 and c.status='pending'
    and least(c.hold_expires_at,o.retry_until)>clock_timestamp()+make_interval(secs=>20*power(2,o.attempts-1)::integer)+interval '10 seconds'
    and o.first_attempt_at>clock_timestamp()-interval '23 hours';
  -- A later definitive rejection does not prove an earlier timed-out attempt
  -- was rejected. Keep uncertainty and a possibly delivered link valid.
  outcome:=case when p_status='failed' and o.delivery_uncertain then 'uncertain' when retry and p_status='failed' then 'retry' else p_status end;
  update meals_private.outbox set status=outcome,delivery_uncertain=delivery_uncertain or p_status='uncertain',lease_token=null,lease_until=null,
    next_attempt_at=clock_timestamp()+make_interval(secs=>20*power(2,o.attempts-1)::integer),
    envelope=case when retry then envelope else null end,terminal_at=case when retry then null else clock_timestamp() end,
    provider_id=case when p_status='sent' then p_provider_id else provider_id end,updated_at=clock_timestamp() where id=o.id;
  if outcome='failed' and c.status='pending' then
    update meals_private.claims set status='expired',version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
    update meals_private.tokens set revoked_at=clock_timestamp() where claim_id=c.id and revoked_at is null;
    update meals_private.meals set version=version+1,updated_at=clock_timestamp() where id=c.meal_id;
    insert into meals_private.history(meal_id,claim_id,action,version) values(c.meal_id,c.id,'delivery_failed',c.version);
  end if;
  return true;
end$$;
-- Private worker only. Include expiry rows so recovery also purges their
-- ciphertext; callers must acquire begin_delivery rather than sending this list.
create function meals_private.due_deliveries(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  delete from meals_private.rate_windows where (kind,key_hash,window_start) in (
    select kind,key_hash,window_start from meals_private.rate_windows where window_start<clock_timestamp()-interval '2 days' order by window_start limit 1000
  );
  select coalesce(jsonb_agg(id),'[]'::jsonb) into result from (
    select id from meals_private.outbox where envelope is not null and terminal_at is null
      and (lease_until is null or lease_until<=clock_timestamp())
      and (next_attempt_at<=clock_timestamp() or retry_until<=clock_timestamp())
    order by case when retry_until<=clock_timestamp() then 0 else 1 end,next_attempt_at,id limit greatest(0,least(coalesce(p_limit,0),20))
  ) due;
  return result;
end$$;

-- Revoke default PUBLIC execution on every helper AND exposed manager wrapper.
revoke all on all tables in schema meals_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema meals_private from public,anon,authenticated,service_role;
revoke execute on all functions in schema meals_private from public,anon,authenticated,service_role;
revoke all on function public.meals_manager_context() from public,anon,authenticated,service_role;
revoke all on function public.meals_manager_save(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.meals_manager_cancel_claim(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.meals_manager_context(),public.meals_manager_save(jsonb),public.meals_manager_cancel_claim(uuid,integer,text) to authenticated;
-- For a later direct, trusted server connection only. This does not expose the
-- private schema through PostgREST and does not grant direct table access.
grant usage on schema meals_private to service_role;
grant execute on function meals_private.list_public(),meals_private.reserve_request(bytea),
  meals_private.create_hold(uuid,uuid,boolean,integer,text,text,bytea,bytea,bytea,bytea,uuid,uuid,text,jsonb),
  meals_private.verify(bytea,bytea),meals_private.reopen_session(bytea,bytea),meals_private.inspect(bytea),meals_private.change_claim(bytea,integer,integer,boolean),
  meals_private.begin_delivery(uuid,jsonb),meals_private.finish_delivery(uuid,uuid,text,boolean,text),meals_private.due_deliveries(integer) to service_role;
commit;
