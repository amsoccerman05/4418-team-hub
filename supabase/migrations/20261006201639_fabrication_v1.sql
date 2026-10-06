-- LOCAL DRAFT ONLY: canonical Planning project parts and immutable fabrication revisions.
-- No production migration or storage upload is authorized by this file.
begin;
-- Team profile/position authority first, canonical Planning authority second.
select pg_advisory_xact_lock(4418);
select pg_advisory_xact_lock(4418,30);
create schema fabrication_private;
revoke all on schema fabrication_private from public,anon,authenticated,service_role;

create table public.fabrication_parts (
 id uuid primary key, board_id uuid not null references public.planning_boards(id),
 status text not null default 'needs_review' check(status in ('needs_review','ready','in_progress','done','on_hold')),
 status_note text not null default '', version integer not null default 1 check(version>0),
 current_revision_id uuid not null, claimed_by uuid, acknowledged_revision_id uuid, reviewed_revision_id uuid,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index fabrication_parts_board on public.fabrication_parts(board_id,status,created_at);
create table public.fabrication_revisions (
 id uuid primary key, part_id uuid not null references public.fabrication_parts(id), revision_number integer not null check(revision_number>0),
 name text not null, material text not null, thickness numeric not null check(thickness>0 and thickness<=1000),
 thickness_unit text not null check(thickness_unit in ('mm','in')), drawing_unit text not null check(drawing_unit in ('mm','in')),
 quantity integer not null check(quantity between 1 and 100000), needed_date date not null check(needed_date between date '0001-01-01' and date '9999-12-31'),
 onshape_url text not null default '', notes text not null default '', dxf jsonb not null, pdf jsonb,
 dxf_path text not null unique, pdf_path text unique, created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 unique(part_id,revision_number),unique(part_id,id)
);
alter table public.fabrication_parts add constraint fabrication_current_revision foreign key(id,current_revision_id) references public.fabrication_revisions(part_id,id) deferrable initially deferred;
alter table public.fabrication_parts add constraint fabrication_ack_revision foreign key(id,acknowledged_revision_id) references public.fabrication_revisions(part_id,id) deferrable initially deferred;
alter table public.fabrication_parts add constraint fabrication_review_revision foreign key(id,reviewed_revision_id) references public.fabrication_revisions(part_id,id) deferrable initially deferred;
-- Conservative local defaults; adjustment requires reviewed privileged SQL and current shared-plan usage evidence.
-- No browser/service grants or mutation API. Budgets are not an automatic upgrade or allocation of shared capacity.
create table fabrication_private.settings (
 singleton boolean primary key default true check(singleton),
 project_byte_limit bigint not null check(project_byte_limit>0),
 total_byte_limit bigint not null check(total_byte_limit>0 and total_byte_limit<=1073741824),
 check(project_byte_limit<=total_byte_limit)
);
insert into fabrication_private.settings(singleton,project_byte_limit,total_byte_limit) values(true,134217728,268435456);
create table fabrication_private.requests (
 actor_id uuid not null, request_id uuid not null, status text not null check(status in ('applied','cancelled')),
 action text, payload jsonb, entity_id uuid, version integer, created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_id)
);
create table fabrication_private.reservations (
 actor_id uuid not null, request_id uuid not null, lease_id uuid not null unique default gen_random_uuid(),
 revision_id uuid not null unique, part_id uuid not null, board_id uuid not null references public.planning_boards(id),
 payload jsonb not null, manifest jsonb not null, bytes bigint not null check(bytes>0),
 dxf_path text not null unique, pdf_path text unique, created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_id)
);
create index fabrication_reservations_board on fabrication_private.reservations(board_id);
create table fabrication_private.history (
 id bigint generated always as identity primary key, actor_id uuid not null, request_id uuid not null,
 part_id uuid not null, action text not null, before_data jsonb, after_data jsonb not null, created_at timestamptz not null default clock_timestamp(), unique(actor_id,request_id)
);

do $$declare t text;begin
 foreach t in array array['public.fabrication_parts','public.fabrication_revisions','fabrication_private.requests','fabrication_private.reservations','fabrication_private.history','fabrication_private.settings'] loop
 execute format('alter table %s enable row level security',t);execute format('revoke all on table %s from public,anon,authenticated,service_role',t);
 end loop;
end$$;
revoke all on all sequences in schema fabrication_private from public,anon,authenticated,service_role;

create function fabrication_private.immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception using errcode='FB403',message='Immutable fabrication record';end$$;
create trigger fabrication_revision_immutable before update or delete on public.fabrication_revisions for each row execute function fabrication_private.immutable();
create trigger fabrication_request_immutable before update or delete on fabrication_private.requests for each row execute function fabrication_private.immutable();
create trigger fabrication_reservation_immutable before update or delete on fabrication_private.reservations for each row execute function fabrication_private.immutable();
create trigger fabrication_history_immutable before update or delete on fabrication_private.history for each row execute function fabrication_private.immutable();

