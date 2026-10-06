-- LOCAL DRAFT ONLY. Additive Assembly & Testing workspace on canonical Planning/Fabrication.
-- No deployment, Storage permissions, Inventory/Finance writes, or Sprint Review edits.
begin;
select pg_advisory_xact_lock(4418);
select pg_advisory_xact_lock(4418,30);
create schema assembly_private;
revoke all on schema assembly_private from public,anon,authenticated,service_role;

create table assembly_private.boards (
 board_id uuid primary key references public.planning_boards(id),
 version integer not null default 0 check(version between 0 and 999999999)
);
create table assembly_private.components (
 id uuid primary key, board_id uuid not null references public.planning_boards(id),
 name text not null, quantity integer not null check(quantity between 1 and 100000),
 status text not null check(status in ('needed','ordered','received','installed')), notes text not null default '',
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index assembly_components_board on assembly_private.components(board_id,created_at,id);
create table assembly_private.task_links (
 board_id uuid not null references public.planning_boards(id), task_id uuid not null references public.planning_tasks(id),
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(), primary key(board_id,task_id)
);
create index assembly_task_links_task on assembly_private.task_links(task_id);
create table assembly_private.checks (
 id uuid primary key, board_id uuid not null references public.planning_boards(id), title text not null,
 kind text not null check(kind in ('fit','function','durability','other')), outcome text not null check(outcome in ('passed','failed','blocked')),
 procedure text not null default '', expected text not null default '', observed text not null default '', evidence_url text not null default '',
 revision_id uuid references public.fabrication_revisions(id), rework_task_id uuid references public.planning_tasks(id),
 supersedes_id uuid unique references assembly_private.checks(id),
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 check(id is distinct from supersedes_id), check(outcome<>'passed' or rework_task_id is null)
);
create index assembly_checks_board on assembly_private.checks(board_id,created_at,id);
create index assembly_checks_revision on assembly_private.checks(revision_id);
create index assembly_checks_rework on assembly_private.checks(rework_task_id);
create table assembly_private.snapshots (
 id uuid primary key, board_id uuid not null references public.planning_boards(id), notes text not null default '',
 facts jsonb not null, summary text not null, created_by uuid not null, created_at timestamptz not null default clock_timestamp()
);
create index assembly_snapshots_board on assembly_private.snapshots(board_id,created_at,id);
create table assembly_private.requests (
 actor_id uuid not null, request_id uuid not null, status text not null check(status in ('applied','cancelled')),
 action text, payload jsonb, entity_id uuid, version integer, board_id uuid references public.planning_boards(id),
 created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_id)
);
create index assembly_requests_board on assembly_private.requests(board_id);
create table assembly_private.history (
 id bigint generated always as identity primary key, board_id uuid not null references public.planning_boards(id),
 actor_id uuid not null, request_id uuid not null, action text not null, entity_id uuid not null,
 before_data jsonb, after_data jsonb not null, created_at timestamptz not null default clock_timestamp(), unique(actor_id,request_id)
);
create index assembly_history_board on assembly_private.history(board_id);

