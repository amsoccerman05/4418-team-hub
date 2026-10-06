-- LOCAL REVIEW ONLY. No production application is authorized.
-- Prerequisite: Finance budget core (finance_seasons, finance_income and
-- finance_private.can_manage_budget). Finance tables, grants and functions are unchanged.
begin;
create schema outreach_private;
revoke all on schema outreach_private from public,anon,authenticated,service_role;
create table outreach_private.organizations (
 id uuid primary key, kind text not null check(kind in ('organization','person')),
 name text not null check(length(trim(name)) between 1 and 150),
 website text not null default '' check(length(website)<=500 and (website='' or website ~ '^https?://')),
 notes text not null default '' check(length(notes)<=4000), active boolean not null default true,
 version integer not null default 1 check(version>0), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table outreach_private.contacts (
 id uuid primary key, organization_id uuid not null references outreach_private.organizations(id),
 name text not null check(length(trim(name)) between 1 and 150), title text not null default '' check(length(title)<=150),
 email text not null default '' check(length(email)<=254 and (email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 phone text not null default '' check(length(phone)<=80), notes text not null default '' check(length(notes)<=4000),
 active boolean not null default true, version integer not null default 1 check(version>0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index outreach_contacts_organization on outreach_private.contacts(organization_id);
create table outreach_private.engagements (
 id uuid primary key, organization_id uuid not null references outreach_private.organizations(id),
 season_id uuid not null references public.finance_seasons(id),
 stage text not null check(stage in ('prospect','contacted','discussing','committed','closed')),
 owner_id uuid references public.profiles(id), next_follow_up_on date, notes text not null default '' check(length(notes)<=4000),
 version integer not null default 1 check(version>0), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,season_id)
);
create index outreach_engagements_season on outreach_private.engagements(season_id);
create index outreach_engagements_owner on outreach_private.engagements(owner_id,next_follow_up_on);
create table outreach_private.conversations (
 id uuid primary key, engagement_id uuid not null references outreach_private.engagements(id),
 contact_id uuid references outreach_private.contacts(id), occurred_on date not null,
 channel text not null check(channel in ('email','phone','meeting','other')),
 summary text not null check(length(trim(summary)) between 1 and 4000),
 version integer not null default 1 check(version=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index outreach_conversations_engagement on outreach_private.conversations(engagement_id,occurred_on);
create index outreach_conversations_contact on outreach_private.conversations(contact_id);
create table outreach_private.pledges (
 id uuid primary key, engagement_id uuid not null references outreach_private.engagements(id),
 kind text not null check(kind in ('cash','in_kind')), amount numeric(14,2),
 description text not null check(length(trim(description)) between 1 and 2000), promised_on date not null, expected_on date,
 status text not null check(status in ('pledged','canceled')),
 version integer not null default 1 check(version>0), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check((kind='cash' and amount>0 and amount<=999999999999.99) or (kind='in_kind' and amount is null)),
 check(kind<>'cash' or amount is not null), check(expected_on is null or expected_on>=promised_on)
);
create index outreach_pledges_engagement on outreach_private.pledges(engagement_id);
create table outreach_private.recognition (
 id uuid primary key, engagement_id uuid not null references outreach_private.engagements(id),
 pledge_id uuid references outreach_private.pledges(id), owner_id uuid references public.profiles(id),
 kind text not null check(kind in ('logo','recognition','thank_you','other')),
 description text not null check(length(trim(description)) between 1 and 2000), due_on date,
 status text not null check(status in ('promised','fulfilled','waived')), fulfilled_on date,
 fulfillment_note text not null default '' check(length(fulfillment_note)<=2000),
 version integer not null default 1 check(version>0), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check((status='fulfilled' and fulfilled_on is not null) or (status<>'fulfilled' and fulfilled_on is null))
);
create index outreach_recognition_engagement on outreach_private.recognition(engagement_id);
create index outreach_recognition_pledge on outreach_private.recognition(pledge_id);
create index outreach_recognition_owner on outreach_private.recognition(owner_id,due_on);
create table outreach_private.income_links (
 id uuid primary key default gen_random_uuid(), pledge_id uuid not null references outreach_private.pledges(id),
 income_id uuid not null unique references public.finance_income(id),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp()
);
create index outreach_income_links_pledge on outreach_private.income_links(pledge_id);
create table outreach_private.history (
 id bigint generated always as identity primary key, entity text not null, entity_id uuid not null,
 actor_id uuid not null references public.profiles(id), request_id uuid not null,
 action text not null, before_data jsonb, after_data jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create index outreach_history_entity on outreach_private.history(entity,entity_id,id);
create table outreach_private.requests (
 actor_id uuid not null references public.profiles(id), request_id uuid not null,
 operation text not null, payload jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_id)
);
-- Match the JavaScript trim whitespace set, including NBSP/BOM and Unicode
-- separators. SQL btrim alone would accept visually blank required text.
create function outreach_private.nonblank(value text) returns boolean language sql immutable set search_path='' as $$
 select length(translate(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',''))>0
$$;
alter table outreach_private.organizations add check(outreach_private.nonblank(name));
alter table outreach_private.contacts add check(outreach_private.nonblank(name));
alter table outreach_private.conversations add check(outreach_private.nonblank(summary)),
 add check(occurred_on between date '0001-01-01' and date '9999-12-31');
alter table outreach_private.engagements add check(next_follow_up_on between date '0001-01-01' and date '9999-12-31');
alter table outreach_private.pledges add check(outreach_private.nonblank(description)),
 add check(promised_on between date '0001-01-01' and date '9999-12-31'),
 add check(expected_on between date '0001-01-01' and date '9999-12-31');
alter table outreach_private.recognition add check(outreach_private.nonblank(description)),
 add check(due_on between date '0001-01-01' and date '9999-12-31'),
 add check(fulfilled_on between date '0001-01-01' and date '9999-12-31');
-- Legacy Finance rows are authoritative and unchanged; project dates that the
-- strict client cannot represent as the nullable contract's null value.
create function outreach_private.safe_date(value date) returns text language sql immutable set search_path='' as $$
 select case when value between date '0001-01-01' and date '9999-12-31' then to_char(value,'YYYY-MM-DD') else null end
$$;
-- RPC-only storage. RLS denies everything without a policy; table/function grants
-- are explicitly stripped even under permissive Supabase default privileges.
do $$ declare t text;begin
 foreach t in array array['organizations','contacts','engagements','conversations','pledges','recognition','income_links','history','requests'] loop
  execute format('alter table outreach_private.%I enable row level security',t);
  execute format('revoke all on outreach_private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on all sequences in schema outreach_private from public,anon,authenticated,service_role;
create function outreach_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Outreach history and operation receipts are immutable' using errcode='42501';end $$;
create trigger outreach_history_immutable before update or delete or truncate on outreach_private.history for each statement execute function outreach_private.immutable();
create trigger outreach_requests_immutable before update or delete or truncate on outreach_private.requests for each statement execute function outreach_private.immutable();
create trigger outreach_conversations_immutable before update or delete or truncate on outreach_private.conversations for each statement execute function outreach_private.immutable();

-- Authorization never trusts client fields or JWT user_metadata. VOLATILE helper
-- deliberately reads current profile state when called after a lock wait.
create function outreach_private.require_manager(expected_actor uuid default null) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or (expected_actor is not null and expected_actor<>actor) or not exists(
  select 1 from public.profiles where id=actor and active and role::text in ('admin','mentor'))
 then raise exception 'Active admin or mentor account required' using errcode='42501';end if;
 return actor;
end $$;
-- Shared sponsor/contact visibility is explicit; mutation rights stay per record.
create function outreach_private.require_participant(expected_actor uuid default null) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or (expected_actor is not null and expected_actor<>actor) or not exists(
  select 1 from public.profiles where id=actor and active and role::text in ('admin','mentor','student','lead'))
 then raise exception 'Active outreach account required' using errcode='42501';end if;
 return actor;
end $$;
create function outreach_private.manager(actor uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=actor and active and role::text in ('admin','mentor'))
$$;
create function outreach_private.can_work_engagement(eng uuid,actor uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from outreach_private.engagements e join outreach_private.organizations o on o.id=e.organization_id
 join public.finance_seasons s on s.id=e.season_id join public.profiles p on p.id=actor
 where e.id=eng and o.active and s.status<>'closed' and p.active and p.role::text in ('admin','mentor','student','lead')
 and (p.role::text in ('admin','mentor') or e.created_by=actor or e.owner_id=actor))
$$;
create function outreach_private.can_add_contact(org uuid,actor uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from outreach_private.organizations o join public.profiles p on p.id=actor
 where o.id=org and o.active and p.active and p.role::text in ('admin','mentor','student','lead')
 and (p.role::text in ('admin','mentor') or o.created_by=actor or exists(select 1 from outreach_private.engagements e
 where e.organization_id=org and outreach_private.can_work_engagement(e.id,actor))))
$$;
create function outreach_private.can_edit_record(entity text,ident uuid,actor uuid) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=actor and active and role::text in ('admin','mentor','student','lead')) then return false;end if;
 if entity='organization' then return exists(select 1 from outreach_private.organizations o where o.id=ident and
  (outreach_private.manager(actor) or (o.active and o.created_by=actor)));
 elsif entity='contact' then return exists(select 1 from outreach_private.contacts c where c.id=ident and
  (outreach_private.manager(actor) or c.created_by=actor) and outreach_private.can_add_contact(c.organization_id,actor));
 elsif entity='engagement' then return outreach_private.can_work_engagement(ident,actor);
 elsif entity='conversation' then return exists(select 1 from outreach_private.conversations c where c.id=ident and
  (outreach_private.manager(actor) or c.created_by=actor) and outreach_private.can_work_engagement(c.engagement_id,actor));
 elsif entity='pledge' then return outreach_private.manager(actor) and exists(select 1 from outreach_private.pledges p where p.id=ident and outreach_private.can_work_engagement(p.engagement_id,actor));
 elsif entity='recognition' then return outreach_private.manager(actor) and exists(select 1 from outreach_private.recognition r where r.id=ident and outreach_private.can_work_engagement(r.engagement_id,actor));
 end if;
 return false;
end $$;
create function outreach_private.require_receipt(receipt outreach_private.requests,actor uuid) returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if receipt.actor_id is distinct from actor then raise exception 'Request unavailable' using errcode='42501';end if;
 if receipt.operation='canceled' then return;end if;
 if receipt.operation='link_income' then
  if not outreach_private.manager(actor) or not coalesce(finance_private.can_manage_budget(),false) then raise exception 'Finance budget access required' using errcode='42501';end if;
 elsif receipt.operation='prospect' then
  if not outreach_private.can_edit_record('organization',(receipt.result->>'id')::uuid,actor)
   or not outreach_private.can_work_engagement((receipt.payload->>'engagement_id')::uuid,actor) then raise exception 'Prospect access changed' using errcode='42501';end if;
 elsif not outreach_private.can_edit_record(receipt.operation,(receipt.result->>'id')::uuid,actor) then raise exception 'Record access changed' using errcode='42501';end if;
end $$;
create function outreach_private.context(selected_season uuid default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; sid uuid; can_finance boolean; manager boolean;
begin
 actor:=outreach_private.require_participant();manager:=outreach_private.manager(actor);
 select id into sid from public.finance_seasons where selected_season is null or id=selected_season
 order by (status='active') desc,created_at desc,id limit 1;
 if selected_season is not null and sid is null then raise exception 'Season unavailable' using errcode='22023';end if;
 can_finance:=manager and coalesce(finance_private.can_manage_budget(),false);
 return jsonb_build_object('contract_version',2,'user_id',actor,'can_manage',manager,'can_link_finance',can_finance,'financials_redacted',not manager,'season_id',sid,
 'can_create_prospect',exists(select 1 from public.finance_seasons where id=sid and status<>'closed'),
 'seasons',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'starts_on',outreach_private.safe_date(s.starts_on),'ends_on',outreach_private.safe_date(s.ends_on)) order by s.created_at desc,s.id),'[]') from public.finance_seasons s),
 'owners',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,'Team member')) order by display_name,id),'[]') from public.profiles where active and role::text in ('admin','mentor','student','lead')),
 'organizations',(select coalesce(jsonb_agg((to_jsonb(o)-'notes')||jsonb_build_object('notes',case when manager then o.notes else null end,'notes_redacted',not manager,
  'can_edit',outreach_private.can_edit_record('organization',o.id,actor),'can_add_contact',outreach_private.can_add_contact(o.id,actor),
  'can_create_engagement',o.active and (manager or o.created_by=actor) and exists(select 1 from public.finance_seasons where id=sid and status<>'closed') and not exists(select 1 from outreach_private.engagements e where e.organization_id=o.id and e.season_id=sid)) order by o.name,o.id),'[]') from outreach_private.organizations o),
 'contacts',(select coalesce(jsonb_agg((to_jsonb(c)-'notes')||jsonb_build_object('notes',case when manager then c.notes else null end,'notes_redacted',not manager,
  'can_edit',outreach_private.can_edit_record('contact',c.id,actor)) order by c.name,c.id),'[]') from outreach_private.contacts c),
 'engagements',(select coalesce(jsonb_agg((to_jsonb(e)-'notes')||jsonb_build_object('notes',case when manager then e.notes else null end,'notes_redacted',not manager,
  'can_edit',outreach_private.can_work_engagement(e.id,actor),'can_log',outreach_private.can_work_engagement(e.id,actor),'can_assign',manager and outreach_private.can_work_engagement(e.id,actor)) order by e.created_at,e.id),'[]') from outreach_private.engagements e where e.season_id=sid),
 'conversations',(select coalesce(jsonb_agg((to_jsonb(c)-'summary')||jsonb_build_object('summary',case when manager or c.created_by=actor then c.summary else null end,
  'summary_redacted',not(manager or c.created_by=actor),'author_name',coalesce(p.display_name,'Team member'),'can_edit',false) order by c.occurred_on desc,c.created_at desc,c.id),'[]') from outreach_private.conversations c join outreach_private.engagements e on e.id=c.engagement_id join public.profiles p on p.id=c.created_by where e.season_id=sid),
 'pledges',case when manager then (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]') from outreach_private.pledges p join outreach_private.engagements e on e.id=p.engagement_id where e.season_id=sid) else '[]'::jsonb end,
 'recognition',case when manager then (select coalesce(jsonb_agg(to_jsonb(r) order by r.due_on,r.id),'[]') from outreach_private.recognition r join outreach_private.engagements e on e.id=r.engagement_id where e.season_id=sid) else '[]'::jsonb end,
 'income',case when can_finance then (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'season_id',i.season_id,'source',i.source,'income_type',i.income_type,'amount',i.amount,'status',i.status,'expected_on',outreach_private.safe_date(i.expected_on),'received_on',outreach_private.safe_date(i.received_on),'reference',i.reference) order by i.created_at desc,i.id),'[]') from public.finance_income i where i.season_id=sid) else '[]'::jsonb end,
 'income_links',case when can_finance then (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at,l.id),'[]') from outreach_private.income_links l join outreach_private.pledges p on p.id=l.pledge_id join outreach_private.engagements e on e.id=p.engagement_id where e.season_id=sid) else '[]'::jsonb end);
