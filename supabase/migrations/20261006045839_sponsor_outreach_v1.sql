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
create function outreach_private.context(selected_season uuid default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; sid uuid; can_finance boolean;
begin
 actor:=outreach_private.require_manager();
 select id into sid from public.finance_seasons where selected_season is null or id=selected_season
 order by (status='active') desc,created_at desc,id limit 1;
 if selected_season is not null and sid is null then raise exception 'Season unavailable' using errcode='22023';end if;
 can_finance:=coalesce(finance_private.can_manage_budget(),false);
 return jsonb_build_object('contract_version',1,'user_id',actor,'can_manage',true,'can_link_finance',can_finance,'season_id',sid,
 'seasons',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'starts_on',s.starts_on,'ends_on',s.ends_on) order by s.created_at desc,s.id),'[]') from public.finance_seasons s),
 'owners',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name,id),'[]') from public.profiles where active and role::text in ('admin','mentor')),
 'organizations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.name,o.id),'[]') from outreach_private.organizations o),
 'contacts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name,c.id),'[]') from outreach_private.contacts c),
 'engagements',(select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from outreach_private.engagements e where e.season_id=sid),
 'conversations',(select coalesce(jsonb_agg(to_jsonb(c) order by c.occurred_on desc,c.created_at desc,c.id),'[]') from outreach_private.conversations c join outreach_private.engagements e on e.id=c.engagement_id where e.season_id=sid),
 'pledges',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]') from outreach_private.pledges p join outreach_private.engagements e on e.id=p.engagement_id where e.season_id=sid),
 'recognition',(select coalesce(jsonb_agg(to_jsonb(r) order by r.due_on,r.id),'[]') from outreach_private.recognition r join outreach_private.engagements e on e.id=r.engagement_id where e.season_id=sid),
 'income',case when can_finance then (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'season_id',i.season_id,'source',i.source,'income_type',i.income_type,'amount',i.amount,'status',i.status,'expected_on',i.expected_on,'received_on',i.received_on,'reference',i.reference) order by i.created_at desc,i.id),'[]') from public.finance_income i where i.season_id=sid) else '[]'::jsonb end,
 'income_links',case when can_finance then (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at,l.id),'[]') from outreach_private.income_links l join outreach_private.pledges p on p.id=l.pledge_id join outreach_private.engagements e on e.id=p.engagement_id where e.season_id=sid) else '[]'::jsonb end);
end $$;
create function outreach_private.save(entity text,p jsonb,request_id uuid,expected_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; ident uuid; table_name text; previous jsonb; after_value jsonb; result jsonb; receipt outreach_private.requests;
 org uuid; eng uuid; sid uuid; owner uuid; contact uuid; pledge uuid; current_version integer;
begin
 actor:=outreach_private.require_manager(expected_actor);
 if expected_actor is null or request_id is null or p is null or jsonb_typeof(p)<>'object' then raise exception 'Actor, request and object payload required' using errcode='22023';end if;
 table_name:=case entity when 'organization' then 'organizations' when 'contact' then 'contacts' when 'engagement' then 'engagements' when 'conversation' then 'conversations' when 'pledge' then 'pledges' when 'recognition' then 'recognition' end;
 if table_name is null then raise exception 'Unknown Outreach entity' using errcode='22023';end if;
 ident:=nullif(p->>'id','')::uuid;current_version:=(p->>'version')::integer;
 if ident is null or current_version is null or current_version<0 then raise exception 'Record ID and version required' using errcode='22023';end if;
 -- Small-team V1: one short transaction lock avoids cross-entity races. No I/O
 -- or notification dispatch is performed while holding it.
 perform pg_advisory_xact_lock(4418,80);
 actor:=outreach_private.require_manager(expected_actor);
 select * into receipt from outreach_private.requests r where r.actor_id=actor and r.request_id=save.request_id;
 if found then
  if receipt.operation='canceled' then raise exception 'Request was canceled before application' using errcode='22023';end if;
  if receipt.operation<>entity or receipt.payload<>p then raise exception 'Request ID already used for different data' using errcode='22023';end if;
  return receipt.result;
 end if;
 execute format('select to_jsonb(t) from outreach_private.%I t where id=$1 for update',table_name) into previous using ident;
 actor:=outreach_private.require_manager(expected_actor);
 if (previous is null and current_version<>0) or (previous is not null and current_version<>(previous->>'version')::integer) then
  raise exception 'Changed by another teammate. Refresh before saving.' using errcode='40001';end if;
 if previous is not null and entity='conversation' then raise exception 'Conversation entries are append-only; add a correction note' using errcode='22023';end if;
 if previous is not null then
  if (entity='contact' and previous->>'organization_id' is distinct from p->>'organization_id') or
     (entity='engagement' and (previous->>'organization_id' is distinct from p->>'organization_id' or previous->>'season_id' is distinct from p->>'season_id')) or
     (entity in ('pledge','recognition') and previous->>'engagement_id' is distinct from p->>'engagement_id') then
   raise exception 'Organization, engagement and season links cannot be moved' using errcode='22023';end if;
 end if;
 if entity='contact' then org:=(p->>'organization_id')::uuid;
 elsif entity='engagement' then org:=(p->>'organization_id')::uuid;sid:=(p->>'season_id')::uuid;
 elsif entity in ('conversation','pledge','recognition') then
  eng:=(p->>'engagement_id')::uuid;
  select e.organization_id,e.season_id into org,sid from outreach_private.engagements e where e.id=eng for update;
  if not found then raise exception 'Engagement unavailable' using errcode='22023';end if;
 end if;
 if entity<>'organization' then
  perform 1 from outreach_private.organizations where id=org and active for share;
  if not found then raise exception 'Active organization required' using errcode='22023';end if;
 end if;
 if entity in ('engagement','conversation','pledge','recognition') then
  perform 1 from public.finance_seasons where id=sid and status<>'closed' for share;
  if not found then raise exception 'Open Finance season required' using errcode='22023';end if;
 end if;
 if entity in ('engagement','recognition') then
  owner:=nullif(p->>'owner_id','')::uuid;
  if owner is not null then
   perform 1 from public.profiles where id=owner and active and role::text in ('admin','mentor') for share;
   if not found then raise exception 'Choose an active admin or mentor owner' using errcode='22023';end if;
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
 actor:=outreach_private.require_manager(expected_actor);
 if entity='organization' then
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
 values(actor,save.request_id,entity,save.p,result);
 return result;
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
 actor:=outreach_private.require_manager(expected_actor);
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
 actor:=outreach_private.require_manager(expected_actor);
 if expected_actor is null or request_id is null then raise exception 'Actor and request required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(4418,80);
 actor:=outreach_private.require_manager(expected_actor);
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