create function fabrication_private.member(actor uuid) returns boolean language sql stable set search_path='' as $$select exists(select 1 from public.profiles where id=actor and active)$$;
create function fabrication_private.writer(actor uuid) returns boolean language sql stable set search_path='' as $$select exists(select 1 from public.profiles where id=actor and active and role::text in ('student','lead','mentor','admin'))$$;
-- Same current rows and position allowlist as canonical planning_private.manager(). Explicit actor is only used behind service-only ingress.
create function fabrication_private.manager(actor uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=actor and p.active and
 (p.role::text in ('mentor','admin') or (p.role::text in ('student','lead') and exists(
 select 1 from public.team_member_positions mp join public.team_positions tp on tp.key=mp.position_key and tp.active
 where mp.user_id=p.id and mp.revoked_at is null and tp.key in
 ('program_manager','product_technical_manager','finance_lead','software_lead','business_lead','cad_lead','fabrication_lead','strategy_lead','power_lead','communications_lead','operations_lead')))))
$$;
create function fabrication_private.supervisor(actor uuid) returns boolean language sql stable set search_path='' as $$select exists(select 1 from public.profiles where id=actor and active and role::text in ('mentor','admin'))$$;
create function fabrication_private.visible(actor uuid,bid uuid) returns boolean language sql stable set search_path='' as $$
 select fabrication_private.member(actor) and exists(select 1 from public.planning_boards b join public.planning_seasons s on s.id=b.season_id where b.id=bid and b.kind='project' and (fabrication_private.manager(actor) or (b.active and s.status='active')))
$$;
create function fabrication_private.writable(actor uuid,bid uuid) returns boolean language sql stable set search_path='' as $$
 select fabrication_private.writer(actor) and exists(select 1 from public.planning_boards b join public.planning_seasons s on s.id=b.season_id where b.id=bid and b.kind='project' and b.active and s.status<>'archived' and (fabrication_private.manager(actor) or s.status='active'))
$$;
create function fabrication_private.can_submit(actor uuid,bid uuid) returns boolean language sql stable set search_path='' as $$
 select fabrication_private.writable(actor,bid) and (fabrication_private.manager(actor) or exists(select 1 from public.planning_project_review_assignments where board_id=bid and lead_id=actor) or exists(select 1 from public.planning_project_review_supporters where board_id=bid and user_id=actor))
$$;
create function fabrication_private.actor(expected uuid) returns void language plpgsql set search_path='' as $$begin
 if expected is null or expected is distinct from auth.uid() or not fabrication_private.member(expected) then raise exception using errcode='FB401',message='Fabrication account changed';end if;