end $$;
create function outreach_private.save(entity text,p jsonb,request_id uuid,expected_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; ident uuid; table_name text; previous jsonb; after_value jsonb; result jsonb; receipt outreach_private.requests; input_payload jsonb:=p; manager boolean;
 org uuid; eng uuid; sid uuid; owner uuid; contact uuid; pledge uuid; current_version integer;
begin
 actor:=outreach_private.require_participant(expected_actor);manager:=outreach_private.manager(actor);
 if not manager and entity in ('pledge','recognition') then raise exception 'Mentor oversight required' using errcode='42501';end if;
 if expected_actor is null or request_id is null or p is null or jsonb_typeof(p)<>'object' then raise exception 'Actor, request and object payload required' using errcode='22023';end if;
 table_name:=case entity when 'prospect' then 'organizations' when 'organization' then 'organizations' when 'contact' then 'contacts' when 'engagement' then 'engagements' when 'conversation' then 'conversations' when 'pledge' then 'pledges' when 'recognition' then 'recognition' end;
 if table_name is null then raise exception 'Unknown Outreach entity' using errcode='22023';end if;
 ident:=nullif(p->>'id','')::uuid;current_version:=(p->>'version')::integer;
 if ident is null or current_version is null or current_version<0 then raise exception 'Record ID and version required' using errcode='22023';end if;
 -- Small-team V1: one short transaction lock avoids cross-entity races. No I/O
 -- or notification dispatch is performed while holding it.
 perform pg_advisory_xact_lock(4418,80);
 actor:=outreach_private.require_participant(expected_actor);manager:=outreach_private.manager(actor);
 if not manager and entity in ('pledge','recognition') then raise exception 'Mentor oversight required' using errcode='42501';end if;
 select * into receipt from outreach_private.requests r where r.actor_id=actor and r.request_id=save.request_id;
 if found then
  if receipt.operation='canceled' then raise exception 'Request was canceled before application' using errcode='22023';end if;
  if receipt.operation<>entity or receipt.payload<>input_payload then raise exception 'Request ID already used for different data' using errcode='22023';end if;
  perform outreach_private.require_receipt(receipt,actor);
  return receipt.result;
 end if;
 execute format('select to_jsonb(t) from outreach_private.%I t where id=$1 for update',table_name) into previous using ident;
 actor:=outreach_private.require_participant(expected_actor);manager:=outreach_private.manager(actor);
 if not manager and entity in ('pledge','recognition') then raise exception 'Mentor oversight required' using errcode='42501';end if;
 if (previous is null and current_version<>0) or (previous is not null and current_version<>(previous->>'version')::integer) then
  raise exception 'Changed by another teammate. Refresh before saving.' using errcode='40001';end if;
 if entity='prospect' and previous is not null then raise exception 'Prospect identity already exists' using errcode='40001';end if;
 if previous is not null and entity='conversation' then raise exception 'Conversation entries are append-only; add a correction note' using errcode='22023';end if;
 if previous is not null then
  if (entity='contact' and previous->>'organization_id' is distinct from p->>'organization_id') or
     (entity='engagement' and (previous->>'organization_id' is distinct from p->>'organization_id' or previous->>'season_id' is distinct from p->>'season_id')) or
     (entity in ('pledge','recognition') and previous->>'engagement_id' is distinct from p->>'engagement_id') then
   raise exception 'Organization, engagement and season links cannot be moved' using errcode='22023';end if;
 end if;
 if entity='prospect' then org:=ident;sid:=(p->>'season_id')::uuid;eng:=nullif(p->>'engagement_id','')::uuid;
  if eng is null then raise exception 'New engagement ID required' using errcode='22023';end if;
 elsif entity='contact' then org:=(p->>'organization_id')::uuid;
 elsif entity='engagement' then org:=(p->>'organization_id')::uuid;sid:=(p->>'season_id')::uuid;
 elsif entity in ('conversation','pledge','recognition') then
  eng:=(p->>'engagement_id')::uuid;
  select e.organization_id,e.season_id into org,sid from outreach_private.engagements e where e.id=eng for update;
  if not found then raise exception 'Engagement unavailable' using errcode='22023';end if;
 end if;
 if entity not in ('organization','prospect') then
  perform 1 from outreach_private.organizations where id=org and active for share;
  if not found then raise exception 'Active organization required' using errcode='22023';end if;
 end if;
 if entity in ('prospect','engagement','conversation','pledge','recognition') then
  perform 1 from public.finance_seasons where id=sid and status<>'closed' for share;
  if not found then raise exception 'Open Finance season required' using errcode='22023';end if;
 end if;
 if entity in ('prospect','engagement','recognition') then
  owner:=nullif(p->>'owner_id','')::uuid;
  if entity='prospect' or (entity='engagement' and not manager and previous is null) then
   if owner is not null and owner<>actor then raise exception 'Only mentors can assign outreach' using errcode='42501';end if;owner:=actor;
  elsif entity='engagement' and not manager then
   if p ? 'owner_id' and owner is distinct from (previous->>'owner_id')::uuid then raise exception 'Only mentors can assign outreach' using errcode='42501';end if;owner:=(previous->>'owner_id')::uuid;
  end if;
  -- Preserving an old assignment does not grant that owner current eligibility.
  -- A still-active creator can edit without a mentor-only cleanup dependency.
  if owner is not null and (entity<>'engagement' or previous is null or owner is distinct from (previous->>'owner_id')::uuid) then
   perform 1 from public.profiles where id=owner and active and role::text in ('admin','mentor','student','lead') for share;
   if not found then raise exception 'Choose an active eligible owner' using errcode='22023';end if;
  end if;
 end if;
 if entity='conversation' then
  contact:=nullif(p->>'contact_id','')::uuid;
  if contact is not null then
   perform 1 from outreach_private.contacts where id=contact and organization_id=org and active for share;
   if not found then raise exception 'Choose an active contact from this organization' using errcode='22023';end if;
  end if;
 elsif entity='recognition' then
  pledge:=nullif(p->>'pledge_id','')::uuid;
  if pledge is not null then
   perform 1 from outreach_private.pledges where id=pledge and engagement_id=eng for share;
   if not found then raise exception 'Choose a pledge from this engagement' using errcode='22023';end if;
  end if;
 elsif entity='pledge' and previous is not null and previous->>'kind' is distinct from p->>'kind' and exists(select 1 from outreach_private.income_links where pledge_id=ident) then
  raise exception 'A Finance-linked pledge must remain cash' using errcode='22023';
 end if;
 -- Recheck live authority after every potentially blocking relationship lock.
 actor:=outreach_private.require_participant(expected_actor);manager:=outreach_private.manager(actor);
 if not manager and entity in ('pledge','recognition') then raise exception 'Mentor oversight required' using errcode='42501';end if;
 if p ? 'created_by' and nullif(p->>'created_by','')::uuid is distinct from coalesce((previous->>'created_by')::uuid,actor) then
  raise exception 'Record authorship cannot be changed' using errcode='42501';end if;
 if entity='conversation' and ((p ? 'author_id' and nullif(p->>'author_id','')::uuid is distinct from actor) or (p ? 'sender_id' and nullif(p->>'sender_id','')::uuid is distinct from actor)) then
  raise exception 'Conversation author is the current account' using errcode='42501';end if;
 if not manager then
  if entity='engagement' and owner is distinct from (case when previous is null then actor else (previous->>'owner_id')::uuid end) then
   raise exception 'Only mentors can assign outreach' using errcode='42501';end if;
  if previous is not null and not outreach_private.can_edit_record(entity,ident,actor) then raise exception 'This record is not owned or assigned to you' using errcode='42501';end if;
  if entity='contact' and not outreach_private.can_add_contact(org,actor) then raise exception 'This sponsor is not owned or assigned to you' using errcode='42501';end if;
  if entity='engagement' and previous is null and not exists(select 1 from outreach_private.organizations where id=org and created_by=actor) then
   raise exception 'Only mentors can assign an existing sponsor prospect' using errcode='42501';end if;
  if entity='conversation' and not outreach_private.can_work_engagement(eng,actor) then raise exception 'This prospect is not owned or assigned to you' using errcode='42501';end if;
  if entity='engagement' and p->>'stage'='committed' and previous->>'stage' is distinct from 'committed' then raise exception 'Only mentors can mark a commitment' using errcode='42501';end if;
  if entity in ('organization','contact') and p ? 'active' and (p->>'active')::boolean is distinct from coalesce((previous->>'active')::boolean,true) then raise exception 'Only mentors can archive contacts or sponsors' using errcode='42501';end if;
  -- A redacted field is never a write: preserve the stored mentor notes/flags.
  p:=jsonb_set(p,'{notes}',coalesce(previous->'notes','""'::jsonb));
  if entity in ('organization','contact') then p:=jsonb_set(p,'{active}',coalesce(previous->'active','true'::jsonb));end if;
 end if;
 if entity='prospect' then
  insert into outreach_private.organizations(id,kind,name,website,notes,created_by)
  values(ident,p->>'kind',trim(p->>'name'),trim(coalesce(p->>'website','')),'',actor);
  insert into outreach_private.engagements(id,organization_id,season_id,stage,owner_id,next_follow_up_on,notes,created_by)
  values(eng,ident,sid,'prospect',actor,nullif(p->>'next_follow_up_on','')::date,'',actor);
  insert into outreach_private.history(entity,entity_id,actor_id,request_id,action,before_data,after_data)
  select 'engagement',eng,actor,save.request_id,'created',null,to_jsonb(e) from outreach_private.engagements e where e.id=eng;
  result:=jsonb_build_object('id',ident,'version',1);
 elsif entity='organization' then
  insert into outreach_private.organizations(id,kind,name,website,notes,active,created_by)
  values(ident,p->>'kind',trim(p->>'name'),trim(coalesce(p->>'website','')),coalesce(p->>'notes',''),coalesce((p->>'active')::boolean,true),actor)
  on conflict(id) do update set kind=excluded.kind,name=excluded.name,website=excluded.website,notes=excluded.notes,active=excluded.active,version=organizations.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 elsif entity='contact' then
  insert into outreach_private.contacts(id,organization_id,name,title,email,phone,notes,active,created_by)
  values(ident,org,trim(p->>'name'),coalesce(p->>'title',''),trim(coalesce(p->>'email','')),coalesce(p->>'phone',''),coalesce(p->>'notes',''),coalesce((p->>'active')::boolean,true),actor)
  on conflict(id) do update set name=excluded.name,title=excluded.title,email=excluded.email,phone=excluded.phone,notes=excluded.notes,active=excluded.active,version=contacts.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 elsif entity='engagement' then
  insert into outreach_private.engagements(id,organization_id,season_id,stage,owner_id,next_follow_up_on,notes,created_by)
  values(ident,org,sid,p->>'stage',owner,nullif(p->>'next_follow_up_on','')::date,coalesce(p->>'notes',''),actor)
  on conflict(id) do update set stage=excluded.stage,owner_id=excluded.owner_id,next_follow_up_on=excluded.next_follow_up_on,notes=excluded.notes,version=engagements.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 elsif entity='conversation' then
  insert into outreach_private.conversations(id,engagement_id,contact_id,occurred_on,channel,summary,created_by)
  values(ident,eng,contact,(p->>'occurred_on')::date,p->>'channel',trim(p->>'summary'),actor)
  returning jsonb_build_object('id',id,'version',version) into result;
 elsif entity='pledge' then
  insert into outreach_private.pledges(id,engagement_id,kind,amount,description,promised_on,expected_on,status,created_by)
  values(ident,eng,p->>'kind',nullif(p->>'amount','')::numeric,trim(p->>'description'),(p->>'promised_on')::date,nullif(p->>'expected_on','')::date,p->>'status',actor)
  on conflict(id) do update set kind=excluded.kind,amount=excluded.amount,description=excluded.description,promised_on=excluded.promised_on,expected_on=excluded.expected_on,status=excluded.status,version=pledges.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 else
  insert into outreach_private.recognition(id,engagement_id,pledge_id,owner_id,kind,description,due_on,status,fulfilled_on,fulfillment_note,created_by)
  values(ident,eng,pledge,owner,p->>'kind',trim(p->>'description'),nullif(p->>'due_on','')::date,p->>'status',nullif(p->>'fulfilled_on','')::date,coalesce(p->>'fulfillment_note',''),actor)
  on conflict(id) do update set pledge_id=excluded.pledge_id,owner_id=excluded.owner_id,kind=excluded.kind,description=excluded.description,due_on=excluded.due_on,status=excluded.status,fulfilled_on=excluded.fulfilled_on,fulfillment_note=excluded.fulfillment_note,version=recognition.version+1,updated_at=clock_timestamp()
  returning jsonb_build_object('id',id,'version',version) into result;
 end if;
 execute format('select to_jsonb(t) from outreach_private.%I t where id=$1',table_name) into after_value using ident;
 insert into outreach_private.history(entity,entity_id,actor_id,request_id,action,before_data,after_data)
 values(entity,ident,actor,save.request_id,case when previous is null then 'created' else 'updated' end,previous,after_value);
 -- Preserve the exact request body separately from server-authored after_data.
 insert into outreach_private.requests(actor_id,request_id,operation,payload,result)
 values(actor,save.request_id,entity,input_payload,result);
 return result;
exception when others then
 -- CHECK/NOT NULL diagnostics can echo the proposed row, including restored
 -- private mentor notes. Sanitize at this directly executable private boundary,
 -- not just the public wrapper. Rethrowing preserves rollback and SQLSTATE.
 raise exception using errcode=sqlstate,
  message=case when sqlstate in ('42501','40001','22023') then sqlerrm else 'Outreach change rejected. Check the fields and refresh before retrying.' end,
  detail='',hint='';
end $$;
create function outreach_private.link_income(pledge_id uuid,income_id uuid,request_id uuid,expected_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; pledge outreach_private.pledges; eng outreach_private.engagements; income public.finance_income;
 receipt outreach_private.requests; link outreach_private.income_links; result jsonb; payload jsonb;
begin
 actor:=outreach_private.require_manager(expected_actor);
 if expected_actor is null or pledge_id is null or income_id is null or request_id is null then raise exception 'Actor, pledge, income and request required' using errcode='22023';end if;
 if not coalesce(finance_private.can_manage_budget(),false) then raise exception 'Finance budget access required' using errcode='42501';end if;
 payload:=jsonb_build_object('pledge_id',pledge_id,'income_id',income_id);
 perform pg_advisory_xact_lock(4418,80);
 actor:=outreach_private.require_manager(expected_actor);
 if not coalesce(finance_private.can_manage_budget(),false) then raise exception 'Finance budget access required' using errcode='42501';end if;
 select * into receipt from outreach_private.requests r where r.actor_id=actor and r.request_id=link_income.request_id;
 if found then
  if receipt.operation='canceled' then raise exception 'Request was canceled before application' using errcode='22023';end if;
  if receipt.operation<>'link_income' or receipt.payload<>payload then raise exception 'Request ID already used for different data' using errcode='22023';end if;
  return receipt.result;
 end if;
 select * into pledge from outreach_private.pledges p where p.id=pledge_id for update;
 if not found or pledge.kind<>'cash' or pledge.status<>'pledged' then raise exception 'An active cash pledge is required' using errcode='22023';end if;
 select * into eng from outreach_private.engagements where id=pledge.engagement_id for share;
 perform 1 from outreach_private.organizations where id=eng.organization_id and active for share;
 if not found then raise exception 'Active organization required' using errcode='22023';end if;
 perform 1 from public.finance_seasons where id=eng.season_id and status<>'closed' for share;
 if not found then raise exception 'Open Finance season required' using errcode='22023';end if;
 select * into income from public.finance_income i where i.id=income_id for share;
 actor:=outreach_private.require_manager(expected_actor);
 if not coalesce(finance_private.can_manage_budget(),false) then raise exception 'Finance budget access required' using errcode='42501';end if;
 if income.id is null or income.season_id<>eng.season_id then raise exception 'Choose existing Finance income in this season' using errcode='22023';end if;
 select * into link from outreach_private.income_links l where l.income_id=link_income.income_id;
 if found and link.pledge_id<>link_income.pledge_id then raise exception 'Income is already linked to another pledge' using errcode='22023';end if;
 if link.id is null then
  insert into outreach_private.income_links(pledge_id,income_id,created_by) values(link_income.pledge_id,link_income.income_id,actor) returning * into link;
  insert into outreach_private.history(entity,entity_id,actor_id,request_id,action,before_data,after_data)
  values('income_link',link.id,actor,link_income.request_id,'linked',null,to_jsonb(link));
 end if;
 result:=jsonb_build_object('id',link.id,'version',1);
 insert into outreach_private.requests(actor_id,request_id,operation,payload,result) values(actor,link_income.request_id,'link_income',payload,result);
 return result;
end $$;
create function outreach_private.request_status(request_id uuid,expected_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; receipt outreach_private.requests;
begin
 actor:=outreach_private.require_participant(expected_actor);
 if expected_actor is null or request_id is null then raise exception 'Actor and request required' using errcode='22023';end if;
 select * into receipt from outreach_private.requests r where r.actor_id=actor and r.request_id=request_status.request_id;
 if not found then return jsonb_build_object('status','not_found');end if;
 if receipt.operation='canceled' then return jsonb_build_object('status','canceled');end if;
 if receipt.operation='link_income' and not coalesce(finance_private.can_manage_budget(),false) then raise exception 'Finance budget access required' using errcode='42501';end if;
 return jsonb_build_object('status','applied','result',receipt.result);
end $$;
-- Resolves an uncertain request without undoing an applied business change.
-- Taking the same lock as save/link means a late original request cannot run
-- after this immutable tombstone commits. No contact payload is needed.
create function outreach_private.cancel_request(request_id uuid,expected_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; receipt outreach_private.requests;
begin
 actor:=outreach_private.require_participant(expected_actor);
 if expected_actor is null or request_id is null then raise exception 'Actor and request required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(4418,80);
 actor:=outreach_private.require_participant(expected_actor);
 select * into receipt from outreach_private.requests r where r.actor_id=actor and r.request_id=cancel_request.request_id;
 if found then
  if receipt.operation='canceled' then return jsonb_build_object('status','canceled');end if;
  if receipt.operation='link_income' and not coalesce(finance_private.can_manage_budget(),false) then raise exception 'Finance budget access required' using errcode='42501';end if;
  return jsonb_build_object('status','applied','result',receipt.result);
 end if;
 insert into outreach_private.requests(actor_id,request_id,operation,payload,result)
 values(actor,cancel_request.request_id,'canceled','{}',jsonb_build_object('status','canceled'));
 return jsonb_build_object('status','canceled');
end $$;
-- Five exposed invoker wrappers, five narrowly granted private entry points.
-- Definer ownership is needed only to reach RPC-only private storage. Each entry
-- point performs the current-user authorization check before data is accessed.
create function public.outreach_context(selected_season uuid default null) returns jsonb language sql volatile security invoker set search_path='' as $$select outreach_private.context(selected_season)$$;
create function public.outreach_save(entity text,p jsonb,request_id uuid,expected_actor uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select outreach_private.save(entity,p,request_id,expected_actor)$$;
create function public.outreach_link_income(pledge_id uuid,income_id uuid,request_id uuid,expected_actor uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select outreach_private.link_income(pledge_id,income_id,request_id,expected_actor)$$;
create function public.outreach_request_status(request_id uuid,expected_actor uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select outreach_private.request_status(request_id,expected_actor)$$;
create function public.outreach_cancel_request(request_id uuid,expected_actor uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select outreach_private.cancel_request(request_id,expected_actor)$$;
revoke all on all functions in schema outreach_private from public,anon,authenticated,service_role;
revoke all on function public.outreach_context(uuid),public.outreach_save(text,jsonb,uuid,uuid),public.outreach_link_income(uuid,uuid,uuid,uuid),public.outreach_request_status(uuid,uuid),public.outreach_cancel_request(uuid,uuid) from public,anon,authenticated,service_role;
grant usage on schema outreach_private to authenticated;
grant execute on function outreach_private.context(uuid),outreach_private.save(text,jsonb,uuid,uuid),outreach_private.link_income(uuid,uuid,uuid,uuid),outreach_private.request_status(uuid,uuid),outreach_private.cancel_request(uuid,uuid) to authenticated;
grant execute on function public.outreach_context(uuid),public.outreach_save(text,jsonb,uuid,uuid),public.outreach_link_income(uuid,uuid,uuid,uuid),public.outreach_request_status(uuid,uuid),public.outreach_cancel_request(uuid,uuid) to authenticated;
commit;