do $$declare t text;begin
 foreach t in array array['boards','components','task_links','checks','snapshots','requests','history'] loop
  execute format('alter table assembly_private.%I enable row level security',t);
  execute format('revoke all on table assembly_private.%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;
revoke all on all sequences in schema assembly_private from public,anon,authenticated,service_role;
create function assembly_private.immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception using errcode='AS403',message='Immutable Assembly record';end$$;
create trigger assembly_check_immutable before update or delete on assembly_private.checks for each row execute function assembly_private.immutable();
create trigger assembly_snapshot_immutable before update or delete on assembly_private.snapshots for each row execute function assembly_private.immutable();
create trigger assembly_request_immutable before update or delete on assembly_private.requests for each row execute function assembly_private.immutable();
create trigger assembly_history_immutable before update or delete on assembly_private.history for each row execute function assembly_private.immutable();

create function assembly_private.error(code text) returns text language sql immutable set search_path='' as $$select case code
 when 'AS401' then 'Your account changed. Reload Assembly & Testing before continuing.'
 when 'AS403' then 'This Assembly & Testing action is unavailable for your current access.'
 when 'AS409' then 'Changed by another teammate. Refresh before continuing.'
 when 'AS412' then 'This request ID was already used for a different change.'
 when 'AS413' then 'Assembly & Testing record limit reached. Ask an administrator to review capacity.'
 when 'AS422' then 'Invalid Assembly & Testing request. Check the fields.'
 else 'Assembly & Testing could not complete this request. Check its status before retrying.' end$$;
create function assembly_private.actor(expected uuid) returns void language plpgsql set search_path='' as $$begin
 if expected is null or expected is distinct from auth.uid() or not fabrication_private.member(expected) then raise exception using errcode='AS401',message='Account changed';end if;
end$$;
create function assembly_private.keys(p jsonb,fields text[]) returns void language plpgsql set search_path='' as $$begin
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where not(k=any(fields))) or exists(select 1 from unnest(fields) k where not(p?k)) then raise exception using errcode='AS422',message='Invalid fields';end if;
end$$;
create function assembly_private.uid(v jsonb) returns uuid language plpgsql immutable set search_path='' as $$begin
 if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='AS422',message='Invalid identity';end if;return (v#>>'{}')::uuid;
end$$;
create function assembly_private.text_field(p jsonb,k text,n integer,required boolean default false) returns void language plpgsql set search_path='' as $$begin
 if jsonb_typeof(p->k) is distinct from 'string' or fabrication_private.units(p->>k)>n or (required and fabrication_private.clean(p->>k)='') then raise exception using errcode='AS422',message='Invalid text';end if;
end$$;
-- Evidence is an inert external link, never fetched or used to create server-side requests.
-- Conservative ASCII DNS syntax rejects credentials, IP literals, localhost and control/space tricks.
-- IDNA/punycode labels are outside this MVP: PostgreSQL does not validate WHATWG/IDNA equivalently.
create function assembly_private.evidence_url(v text) returns boolean language plpgsql immutable set search_path='' as $$declare host text;port text;begin
 if v='' then return true;end if;
 if v is null or v !~* '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[0-9]{1,5})?([/?#]|$)'
 or v ~ '[[:space:][:cntrl:]]' or v ~ U&'[\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
 or position(chr(92) in v)>0 or v ~* '%(0[0-9a-f]|1[0-9a-f]|7f)' then return false;end if;
 host:=lower(substring(v from '(?i)^https://([^/:?#]+)'));
 if host ~ '(^|\.)xn--' or host ~ '(^|\.)(localhost|local|internal|home|lan)$' or length(host)>253 then return false;end if;
 port:=substring(v from '(?i)^https://[^/:?#]+:([0-9]+)');
 return port is null or port::integer between 1 and 65535;
end$$;
create function assembly_private.receipt(who uuid,key uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce((select jsonb_build_object('request_id',q.request_id,'status',q.status,'action',q.action,'entity_id',q.entity_id,'version',q.version) from assembly_private.requests q where q.actor_id=who and q.request_id=key),jsonb_build_object('request_id',key,'status','unknown','action',null,'entity_id',null,'version',null))
$$;
create function assembly_private.facts(bid uuid) returns jsonb language sql stable set search_path='' as $$
 with current_checks as (
  select c.*,c.revision_id is not null and not exists(select 1 from public.fabrication_parts p where p.board_id=bid and p.current_revision_id=c.revision_id) stale
  from assembly_private.checks c where c.board_id=bid and not exists(select 1 from assembly_private.checks newer where newer.supersedes_id=c.id)
 ), linked_tasks as (select t.* from public.planning_tasks t join assembly_private.task_links l on l.task_id=t.id and l.board_id=t.board_id where t.board_id=bid)
 select jsonb_build_object(
  'parts_total',(select count(*) from public.fabrication_parts where board_id=bid),'parts_done',(select count(*) from public.fabrication_parts where board_id=bid and status='done'),
  'components_total',(select count(*) from assembly_private.components where board_id=bid),'components_available',(select count(*) from assembly_private.components where board_id=bid and status in ('received','installed')),
  'tasks_total',(select count(*) from linked_tasks),'tasks_done',(select count(*) from linked_tasks where status='done'),'tasks_blocked',(select count(*) from linked_tasks where status='blocked'),
  'checks_total',(select count(*) from current_checks),'checks_passed',(select count(*) from current_checks where not stale and outcome='passed'),
  'checks_failed',(select count(*) from current_checks where not stale and outcome='failed'),'checks_blocked',(select count(*) from current_checks where not stale and outcome='blocked'),'checks_stale',(select count(*) from current_checks where stale))
$$;

-- Narrow SECURITY DEFINER gateways mirror the canonical feature boundary: no direct data/helper grants.
-- Locking precedes current-row actor/authority checks, including reads, to serialize with shared authority edits.
create function public.assembly_context(board_id uuid,expected_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fabrication_private.lock_authority();perform assembly_private.actor(expected_actor);
 if not fabrication_private.visible(expected_actor,board_id) then raise exception using errcode='AS403',message='Project unavailable';end if;
 return jsonb_build_object('user_id',expected_actor,'board_id',board_id,'version',coalesce((select b.version from assembly_private.boards b where b.board_id=assembly_context.board_id),0),'can_edit',fabrication_private.can_submit(expected_actor,board_id),'loaded_at',clock_timestamp(),
 'components',(select coalesce(jsonb_agg(to_jsonb(c)-'board_id' order by c.created_at,c.id),'[]') from assembly_private.components c where c.board_id=assembly_context.board_id),
 'parts',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',r.name,'status',p.status,'version',p.version,'current_revision_id',r.id,'revision_number',r.revision_number,'quantity',r.quantity) order by p.created_at,p.id),'[]') from public.fabrication_parts p join public.fabrication_revisions r on r.id=p.current_revision_id where p.board_id=assembly_context.board_id),
 'revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'part_id',r.part_id,'name',r.name,'revision_number',r.revision_number) order by r.part_id,r.revision_number),'[]') from public.fabrication_revisions r join public.fabrication_parts p on p.id=r.part_id where p.board_id=assembly_context.board_id),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('owner_ids',coalesce((select jsonb_agg(a.user_id order by a.user_id) from public.planning_task_assignees a where a.task_id=t.id),'[]'),'owners',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',planning_review_private.label(p.display_name,'Unnamed teammate'),'active',p.active) order by p.id) from public.planning_task_assignees a join public.profiles p on p.id=a.user_id where a.task_id=t.id),'[]')) order by t.created_at,t.id),'[]') from public.planning_tasks t where t.board_id=assembly_context.board_id),
 'linked_task_ids',(select coalesce(jsonb_agg(l.task_id order by l.task_id),'[]') from assembly_private.task_links l join public.planning_tasks t on t.id=l.task_id and t.board_id=l.board_id where l.board_id=assembly_context.board_id),
 'checks',(select coalesce(jsonb_agg(to_jsonb(c)-'board_id' order by c.created_at,c.id),'[]') from assembly_private.checks c where c.board_id=assembly_context.board_id),
 'snapshots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id),'[]') from assembly_private.snapshots s where s.board_id=assembly_context.board_id),
 'facts',assembly_private.facts(board_id));
 exception when others then raise exception using errcode=case when sqlstate like 'AS%' then sqlstate else 'AS500' end,message=assembly_private.error(sqlstate),detail='',hint='';