end$$;
create function fabrication_private.lock_authority() returns void language plpgsql set search_path='' as $$begin perform pg_advisory_xact_lock(4418);perform pg_advisory_xact_lock(4418,30);end$$;
create function fabrication_private.clean(v text) returns text language sql immutable set search_path='' as $$select btrim(coalesce(v,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')$$;
create function fabrication_private.units(v text) returns integer language sql immutable set search_path='' as $$select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::int from regexp_split_to_table(coalesce(v,''),'') c$$;
create function fabrication_private.keys(p jsonb,fields text[]) returns void language plpgsql set search_path='' as $$begin
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where not(k=any(fields))) or exists(select 1 from unnest(fields) k where not(p?k)) then raise exception using errcode='FB422',message='Invalid fields';end if;
end$$;
create function fabrication_private.text_field(p jsonb,k text,n integer,required boolean default false) returns void language plpgsql set search_path='' as $$begin
 if jsonb_typeof(p->k) is distinct from 'string' or fabrication_private.units(p->>k)>n or (required and fabrication_private.clean(p->>k)='') then raise exception using errcode='FB422',message='Invalid text';end if;
end$$;
create function fabrication_private.uid(v jsonb) returns uuid language plpgsql immutable set search_path='' as $$begin
 if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='FB422',message='Invalid identity';end if;return (v#>>'{}')::uuid;
end$$;
create function fabrication_private.error(code text) returns text language sql immutable set search_path='' as $$select case code
 when 'FB401' then 'Your account changed. Reload Fabrication before continuing.' when 'FB403' then 'This Fabrication action is unavailable for your current access.'
 when 'FB409' then 'Changed by another teammate. Refresh before continuing.' when 'FB412' then 'This request ID was already used for a different change.'
 when 'FB413' then 'Fabrication storage or revision limit reached. Ask an administrator to review capacity.' when 'FB422' then 'Invalid Fabrication request. Check the fields and files.'
 else 'Fabrication could not complete this request. Check its status before retrying.' end$$;
create function fabrication_private.validate_submission(p jsonb) returns void language plpgsql set search_path='' as $$declare d date;begin
 perform fabrication_private.keys(p,array['part_id','board_id','version','revision_id','name','material','thickness','thickness_unit','drawing_unit','quantity','needed_date','onshape_url','notes']);
 perform fabrication_private.uid(p->'part_id');perform fabrication_private.uid(p->'board_id');perform fabrication_private.uid(p->'revision_id');
 if p->'version'<>'null'::jsonb and (jsonb_typeof(p->'version')<>'number' or p->>'version'!~'^[1-9][0-9]{0,8}$') then raise exception using errcode='FB422',message='Invalid version';end if;
 perform fabrication_private.text_field(p,'name',200,true);perform fabrication_private.text_field(p,'material',120,true);perform fabrication_private.text_field(p,'notes',2000);perform fabrication_private.text_field(p,'onshape_url',2000);
 if jsonb_typeof(p->'thickness') is distinct from 'number' or not((p->>'thickness')::numeric>0 and (p->>'thickness')::numeric<=1000) or coalesce(p->>'thickness_unit','') not in ('mm','in') or coalesce(p->>'drawing_unit','') not in ('mm','in') then raise exception using errcode='FB422',message='Invalid thickness or units';end if;
 if jsonb_typeof(p->'quantity') is distinct from 'number' or p->>'quantity' !~'^[1-9][0-9]{0,5}$' or (p->>'quantity')::integer>100000 then raise exception using errcode='FB422',message='Invalid quantity';end if;
 if jsonb_typeof(p->'needed_date') is distinct from 'string' or p->>'needed_date' !~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='FB422',message='Invalid date';end if;
 begin d:=(p->>'needed_date')::date;exception when others then raise exception using errcode='FB422',message='Invalid date';end;
 if d not between date '0001-01-01' and date '9999-12-31' or to_char(d,'YYYY-MM-DD')<>p->>'needed_date' then raise exception using errcode='FB422',message='Invalid date';end if;
 if p->>'onshape_url'<>'' and (p->>'onshape_url' !~* '^https://cad\.onshape\.com/documents/[a-z0-9]+([/?#]|$)' or p->>'onshape_url' ~* '/(\.|%2e){1,2}(/|[?#]|$)' or p->>'onshape_url' ~ '[[:space:]]' or p->>'onshape_url' ~ '[[:cntrl:]]' or position(chr(92) in p->>'onshape_url')>0 or p->>'onshape_url' ~ U&'[\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]') then raise exception using errcode='FB422',message='Invalid Onshape URL';end if;
end$$;
create function fabrication_private.validate_manifest(m jsonb) returns void language plpgsql set search_path='' as $$declare k text;f jsonb;begin
 perform fabrication_private.keys(m,array['dxf','pdf']);
 foreach k in array array['dxf','pdf'] loop f:=m->k;if k='pdf' and f='null'::jsonb then continue;end if;
 perform fabrication_private.keys(f,array['name','size','sha256']);perform fabrication_private.text_field(f,'name',150,true);
 if f->>'name' ~ '[[:cntrl:]/\\]' or f->>'name' !~* ('\.'||k||'$') or jsonb_typeof(f->'size') is distinct from 'number' or f->>'size'!~'^[1-9][0-9]{0,7}$' or (f->>'size')::bigint>(case when k='dxf' then 20971520 else 10485760 end) or jsonb_typeof(f->'sha256') is distinct from 'string' or f->>'sha256'!~'^[0-9a-f]{64}$' then raise exception using errcode='FB422',message='Invalid file manifest';end if;
 end loop;
end$$;
create function fabrication_private.receipt(who uuid,key uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce((select jsonb_build_object('request_id',q.request_id,'status',q.status,'action',q.action,'entity_id',q.entity_id,'version',q.version) from fabrication_private.requests q where actor_id=who and request_id=key),
 jsonb_build_object('request_id',key,'status',case when exists(select 1 from fabrication_private.reservations where actor_id=who and request_id=key) then 'pending' else 'unknown' end,'action',null,'entity_id',null,'version',null))
$$;
create function fabrication_private.envelope(who uuid,key uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('receipt',fabrication_private.receipt(who,key),'reservation',case when exists(select 1 from fabrication_private.requests where actor_id=who and request_id=key) then null else
 (select jsonb_build_object('lease_id',lease_id,'revision_id',revision_id,'bucket','fabrication-private','dxf_path',dxf_path,'pdf_path',pdf_path,'manifest',manifest) from fabrication_private.reservations where actor_id=who and request_id=key) end)
$$;
create function fabrication_private.allowed(actor uuid,part public.fabrication_parts) returns text[] language plpgsql stable set search_path='' as $$declare a text[]:='{}';own boolean:=part.claimed_by=actor;super boolean:=fabrication_private.supervisor(actor);begin
 if not fabrication_private.writable(actor,part.board_id) then return a;end if;
 if part.claimed_by is null and part.status<>'done' then a:=array_append(a,'claim');end if;
 if part.claimed_by is not null and (own or super) then a:=array_append(a,'release');end if;
 if own and part.status<>'done' and part.acknowledged_revision_id is distinct from part.current_revision_id then a:=array_append(a,'acknowledge');end if;
 if (own or super) and part.status='needs_review' then a:=array_append(a,'ready');end if;
 if own and part.status='ready' and part.reviewed_revision_id=part.current_revision_id and part.acknowledged_revision_id=part.current_revision_id then a:=array_append(a,'start');end if;
 if own and part.status='in_progress' and part.reviewed_revision_id=part.current_revision_id and part.acknowledged_revision_id=part.current_revision_id then a:=array_append(a,'done');end if;
 if (own or super) and part.status not in ('on_hold','done') then a:=array_append(a,'hold');end if;
 if (own or super or fabrication_private.can_submit(actor,part.board_id)) and part.status<>'needs_review' then a:=array_append(a,'rework');end if;
 return a;
end$$;
create function fabrication_private.revision_json(r public.fabrication_revisions) returns jsonb language sql stable set search_path='' as $$select to_jsonb(r)-'dxf_path'-'pdf_path'$$;
create function fabrication_private.person(who uuid) returns jsonb language sql stable set search_path='' as $$select case when who is null then null else coalesce((select jsonb_build_object('id',id,'name',planning_review_private.label(display_name,'Unnamed teammate'),'active',coalesce(active,false)) from public.profiles where id=who),jsonb_build_object('id',who,'name','Unavailable teammate','active',false)) end$$;
create function fabrication_private.part_json(actor uuid,p public.fabrication_parts) returns jsonb language sql stable set search_path='' as $$select to_jsonb(p)||jsonb_build_object('current_revision',(select fabrication_private.revision_json(r) from public.fabrication_revisions r where r.id=p.current_revision_id),'claimant',fabrication_private.person(p.claimed_by),'can_revise',fabrication_private.can_submit(actor,p.board_id),'allowed_actions',to_jsonb(fabrication_private.allowed(actor,p)))$$;

create function public.fabrication_context(selected_season uuid default null,selected_project uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$declare sid uuid;who uuid:=auth.uid();mgr boolean;ids uuid[];begin
 perform fabrication_private.actor(who);mgr:=fabrication_private.manager(who);
 if selected_project is not null then
  if not fabrication_private.visible(who,selected_project) then raise exception using errcode='FB403',message='Project unavailable';end if;
  select season_id into sid from public.planning_boards where id=selected_project;
  if selected_season is not null and selected_season<>sid then raise exception using errcode='FB403',message='Season mismatch';end if;
 else select id into sid from public.planning_seasons where (selected_season is null or id=selected_season) and (mgr or status='active') order by (status='active') desc,created_at desc,id limit 1;end if;
 if selected_season is not null and sid is null then raise exception using errcode='FB403',message='Season unavailable';end if;
 select coalesce(array_agg(x.id),'{}') into ids from (select p.id from public.fabrication_parts p join public.planning_boards b on b.id=p.board_id join public.fabrication_revisions r on r.id=p.current_revision_id where b.season_id=sid and (selected_project is null or p.board_id=selected_project) and fabrication_private.visible(who,p.board_id) order by (p.status='done'),r.needed_date,p.created_at,p.id limit 200) x;
 return jsonb_build_object('user_id',who,'can_manage',mgr,'is_operator',fabrication_private.writer(who),'season_id',sid,'selected_project_id',selected_project,'loaded_at',clock_timestamp(),
 'seasons',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',planning_review_private.label(s.name,'Planning season'),'status',s.status) order by s.created_at desc,s.id),'[]') from public.planning_seasons s where mgr or status='active'),
 'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'season_id',b.season_id,'name',planning_review_private.label(b.name,'Project'),'active',b.active,'can_submit',fabrication_private.can_submit(who,b.id),'can_review',fabrication_private.writable(who,b.id),'can_operate',fabrication_private.writable(who,b.id)) order by b.display_order,b.name,b.id),'[]') from public.planning_boards b where b.season_id=sid and fabrication_private.visible(who,b.id)),
 'parts',(select coalesce(jsonb_agg(fabrication_private.part_json(who,p) order by (p.status='done'),r.needed_date,p.created_at,p.id),'[]') from public.fabrication_parts p join public.fabrication_revisions r on r.id=p.current_revision_id where p.id=any(ids)),
 'revisions',(select coalesce(jsonb_agg(fabrication_private.revision_json(r) order by r.part_id,r.revision_number desc),'[]') from public.fabrication_revisions r where r.part_id=any(ids)),
 'parts_limit_reached',(select count(*)>200 from public.fabrication_parts p join public.planning_boards b on b.id=p.board_id where b.season_id=sid and (selected_project is null or p.board_id=selected_project) and fabrication_private.visible(who,p.board_id)));
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';
end$$;

-- Tiny freshness check for the one open part; no revision history or Storage metadata returned.
create function public.fabrication_part_version(part_id uuid,expected_actor uuid) returns integer language plpgsql stable security definer set search_path='' as $$declare result integer;begin
 perform fabrication_private.actor(expected_actor);
 select p.version into result from public.fabrication_parts p where p.id=part_id and fabrication_private.visible(expected_actor,p.board_id);
 if result is null then raise exception using errcode='FB403',message='Part unavailable';end if;
 return result;
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';end$$;

create function public.fabrication_mutate(action text,request_id uuid,expected_actor uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare part public.fabrication_parts;prior fabrication_private.requests;old jsonb;begin
 perform fabrication_private.lock_authority();perform fabrication_private.actor(expected_actor);
 if request_id is null or octet_length(p::text)>16000 then raise exception using errcode='FB422',message='Invalid request';end if;
 perform fabrication_private.keys(p,array['part_id','version','revision_id','note']);perform fabrication_private.text_field(p,'note',2000);
 select * into part from public.fabrication_parts where id=fabrication_private.uid(p->'part_id');
 if part.id is null or not fabrication_private.writable(expected_actor,part.board_id) then raise exception using errcode='FB403',message='Part unavailable';end if;
 if action not in ('claim','release','acknowledge','ready','start','done','hold','rework') then raise exception using errcode='FB422',message='Invalid action';end if;
 -- Replay checks current broad action authority, then returns the original receipt even if its resulting state changed.
 if action in ('claim','acknowledge','start','done') and not fabrication_private.writer(expected_actor) then raise exception using errcode='FB403',message='Operator unavailable';end if;
 select * into prior from fabrication_private.requests q where q.actor_id=expected_actor and q.request_id=fabrication_mutate.request_id;
 if found then if prior.status='applied' and (prior.action is distinct from action or prior.payload is distinct from p) then raise exception using errcode='FB412',message='Request conflict';end if;return fabrication_private.receipt(expected_actor,request_id);end if;
 if exists(select 1 from fabrication_private.reservations q where q.actor_id=expected_actor and q.request_id=fabrication_mutate.request_id) then raise exception using errcode='FB412',message='Request conflict';end if;
 if jsonb_typeof(p->'version') is distinct from 'number' or p->>'version'!~'^[1-9][0-9]{0,8}$' then raise exception using errcode='FB422',message='Invalid version';end if;
 if part.version<>(p->>'version')::int or part.current_revision_id<>fabrication_private.uid(p->'revision_id') then raise exception using errcode='FB409',message='Part changed';end if;
 if not(action=any(fabrication_private.allowed(expected_actor,part))) then raise exception using errcode='FB403',message='Action unavailable';end if;
 if action in ('hold','rework') and fabrication_private.clean(p->>'note')='' then raise exception using errcode='FB422',message='Reason required';end if;
 old:=to_jsonb(part);
 if action='claim' then part.claimed_by:=expected_actor;part.acknowledged_revision_id:=null;
 elsif action='release' then part.claimed_by:=null;part.acknowledged_revision_id:=null;if part.status='in_progress' then part.status:='needs_review';part.reviewed_revision_id:=null;end if;
 elsif action='acknowledge' then part.acknowledged_revision_id:=part.current_revision_id;
 elsif action='ready' then part.status:='ready';part.reviewed_revision_id:=part.current_revision_id;
 elsif action='start' then part.status:='in_progress';elsif action='done' then part.status:='done';
 elsif action='hold' then part.status:='on_hold';part.acknowledged_revision_id:=null;part.reviewed_revision_id:=null;
 elsif action='rework' then part.status:='needs_review';part.acknowledged_revision_id:=null;part.reviewed_revision_id:=null;end if;
 update public.fabrication_parts set status=part.status,status_note=case when action in ('claim','release','acknowledge') then status_note else p->>'note' end,claimed_by=part.claimed_by,acknowledged_revision_id=part.acknowledged_revision_id,reviewed_revision_id=part.reviewed_revision_id,version=version+1,updated_at=clock_timestamp() where id=part.id returning * into part;
 insert into fabrication_private.history(actor_id,request_id,part_id,action,before_data,after_data) values(expected_actor,request_id,part.id,action,old,to_jsonb(part));
 insert into fabrication_private.requests(actor_id,request_id,status,action,payload,entity_id,version) values(expected_actor,request_id,'applied',action,p,part.id,part.version);
 return fabrication_private.receipt(expected_actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';
end$$;
create function public.fabrication_mutation_status(request_id uuid,expected_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fabrication_private.lock_authority();perform fabrication_private.actor(expected_actor);if request_id is null then raise exception using errcode='FB422',message='Invalid request';end if;return fabrication_private.receipt(expected_actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';end$$;
create function public.fabrication_cancel_mutation(request_id uuid,expected_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform fabrication_private.lock_authority();perform fabrication_private.actor(expected_actor);if request_id is null then raise exception using errcode='FB422',message='Invalid request';end if;
 insert into fabrication_private.requests(actor_id,request_id,status) values(expected_actor,request_id,'cancelled') on conflict do nothing;return fabrication_private.receipt(expected_actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';end$$;

-- Privileged ingress: actor comes only from gateway auth.getUser(), never from browser metadata.
create function public.fabrication_reserve_upload(actor uuid,request_id uuid,p jsonb,manifest jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare prior fabrication_private.reservations;part public.fabrication_parts;bid uuid;pid uuid;rid uuid;incoming_bytes bigint;terminal fabrication_private.requests;budget fabrication_private.settings;begin
 perform fabrication_private.lock_authority();if not fabrication_private.member(actor) then raise exception using errcode='FB401',message='Inactive actor';end if;
 if request_id is null or octet_length(p::text)>20000 or octet_length(manifest::text)>2000 then raise exception using errcode='FB422',message='Invalid request';end if;
 perform fabrication_private.validate_submission(p);perform fabrication_private.validate_manifest(manifest);
 bid:=(p->>'board_id')::uuid;pid:=(p->>'part_id')::uuid;rid:=(p->>'revision_id')::uuid;
 if not fabrication_private.can_submit(actor,bid) then raise exception using errcode='FB403',message='Project unavailable';end if;
 select * into budget from fabrication_private.settings where singleton;
 if not found then raise exception using errcode='FB413',message='Fabrication storage budget unavailable';end if;
 select * into terminal from fabrication_private.requests q where q.actor_id=actor and q.request_id=fabrication_reserve_upload.request_id;
 select * into prior from fabrication_private.reservations q where q.actor_id=actor and q.request_id=fabrication_reserve_upload.request_id;
 if terminal.status='cancelled' then return fabrication_private.envelope(actor,request_id);end if;
 if prior.lease_id is not null then if prior.payload is distinct from p or prior.manifest is distinct from manifest then raise exception using errcode='FB412',message='Request conflict';end if;return fabrication_private.envelope(actor,request_id);end if;
 if terminal.request_id is not null then raise exception using errcode='FB412',message='Request conflict';end if;
 select * into part from public.fabrication_parts where id=pid;
 if part.id is not null and part.board_id<>bid then raise exception using errcode='FB403',message='Project mismatch';end if;
 if (part.id is null and p->'version'<>'null'::jsonb) or (part.id is not null and (p->'version'='null'::jsonb or part.version<>(p->>'version')::int)) then raise exception using errcode='FB409',message='Part changed';end if;
 if exists(select 1 from fabrication_private.reservations r where r.part_id=pid and r.board_id<>bid) then raise exception using errcode='FB403',message='Stable project required';end if;
 if exists(select 1 from public.fabrication_revisions where id=rid) or exists(select 1 from fabrication_private.reservations where revision_id=rid) then raise exception using errcode='FB409',message='Revision exists';end if;
 -- A project always fits the complete 200-part project view. Pending new-part reservations consume capacity too.
 if part.id is null and not exists(select 1 from fabrication_private.reservations r where r.part_id=pid and r.board_id=bid and not exists(select 1 from fabrication_private.requests q where q.actor_id=r.actor_id and q.request_id=r.request_id and q.status='cancelled'))
 and (select count(*) from (select fp.id from public.fabrication_parts fp where fp.board_id=bid union select r.part_id from fabrication_private.reservations r where r.board_id=bid and not exists(select 1 from fabrication_private.requests q where q.actor_id=r.actor_id and q.request_id=r.request_id and q.status='cancelled')) capacity)>=200 then raise exception using errcode='FB413',message='Project part capacity reached';end if;
 -- Charge every reservation forever, including cancelled/crashed attempts. No timeout releases a storage budget while an old writer can still finish.
 incoming_bytes:=(manifest->'dxf'->>'size')::bigint+coalesce((manifest->'pdf'->>'size')::bigint,0);
 if (select count(*) from fabrication_private.reservations where actor_id=actor)>=1000 or (select count(*) from fabrication_private.reservations where board_id=bid)>=1000 or (select count(*) from fabrication_private.reservations where part_id=pid)>=50
 or (select count(*) from fabrication_private.reservations r where r.actor_id=actor and not exists(select 1 from fabrication_private.requests q where q.actor_id=r.actor_id and q.request_id=r.request_id))>=5
 or (select coalesce(sum(r.bytes),0)+incoming_bytes>budget.project_byte_limit from fabrication_private.reservations r where r.board_id=bid)
 or (select coalesce(sum(r.bytes),0)+incoming_bytes>budget.total_byte_limit from fabrication_private.reservations r) then raise exception using errcode='FB413',message='Capacity reached';end if;
 insert into fabrication_private.reservations(actor_id,request_id,revision_id,part_id,board_id,payload,manifest,bytes,dxf_path,pdf_path) values(actor,request_id,rid,pid,bid,p,manifest,incoming_bytes,bid||'/'||pid||'/'||rid||'/drawing.dxf',case when manifest->'pdf'<>'null'::jsonb then bid||'/'||pid||'/'||rid||'/drawing.pdf' else null end);
 return fabrication_private.envelope(actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';
end$$;
create function public.fabrication_upload_authorize(actor uuid,request_id uuid,lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r fabrication_private.reservations;begin
 perform fabrication_private.lock_authority();if not fabrication_private.member(actor) then raise exception using errcode='FB401',message='Inactive actor';end if;
 select * into r from fabrication_private.reservations q where q.actor_id=actor and q.request_id=fabrication_upload_authorize.request_id and q.lease_id=fabrication_upload_authorize.lease_id;
 if r.lease_id is null or not fabrication_private.can_submit(actor,r.board_id) then raise exception using errcode='FB403',message='Reservation unavailable';end if;
 return fabrication_private.envelope(actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';end$$;
create function public.fabrication_finalize_upload(actor uuid,request_id uuid,lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r fabrication_private.reservations;part public.fabrication_parts;old jsonb;p jsonb;n integer;kind text;path text;f jsonb;begin
 perform fabrication_private.lock_authority();if not fabrication_private.member(actor) then raise exception using errcode='FB401',message='Inactive actor';end if;
 select * into r from fabrication_private.reservations q where q.actor_id=actor and q.request_id=fabrication_finalize_upload.request_id and q.lease_id=fabrication_finalize_upload.lease_id;
 if r.lease_id is null or not fabrication_private.can_submit(actor,r.board_id) then raise exception using errcode='FB403',message='Reservation unavailable';end if;
 if exists(select 1 from fabrication_private.requests q where q.actor_id=actor and q.request_id=fabrication_finalize_upload.request_id) then return fabrication_private.receipt(actor,request_id);end if;
 p:=r.payload;select * into part from public.fabrication_parts where id=r.part_id;
 if (part.id is null and p->'version'<>'null'::jsonb) or (part.id is not null and (part.board_id<>r.board_id or p->'version'='null'::jsonb or part.version<>(p->>'version')::int)) then raise exception using errcode='FB409',message='Part changed';end if;
 foreach kind in array array['dxf','pdf'] loop f:=r.manifest->kind;path:=case when kind='dxf' then r.dxf_path else r.pdf_path end;if path is null then continue;end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='fabrication-private' and o.name=path and (o.metadata->>'size')::bigint=(f->>'size')::bigint and o.user_metadata->>'sha256'=f->>'sha256' and o.metadata->>'mimetype'=case when kind='dxf' then 'application/dxf' else 'application/pdf' end) then raise exception using errcode='FB422',message='Validated file unavailable';end if;
 end loop;
 old:=case when part.id is not null then to_jsonb(part) else null end;
 select coalesce(max(revision_number),0)+1 into n from public.fabrication_revisions where part_id=r.part_id;
 if part.id is null then insert into public.fabrication_parts(id,board_id,current_revision_id,created_by) values(r.part_id,r.board_id,r.revision_id,actor) returning * into part;
 else update public.fabrication_parts set current_revision_id=r.revision_id,status='needs_review',status_note='',acknowledged_revision_id=null,reviewed_revision_id=null,version=version+1,updated_at=clock_timestamp() where id=r.part_id returning * into part;end if;
 insert into public.fabrication_revisions(id,part_id,revision_number,name,material,thickness,thickness_unit,drawing_unit,quantity,needed_date,onshape_url,notes,dxf,pdf,dxf_path,pdf_path,created_by) values(r.revision_id,r.part_id,n,p->>'name',p->>'material',(p->>'thickness')::numeric,p->>'thickness_unit',p->>'drawing_unit',(p->>'quantity')::int,(p->>'needed_date')::date,p->>'onshape_url',p->>'notes',r.manifest->'dxf',nullif(r.manifest->'pdf','null'::jsonb),r.dxf_path,r.pdf_path,actor);
 insert into fabrication_private.history(actor_id,request_id,part_id,action,before_data,after_data) values(actor,request_id,r.part_id,'revision',old,to_jsonb(part)||jsonb_build_object('revision',p,'manifest',r.manifest));
 insert into fabrication_private.requests(actor_id,request_id,status,action,payload,entity_id,version) values(actor,request_id,'applied','revision',p,r.part_id,part.version);
 return fabrication_private.receipt(actor,request_id);
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';end$$;
create function public.fabrication_download_file(actor uuid,revision_id uuid,file_kind text) returns jsonb language plpgsql stable security definer set search_path='' as $$declare r public.fabrication_revisions;bid uuid;f jsonb;begin
 if not fabrication_private.member(actor) then raise exception using errcode='FB401',message='Inactive actor';end if;
 select * into r from public.fabrication_revisions where id=revision_id;select board_id into bid from public.fabrication_parts where id=r.part_id;
 if r.id is null or not fabrication_private.visible(actor,bid) then raise exception using errcode='FB403',message='File unavailable';end if;
 if file_kind not in ('dxf','pdf') then raise exception using errcode='FB422',message='Invalid kind';end if;
 f:=case when file_kind='dxf' then r.dxf else r.pdf end;if f is null then raise exception using errcode='FB403',message='File unavailable';end if;
 return f||jsonb_build_object('bucket','fabrication-private','revision_number',r.revision_number,'path',case when file_kind='dxf' then r.dxf_path else r.pdf_path end,'content_type',case when file_kind='dxf' then 'application/dxf' else 'application/pdf' end);
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';end$$;


create function public.fabrication_cancelled_upload_paths(actor uuid,request_id uuid,lease_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare r fabrication_private.reservations;begin
 perform fabrication_private.lock_authority();if not fabrication_private.member(actor) then raise exception using errcode='FB401',message='Inactive actor';end if;
 select * into r from fabrication_private.reservations q where q.actor_id=actor and q.request_id=fabrication_cancelled_upload_paths.request_id and (fabrication_cancelled_upload_paths.lease_id is null or q.lease_id=fabrication_cancelled_upload_paths.lease_id);
 if not exists(select 1 from fabrication_private.requests q where q.actor_id=actor and q.request_id=fabrication_cancelled_upload_paths.request_id and status='cancelled') or (r.lease_id is not null and not fabrication_private.visible(actor,r.board_id)) or (fabrication_cancelled_upload_paths.lease_id is not null and r.lease_id is null) then raise exception using errcode='FB403',message='Cancelled reservation unavailable';end if;
 return jsonb_build_object('bucket','fabrication-private','paths',to_jsonb(array_remove(array[r.dxf_path,r.pdf_path],null)));
 exception when others then raise exception using errcode=case when sqlstate like 'FB%' then sqlstate else 'FB500' end,message=fabrication_private.error(sqlstate),detail='',hint='';end$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fabrication-private','fabrication-private',false,20971520,array['application/dxf','application/pdf']);
-- Current canonical project access is enforced even when another application's permissive policy is broad.
create policy fabrication_read_boundary on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'fabrication-private');
create policy fabrication_no_browser_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'fabrication-private');
create policy fabrication_no_browser_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'fabrication-private') with check(bucket_id<>'fabrication-private');
create policy fabrication_no_browser_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'fabrication-private');

revoke all on all functions in schema fabrication_private from public,anon,authenticated,service_role;
revoke all on function public.fabrication_context(uuid,uuid),public.fabrication_part_version(uuid,uuid),public.fabrication_mutate(text,uuid,uuid,jsonb),public.fabrication_mutation_status(uuid,uuid),public.fabrication_cancel_mutation(uuid,uuid),public.fabrication_reserve_upload(uuid,uuid,jsonb,jsonb),public.fabrication_upload_authorize(uuid,uuid,uuid),public.fabrication_finalize_upload(uuid,uuid,uuid),public.fabrication_download_file(uuid,uuid,text),public.fabrication_cancelled_upload_paths(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fabrication_context(uuid,uuid),public.fabrication_part_version(uuid,uuid),public.fabrication_mutate(text,uuid,uuid,jsonb),public.fabrication_mutation_status(uuid,uuid),public.fabrication_cancel_mutation(uuid,uuid) to authenticated;
grant execute on function public.fabrication_reserve_upload(uuid,uuid,jsonb,jsonb),public.fabrication_upload_authorize(uuid,uuid,uuid),public.fabrication_finalize_upload(uuid,uuid,uuid),public.fabrication_download_file(uuid,uuid,text),public.fabrication_cancelled_upload_paths(uuid,uuid,uuid) to service_role;
commit;