end$$;
create function public.assembly_mutate(action text,request_id uuid,expected_actor uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare bid uuid;entity uuid;rid uuid;tid uuid;sid uuid;v integer;prior assembly_private.requests;before_record jsonb;after_record jsonb;f jsonb;stamp timestamptz;project_name text;begin
 perform fabrication_private.lock_authority();perform assembly_private.actor(expected_actor);
 if request_id is null or p is null or octet_length(p::text)>40000 or action is null or action not in ('component','task_link','check','snapshot') then raise exception using errcode='AS422',message='Invalid request';end if;
 if action='component' then perform assembly_private.keys(p,array['board_id','version','id','name','quantity','status','notes']);
 elsif action='task_link' then perform assembly_private.keys(p,array['board_id','version','task_id','linked']);
 elsif action='check' then perform assembly_private.keys(p,array['board_id','version','id','title','kind','outcome','procedure','expected','observed','evidence_url','revision_id','rework_task_id','supersedes_id']);
 else perform assembly_private.keys(p,array['board_id','version','id','notes']);end if;
 bid:=assembly_private.uid(p->'board_id');entity:=assembly_private.uid(p->case when action='task_link' then 'task_id' else 'id' end);
 if not fabrication_private.can_submit(expected_actor,bid) then raise exception using errcode='AS403',message='Project unavailable';end if;
 -- Exact replay checks current actor/authority first, then returns the original terminal receipt.
 select * into prior from assembly_private.requests q where q.actor_id=expected_actor and q.request_id=assembly_mutate.request_id;
 if found then
  if prior.status='applied' and (prior.action is distinct from action or prior.payload is distinct from p) then raise exception using errcode='AS412',message='Request conflict';end if;
  return assembly_private.receipt(expected_actor,request_id);
 end if;
 if jsonb_typeof(p->'version') is distinct from 'number' or p->>'version'!~'^(0|[1-9][0-9]{0,8})$' then raise exception using errcode='AS422',message='Invalid version';end if;
 v:=coalesce((select b.version from assembly_private.boards b where b.board_id=bid),0);
 if v<>(p->>'version')::integer then raise exception using errcode='AS409',message='Project changed';end if;
 if v>=999999999 or (select count(*) from assembly_private.requests q where q.board_id=bid)>=10000 or (select count(*) from assembly_private.requests q where q.actor_id=expected_actor)>=20000 then raise exception using errcode='AS413',message='Record capacity reached';end if;
 if action='component' then
  perform assembly_private.text_field(p,'name',200,true);perform assembly_private.text_field(p,'notes',2000);
  if jsonb_typeof(p->'quantity') is distinct from 'number' or p->>'quantity'!~'^[1-9][0-9]{0,5}$' or (p->>'quantity')::integer>100000 or coalesce(p->>'status','') not in ('needed','ordered','received','installed') then raise exception using errcode='AS422',message='Invalid component';end if;
  select to_jsonb(c) into before_record from assembly_private.components c where c.id=entity;
  if before_record is not null and before_record->>'board_id'<>bid::text then raise exception using errcode='AS403',message='Component unavailable';end if;
  if before_record is null and (select count(*) from assembly_private.components c where c.board_id=bid)>=200 then raise exception using errcode='AS413',message='Component capacity reached';end if;
  insert into assembly_private.components(id,board_id,name,quantity,status,notes,created_by) values(entity,bid,fabrication_private.clean(p->>'name'),(p->>'quantity')::int,p->>'status',p->>'notes',expected_actor)
  on conflict(id) do update set name=excluded.name,quantity=excluded.quantity,status=excluded.status,notes=excluded.notes,updated_at=clock_timestamp();
  select to_jsonb(c) into after_record from assembly_private.components c where c.id=entity;
 elsif action='task_link' then
  if jsonb_typeof(p->'linked') is distinct from 'boolean' then raise exception using errcode='AS422',message='Invalid link';end if;
  if not exists(select 1 from public.planning_tasks t where t.id=entity and t.board_id=bid) then raise exception using errcode='AS403',message='Task unavailable';end if;
  select to_jsonb(l) into before_record from assembly_private.task_links l where l.board_id=bid and l.task_id=entity;
  if (p->>'linked')::boolean then
   if before_record is null and (select count(*) from assembly_private.task_links l where l.board_id=bid)>=500 then raise exception using errcode='AS413',message='Task link capacity reached';end if;
   insert into assembly_private.task_links(board_id,task_id,created_by) values(bid,entity,expected_actor) on conflict do nothing;
  else delete from assembly_private.task_links l where l.board_id=bid and l.task_id=entity;end if;
  after_record:=jsonb_build_object('board_id',bid,'task_id',entity,'linked',(p->>'linked')::boolean);
 elsif action='check' then
  perform assembly_private.text_field(p,'title',200,true);
  perform assembly_private.text_field(p,'procedure',2000,true);perform assembly_private.text_field(p,'expected',2000,true);perform assembly_private.text_field(p,'observed',2000,true);perform assembly_private.text_field(p,'evidence_url',2000);
  if coalesce(p->>'kind','') not in ('fit','function','durability','other') or coalesce(p->>'outcome','') not in ('passed','failed','blocked') or not assembly_private.evidence_url(p->>'evidence_url') then raise exception using errcode='AS422',message='Invalid check';end if;
  if p->'revision_id'<>'null'::jsonb then rid:=assembly_private.uid(p->'revision_id');end if;
  if p->'rework_task_id'<>'null'::jsonb then tid:=assembly_private.uid(p->'rework_task_id');end if;
  if p->'supersedes_id'<>'null'::jsonb then sid:=assembly_private.uid(p->'supersedes_id');end if;
  if rid is not null and not exists(select 1 from public.fabrication_revisions r join public.fabrication_parts fp on fp.id=r.part_id where r.id=rid and fp.board_id=bid) then raise exception using errcode='AS403',message='Revision unavailable';end if;
  if tid is not null and (p->>'outcome'='passed' or not exists(select 1 from public.planning_tasks t where t.id=tid and t.board_id=bid)) then raise exception using errcode='AS422',message='Rework task unavailable';end if;
  if exists(select 1 from assembly_private.checks c where c.id=entity) then raise exception using errcode='AS409',message='Check is immutable';end if;
  if sid is not null and not exists(select 1 from assembly_private.checks c where c.id=sid and c.board_id=bid and c.revision_id is not distinct from rid and not exists(select 1 from assembly_private.checks newer where newer.supersedes_id=c.id)) then raise exception using errcode='AS409',message='Superseded check changed';end if;
  if (select count(*) from assembly_private.checks c where c.board_id=bid)>=1000 then raise exception using errcode='AS413',message='Check capacity reached';end if;
  insert into assembly_private.checks(id,board_id,title,kind,outcome,procedure,expected,observed,evidence_url,revision_id,rework_task_id,supersedes_id,created_by)
  values(entity,bid,fabrication_private.clean(p->>'title'),p->>'kind',p->>'outcome',p->>'procedure',p->>'expected',p->>'observed',p->>'evidence_url',rid,tid,sid,expected_actor);
  select to_jsonb(c) into after_record from assembly_private.checks c where c.id=entity;
 else
  perform assembly_private.text_field(p,'notes',2000);
  if exists(select 1 from assembly_private.snapshots s where s.id=entity) then raise exception using errcode='AS409',message='Snapshot is immutable';end if;
  if (select count(*) from assembly_private.snapshots s where s.board_id=bid)>=200 then raise exception using errcode='AS413',message='Snapshot capacity reached';end if;
  f:=assembly_private.facts(bid);stamp:=clock_timestamp();select name into project_name from public.planning_boards where id=bid;
  insert into assembly_private.snapshots(id,board_id,notes,facts,summary,created_by,created_at) values(entity,bid,p->>'notes',f,
   format(E'Assembly & Testing — %s\nSnapshot ID: %s\nCaptured %s UTC\nFabricated parts done: %s/%s\nComponents received or installed: %s/%s\nLinked tasks done: %s/%s; blocked: %s\nLatest checks: %s; current passed: %s; failed: %s; blocked: %s; historical revision: %s\nReadiness counts summarize records, not an approval or readiness certification.%s',project_name,entity,to_char(stamp at time zone 'UTC','YYYY-MM-DD HH24:MI:SS'),f->>'parts_done',f->>'parts_total',f->>'components_available',f->>'components_total',f->>'tasks_done',f->>'tasks_total',f->>'tasks_blocked',f->>'checks_total',f->>'checks_passed',f->>'checks_failed',f->>'checks_blocked',f->>'checks_stale',case when p->>'notes'='' then '' else E'\nNotes: '||(p->>'notes') end),expected_actor,stamp);
  select to_jsonb(s) into after_record from assembly_private.snapshots s where s.id=entity;
 end if;
 insert into assembly_private.boards(board_id,version) values(bid,v+1) on conflict(board_id) do update set version=excluded.version;
 insert into assembly_private.history(board_id,actor_id,request_id,action,entity_id,before_data,after_data) values(bid,expected_actor,request_id,action,entity,before_record,after_record);
 insert into assembly_private.requests(actor_id,request_id,status,action,payload,entity_id,version,board_id) values(expected_actor,request_id,'applied',action,p,entity,v+1,bid);
 return assembly_private.receipt(expected_actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'AS%' then sqlstate else 'AS500' end,message=assembly_private.error(sqlstate),detail='',hint='';
end$$;
create function public.assembly_mutation_status(request_id uuid,expected_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fabrication_private.lock_authority();perform assembly_private.actor(expected_actor);
 if request_id is null then raise exception using errcode='AS422',message='Invalid request';end if;
 return assembly_private.receipt(expected_actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'AS%' then sqlstate else 'AS500' end,message=assembly_private.error(sqlstate),detail='',hint='';end$$;
create function public.assembly_cancel_mutation(request_id uuid,expected_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fabrication_private.lock_authority();perform assembly_private.actor(expected_actor);
 if request_id is null then raise exception using errcode='AS422',message='Invalid request';end if;
 if not exists(select 1 from assembly_private.requests q where q.actor_id=expected_actor and q.request_id=assembly_cancel_mutation.request_id) then
  if (select count(*) from assembly_private.requests q where q.actor_id=expected_actor)>=20000 then raise exception using errcode='AS413',message='Receipt capacity reached';end if;
  insert into assembly_private.requests(actor_id,request_id,status) values(expected_actor,request_id,'cancelled');
 end if;
 return assembly_private.receipt(expected_actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'AS%' then sqlstate else 'AS500' end,message=assembly_private.error(sqlstate),detail='',hint='';end$$;

revoke all on all functions in schema assembly_private from public,anon,authenticated,service_role;
revoke all on function public.assembly_context(uuid,uuid),public.assembly_mutate(text,uuid,uuid,jsonb),public.assembly_mutation_status(uuid,uuid),public.assembly_cancel_mutation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assembly_context(uuid,uuid),public.assembly_mutate(text,uuid,uuid,jsonb),public.assembly_mutation_status(uuid,uuid),public.assembly_cancel_mutation(uuid,uuid) to authenticated;
commit;
