-- LOCAL REVIEW ONLY. Additive Sprint Review meeting records, not an approval system.
-- No existing Planning helper, permission, task, register, or migration is replaced.
begin;
select pg_advisory_xact_lock(4418,30);
create schema planning_review_private;
revoke all on schema planning_review_private from public,anon,authenticated,service_role;

create table public.planning_sprint_reviews (
 id uuid primary key, season_id uuid not null references public.planning_seasons(id),
 title text not null, review_date date not null check(review_date between date '0001-01-01' and date '9999-12-31'),
 chair_id uuid references public.profiles(id), agenda jsonb not null default '[]',
 version integer not null default 1 check(version>0),
 recorded_by uuid not null references public.profiles(id), recorded_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(), unique(id,season_id)
);
create index planning_sprint_reviews_season_date on public.planning_sprint_reviews(season_id,review_date desc,created_at desc);
create table public.planning_project_review_assignments (
 board_id uuid primary key references public.planning_boards(id), lead_id uuid references public.profiles(id),
 version integer not null default 1 check(version>0),
 recorded_by uuid not null references public.profiles(id), recorded_at timestamptz not null default clock_timestamp()
);
create table public.planning_project_review_supporters (
 board_id uuid not null references public.planning_project_review_assignments(board_id),
 user_id uuid not null references public.profiles(id), primary key(board_id,user_id)
);
create index planning_review_supporters_user on public.planning_project_review_supporters(user_id,board_id);
create table public.planning_sprint_review_updates (
 id uuid primary key, review_id uuid not null references public.planning_sprint_reviews(id),
 board_id uuid not null references public.planning_boards(id),
 progress text not null default '', blockers text not null default '', evidence jsonb not null default '[]',
 tradeoffs text not null default '', decisions_needed text not null default '', decision_references jsonb not null default '[]',
 reported_decision text not null default '', decision_rationale text not null default '', reported_by_student_ids uuid[] not null default '{}',
 next_test text not null default '', linked_task_id uuid references public.planning_tasks(id),
 carry_from_update_id uuid references public.planning_sprint_review_updates(id), unresolved boolean not null default true,
 version integer not null default 1 check(version>0),
 recorded_by uuid not null references public.profiles(id), recorded_at timestamptz not null default clock_timestamp(),
 unique(review_id,board_id),check(carry_from_update_id is distinct from id)
);
create index planning_review_updates_board on public.planning_sprint_review_updates(board_id,review_id);
create index planning_review_updates_task on public.planning_sprint_review_updates(linked_task_id) where linked_task_id is not null;
create index planning_review_updates_carry on public.planning_sprint_review_updates(carry_from_update_id) where carry_from_update_id is not null;
create table planning_review_private.history (
 id bigint generated always as identity primary key, action text not null, entity_id uuid not null,
 actor_id uuid not null references public.profiles(id), request_id uuid not null,
 before_data jsonb, after_data jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table planning_review_private.requests (
 actor_id uuid not null references public.profiles(id), request_id uuid not null,
 action text, payload jsonb, status text not null check(status in ('applied','cancelled')),
 entity_id uuid, version integer, created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id),
 check((status='applied' and action is not null and payload is not null and entity_id is not null and version is not null)
 or (status='cancelled' and action is null and payload is null and entity_id is null and version is null))
);

-- These exact characters match ECMAScript String.trim(), including NBSP/BOM.
create function planning_review_private.clean(v text) returns text language sql immutable set search_path='' as $$
 select btrim(coalesce(v,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
create function planning_review_private.js_length(v text) returns integer language sql immutable set search_path='' as $$
 select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(coalesce(v,''),'') c
$$;
create function planning_review_private.bounded_text(v text,max_units integer) returns text language plpgsql immutable set search_path='' as $$
declare source text:=coalesce(v,''); result text:=''; n integer:=0; c text;
begin
 for i in 1..least(length(source),max_units) loop
  c:=substr(source,i,1);n:=n+case when ascii(c)>65535 then 2 else 1 end;
  if n>max_units then exit;end if;result:=result||c;
 end loop;return result;
end
$$;
create function planning_review_private.label(v text,fallback text) returns text language sql immutable set search_path='' as $$
 select planning_review_private.bounded_text(coalesce(nullif(planning_review_private.clean(v),''),fallback),150)
$$;
create function planning_review_private.writer() returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('student','lead','mentor','admin'))
$$;
create function planning_review_private.person(ident uuid) returns jsonb language sql stable set search_path='' as $$
 select case when ident is null then null else coalesce((select jsonb_build_object('id',id,'name',planning_review_private.label(display_name,'Unnamed teammate'),
 'active',coalesce(active,false),'is_student',coalesce(role::text in ('student','lead'),false),
 'can_write',coalesce(active and role::text in ('student','lead','mentor','admin'),false)) from public.profiles where id=ident),
 jsonb_build_object('id',ident,'name','Unavailable teammate','active',false,'is_student',false,'can_write',false)) end
$$;
create function planning_review_private.board_visible(ident uuid) returns boolean language sql stable set search_path='' as $$
 select planning_private.member() and exists(select 1 from public.planning_boards b left join public.planning_seasons s on s.id=b.season_id
 where b.id=ident and (planning_private.manager() or (b.active and (b.kind='area' or s.status='active'))))
$$;
create function planning_review_private.can_edit(ident uuid) returns boolean language sql stable set search_path='' as $$
 select planning_review_private.writer() and exists(select 1 from public.planning_boards b join public.planning_seasons s on s.id=b.season_id
 where b.id=ident and b.kind='project' and b.active and s.status<>'archived' and (planning_private.manager() or
 (s.status='active' and (exists(select 1 from public.planning_project_review_assignments a where a.board_id=ident and a.lead_id=auth.uid())
 or exists(select 1 from public.planning_project_review_supporters x where x.board_id=ident and x.user_id=auth.uid())))))
$$;
create function planning_review_private.actor(expected_actor uuid) returns void language plpgsql set search_path='' as $$
begin
 if expected_actor is null or auth.uid() is distinct from expected_actor or not planning_private.member() then raise exception using errcode='SR401',message='Sprint Review account changed';end if;
end $$;
create function planning_review_private.error_message(code text) returns text language sql immutable set search_path='' as $$
 select case code when 'SR401' then 'Your account changed. Reload Sprint Review before continuing.'
 when 'SR403' then 'This Sprint Review action is unavailable for your current access.'
 when 'SR409' then 'Changed by another teammate. Refresh before saving.'
 when 'SR412' then 'This request ID was already used for a different change.'
 when 'SR422' then 'Invalid Sprint Review request. Check the fields and linked records.'
 else 'Sprint Review could not complete this request. Check its status before retrying.' end
$$;
create function planning_review_private.keys(v jsonb,allowed text[]) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v) k where not(k=any(allowed)))
 or exists(select 1 from unnest(allowed) k where not(v ? k)) then raise exception using errcode='SR422',message='Invalid fields';end if;
end $$;
create function planning_review_private.text_field(v jsonb,k text,max_len integer,required boolean default false) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(v->k) is distinct from 'string' or planning_review_private.js_length(v->>k)>max_len
 or (required and length(planning_review_private.clean(v->>k))=0) then raise exception using errcode='SR422',message='Invalid text';end if;
end $$;
create function planning_review_private.uid(v jsonb) returns uuid language plpgsql immutable set search_path='' as $$
begin
 if v='null'::jsonb then return null;end if;
 if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='SR422',message='Invalid identity';end if;
 return (v#>>'{}')::uuid;
end $$;
create function planning_review_private.ids(v jsonb) returns uuid[] language plpgsql immutable set search_path='' as $$
declare result uuid[]; n integer;
begin
 if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>30 then raise exception using errcode='SR422',message='Invalid identity list';end if;
 select coalesce(array_agg(planning_review_private.uid(x) order by planning_review_private.uid(x)),'{}'),count(*) into result,n from jsonb_array_elements(v) x;
 if array_position(result,null) is not null or (select count(distinct u) from unnest(result) u)<>n then raise exception using errcode='SR422',message='Invalid identity list';end if;
 return result;
end $$;
create function planning_review_private.valid_url(v text) returns boolean language sql immutable set search_path='' as $$
 select planning_review_private.js_length(v) between 1 and 2000 and v~'^https?://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$'
 and v!~'[[:cntrl:]]' and position(chr(92) in v)=0
 and v!~U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]'
$$;
create function planning_review_private.references_valid(v jsonb) returns void language plpgsql set search_path='' as $$
declare r jsonb;
begin
 if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>20 then raise exception using errcode='SR422',message='Invalid reference list';end if;
 for r in select value from jsonb_array_elements(v) loop
  perform planning_review_private.keys(r,array['label','url','reference_id']);
  perform planning_review_private.text_field(r,'label',200,true);
  perform planning_review_private.text_field(r,'url',2000);
  perform planning_review_private.text_field(r,'reference_id',200);
  if not planning_review_private.valid_url(r->>'url') then raise exception using errcode='SR422',message='Invalid reference URL';end if;
 end loop;
end $$;
create function planning_review_private.safe_references(v jsonb) returns jsonb language sql immutable set search_path='' as $$
 -- Preserve every accepted reference label/ID through read -> edit -> export.
 -- Reference fields allow 200 UTF-16 units; person/project display labels allow 150.
 select coalesce(jsonb_agg(jsonb_build_object('label',planning_review_private.bounded_text(case when planning_review_private.clean(x->>'label')='' then 'Source' else x->>'label' end,200),
 'url',case when planning_review_private.valid_url(x->>'url') then x->>'url' else '' end,'reference_id',planning_review_private.bounded_text(x->>'reference_id',200))),'[]')
 from jsonb_array_elements(v) x
$$;
create function planning_review_private.task(ident uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare t public.planning_tasks;
begin
 if ident is null then return null;end if;
 select * into t from public.planning_tasks where id=ident;
 if t.id is null or not planning_review_private.board_visible(t.board_id) then
  return jsonb_build_object('id',ident,'board_id',null,'title','Linked task unavailable','status',null,'available',false,'owner_ids','[]'::jsonb,'owners','[]'::jsonb,'due_date',null,'due_date_unavailable',false);
 end if;
 return jsonb_build_object('id',t.id,'board_id',t.board_id,'title',planning_review_private.label(t.title,'Untitled task'),'status',t.status,'available',true,
 'owner_ids',(select coalesce(jsonb_agg(a.user_id order by a.user_id),'[]') from public.planning_task_assignees a where a.task_id=t.id),
 'owners',(select coalesce(jsonb_agg(planning_review_private.person(a.user_id) order by a.user_id),'[]') from public.planning_task_assignees a where a.task_id=t.id),
 'due_date',case when t.due_date between date '0001-01-01' and date '9999-12-31' then to_char(t.due_date,'YYYY-MM-DD') else null end,
 'due_date_unavailable',t.due_date is not null and not(t.due_date between date '0001-01-01' and date '9999-12-31'));
end $$;
create function planning_review_private.update_json(u public.planning_sprint_review_updates) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(u)||jsonb_build_object('evidence',planning_review_private.safe_references(u.evidence),'decision_references',planning_review_private.safe_references(u.decision_references),
 'linked_task',planning_review_private.task(u.linked_task_id),
 'reported_students',(select coalesce(jsonb_agg(planning_review_private.person(x) order by x),'[]') from unnest(u.reported_by_student_ids) x),
 'carried_from',(select jsonb_build_object('update_id',p.id,'review_id',r.id,'review_title',r.title,'review_date',to_char(r.review_date,'YYYY-MM-DD'))
 from public.planning_sprint_review_updates p join public.planning_sprint_reviews r on r.id=p.review_id where p.id=u.carry_from_update_id and planning_review_private.board_visible(p.board_id)))
$$;
create function planning_review_private.assignment_json(ident uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('board_id',a.board_id,'lead_id',a.lead_id,'version',a.version,'lead',planning_review_private.person(a.lead_id),
 'supporter_ids',(select coalesce(jsonb_agg(x.user_id order by x.user_id),'[]') from public.planning_project_review_supporters x where x.board_id=ident),
 'supporters',(select coalesce(jsonb_agg(planning_review_private.person(x.user_id) order by x.user_id),'[]') from public.planning_project_review_supporters x where x.board_id=ident))
 from public.planning_project_review_assignments a where a.board_id=ident
$$;
create function planning_review_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='SR403',message='Immutable record';end $$;
create trigger planning_review_history_immutable before update or delete on planning_review_private.history for each row execute function planning_review_private.immutable();
create trigger planning_review_requests_immutable before update or delete on planning_review_private.requests for each row execute function planning_review_private.immutable();

create function public.sprint_review_context(selected_season uuid default null,selected_review uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid; rid uuid; manager boolean; review_day date; review_created timestamptz;
begin
 if not planning_private.member() then raise exception using errcode='SR401',message='Active account required';end if;
 manager:=planning_private.manager();
 if selected_season is null and selected_review is not null then
  -- A direct review link supplies no season selector. Resolve its actual season
  -- through the same Planning visibility check; never fall back to another season.
  select s.id into sid from public.planning_sprint_reviews r join public.planning_seasons s on s.id=r.season_id
  where r.id=selected_review and (manager or s.status='active');
  if sid is null then raise exception using errcode='SR403',message='Review unavailable';end if;
 else
  select id into sid from public.planning_seasons where (selected_season is null or id=selected_season) and (manager or status='active') order by (status='active') desc,created_at desc,id limit 1;
 end if;
 if selected_season is not null and sid is null then raise exception using errcode='SR403',message='Season unavailable';end if;
 select id,review_date,created_at into rid,review_day,review_created from public.planning_sprint_reviews where season_id=sid and (selected_review is null or id=selected_review) order by review_date desc,created_at desc,id limit 1;
 if selected_review is not null and rid is null then raise exception using errcode='SR403',message='Review unavailable';end if;
 return jsonb_build_object('user_id',auth.uid(),'can_manage',manager,'season_id',sid,'selected_review_id',rid,'loaded_at',clock_timestamp(),
 'seasons',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',planning_review_private.label(s.name,'Planning season'),'status',s.status) order by s.created_at desc,s.id),'[]') from public.planning_seasons s where manager or s.status='active'),
 'members',(select coalesce(jsonb_agg(planning_review_private.person(p.id) order by p.display_name nulls last,p.id),'[]') from public.profiles p where p.active),
 'boards',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'season_id',b.season_id,'name',planning_review_private.label(b.name,'Project'),'active',b.active,
 'can_edit_update',planning_review_private.can_edit(b.id),'assignment',planning_review_private.assignment_json(b.id)) order by b.display_order,b.name,b.id),'[]') from public.planning_boards b where b.kind='project' and b.season_id=sid and (manager or b.active)),
 'reviews',(select coalesce(jsonb_agg(to_jsonb(r)-'created_at' order by r.review_date desc,r.created_at desc,r.id),'[]') from public.planning_sprint_reviews r where r.season_id=sid and (r.id=rid or r.id in (select x.id from public.planning_sprint_reviews x where x.season_id=sid order by x.review_date desc,x.created_at desc,x.id limit 100))),
 'reviews_limit_reached',(select count(*)>100 from public.planning_sprint_reviews where season_id=sid),
 'updates',(select coalesce(jsonb_agg(planning_review_private.update_json(u) order by u.board_id),'[]') from public.planning_sprint_review_updates u where u.review_id=rid and planning_review_private.board_visible(u.board_id)),
 'previous_updates',(select coalesce(jsonb_agg(planning_review_private.update_json(u) order by u.board_id),'[]') from public.planning_sprint_review_updates u where u.id in
 (select distinct on(p.board_id) p.id from public.planning_sprint_review_updates p join public.planning_sprint_reviews r on r.id=p.review_id
 where r.season_id=sid and (r.review_date,r.created_at,r.id)<(review_day,review_created,rid) and planning_review_private.board_visible(p.board_id) order by p.board_id,r.review_date desc,r.created_at desc,r.id desc)),
 'tasks',(select coalesce(jsonb_agg(planning_review_private.task(t.id) order by t.id),'[]') from public.planning_tasks t join public.planning_boards b on b.id=t.board_id where sid is not null and (b.season_id=sid or b.kind='area') and planning_review_private.board_visible(b.id)));
exception when others then raise exception using errcode=case when sqlstate like 'SR%' then sqlstate else 'SR500' end,message=planning_review_private.error_message(sqlstate),detail='',hint='';
end $$;

-- Authorize before replay, so revoked writers cannot use an old request as a write capability.
create function planning_review_private.authorize(action text,p jsonb) returns void language plpgsql set search_path='' as $$
declare sid uuid; bid uuid; rid uuid;
begin
 if not planning_review_private.writer() then raise exception using errcode='SR403',message='Writer required';end if;
 if action='review' then
  if not planning_private.manager() then raise exception using errcode='SR403',message='Leadership required';end if;
  sid:=planning_review_private.uid(p->'season_id');
 elsif action='assignment' then
  if not planning_private.manager() then raise exception using errcode='SR403',message='Leadership required';end if;
  bid:=planning_review_private.uid(p->'board_id');
 elsif action='update' then
  bid:=planning_review_private.uid(p->'board_id');rid:=planning_review_private.uid(p->'review_id');
  if not planning_review_private.can_edit(bid) then raise exception using errcode='SR403',message='Assigned writer required';end if;
  select season_id into sid from public.planning_sprint_reviews where id=rid;
  if sid is null then raise exception using errcode='SR403',message='Review unavailable';end if;
 else raise exception using errcode='SR422',message='Unknown action';end if;
 if bid is not null then
  if not exists(select 1 from public.planning_boards b where b.id=bid and b.kind='project' and b.active and (sid is null or b.season_id=sid)) then raise exception using errcode='SR403',message='Project unavailable';end if;
  select b.season_id into sid from public.planning_boards b where b.id=bid;
 end if;
 if not exists(select 1 from public.planning_seasons s where s.id=sid and s.status<>'archived' and (planning_private.manager() or s.status='active')) then raise exception using errcode='SR403',message='Season unavailable';end if;
end $$;
create function planning_review_private.receipt(ident uuid,who uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce((select jsonb_build_object('request_id',r.request_id,'status',r.status,'action',r.action,'entity_id',r.entity_id,'version',r.version) from planning_review_private.requests r where r.actor_id=who and r.request_id=ident),
 jsonb_build_object('request_id',ident,'status','unknown','action',null,'entity_id',null,'version',null))
$$;
create function public.sprint_review_save(action text,request_id uuid,expected_actor uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ident uuid; old jsonb; result jsonb; prior planning_review_private.requests; previous_version integer;
 r public.planning_sprint_reviews; u public.planning_sprint_review_updates; a public.planning_project_review_assignments;
 member_ids uuid[]; student_ids uuid[]; person_id uuid; task_id uuid; carried_id uuid; item jsonb; field text;
begin
 perform pg_advisory_xact_lock(4418,30);
 perform planning_review_private.actor(expected_actor);
 if request_id is null or p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>64000 then raise exception using errcode='SR422',message='Invalid request';end if;
 perform planning_review_private.authorize(action,p);
 select * into prior from planning_review_private.requests q where q.actor_id=expected_actor and q.request_id=sprint_review_save.request_id;
 if found then
  if prior.status='applied' and (prior.action is distinct from action or prior.payload is distinct from p) then raise exception using errcode='SR412',message='Request conflict';end if;
  return planning_review_private.receipt(request_id,expected_actor);
 end if;
 if action='review' then
  perform planning_review_private.keys(p,array['id','version','season_id','title','review_date','chair_id','agenda']);
  ident:=planning_review_private.uid(p->'id');select * into r from public.planning_sprint_reviews where id=ident;
  if r.id is not null then old:=to_jsonb(r);previous_version:=r.version;if r.season_id is distinct from planning_review_private.uid(p->'season_id') then raise exception using errcode='SR403',message='Stable season required';end if;end if;
 elsif action='assignment' then
  perform planning_review_private.keys(p,array['board_id','version','lead_id','supporter_ids']);
  ident:=planning_review_private.uid(p->'board_id');select * into a from public.planning_project_review_assignments where board_id=ident;
  if a.board_id is not null then old:=planning_review_private.assignment_json(ident);previous_version:=a.version;end if;
 else
  perform planning_review_private.keys(p,array['id','version','review_id','board_id','progress','blockers','evidence','tradeoffs','decisions_needed','decision_references','reported_decision','decision_rationale','reported_by_student_ids','next_test','linked_task_id','carry_from_update_id','unresolved']);
  ident:=planning_review_private.uid(p->'id');select * into u from public.planning_sprint_review_updates where id=ident;
  if u.id is not null then old:=to_jsonb(u);previous_version:=u.version;
   if u.review_id is distinct from planning_review_private.uid(p->'review_id') or u.board_id is distinct from planning_review_private.uid(p->'board_id') then raise exception using errcode='SR403',message='Stable update scope required';end if;
  elsif exists(select 1 from public.planning_sprint_review_updates x where x.review_id=planning_review_private.uid(p->'review_id') and x.board_id=planning_review_private.uid(p->'board_id')) then raise exception using errcode='SR409',message='Update already exists';end if;
 end if;
 if ident is null then raise exception using errcode='SR422',message='Identity required';end if;
 if previous_version is null then
  if p->'version' is distinct from 'null'::jsonb then raise exception using errcode='SR409',message='New version required';end if;
 elsif jsonb_typeof(p->'version') is distinct from 'number' or (p->>'version') !~'^[1-9][0-9]{0,9}$' or (p->>'version')::bigint is distinct from previous_version then raise exception using errcode='SR409',message='Stale version';end if;
 if action='review' then
  perform planning_review_private.text_field(p,'title',200,true);perform planning_review_private.text_field(p,'review_date',10,true);
  if (p->>'review_date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (p->>'review_date')::date not between date '0001-01-01' and date '9999-12-31' then raise exception using errcode='SR422',message='Finite calendar date required';end if;
  -- A date correction must preserve the order of existing carry-forward links.
  -- Otherwise later writes could create a cycle by first reversing meeting dates.
  if r.id is not null and exists(
   select 1 from public.planning_sprint_review_updates child
   join public.planning_sprint_review_updates source on source.id=child.carry_from_update_id
   join public.planning_sprint_reviews cr on cr.id=child.review_id
   join public.planning_sprint_reviews sr on sr.id=source.review_id
   where (cr.id=r.id or sr.id=r.id) and
   (case when sr.id=r.id then (p->>'review_date')::date else sr.review_date end,sr.created_at,sr.id)>=
   (case when cr.id=r.id then (p->>'review_date')::date else cr.review_date end,cr.created_at,cr.id)
  ) then raise exception using errcode='SR422',message='Keep carry-forward meeting order';end if;
  person_id:=planning_review_private.uid(p->'chair_id');
  if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead','mentor','admin')) and person_id is distinct from r.chair_id then raise exception using errcode='SR422',message='Choose an active chair';end if;
  if jsonb_typeof(p->'agenda') is distinct from 'array' or jsonb_array_length(p->'agenda')>30 then raise exception using errcode='SR422',message='Invalid agenda';end if;
  for item in select value from jsonb_array_elements(p->'agenda') loop
   perform planning_review_private.keys(item,array['title','presenter_id','duration_minutes']);perform planning_review_private.text_field(item,'title',200,true);
   if jsonb_typeof(item->'duration_minutes') is distinct from 'number' or (item->>'duration_minutes') !~'^[1-9][0-9]{0,2}$' or (item->>'duration_minutes')::integer>240 then raise exception using errcode='SR422',message='Invalid agenda duration';end if;
   person_id:=planning_review_private.uid(item->'presenter_id');
   if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead','mentor','admin'))
   and not exists(select 1 from jsonb_array_elements(coalesce(r.agenda,'[]')) x where x->>'presenter_id'=person_id::text) then raise exception using errcode='SR422',message='Choose an active presenter';end if;
  end loop;
  insert into public.planning_sprint_reviews(id,season_id,title,review_date,chair_id,agenda,recorded_by)
  values(ident,planning_review_private.uid(p->'season_id'),planning_review_private.clean(p->>'title'),(p->>'review_date')::date,planning_review_private.uid(p->'chair_id'),p->'agenda',auth.uid())
  on conflict(id) do update set title=excluded.title,review_date=excluded.review_date,chair_id=excluded.chair_id,agenda=excluded.agenda,version=planning_sprint_reviews.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp()
  returning to_jsonb(planning_sprint_reviews.*) into result;
 elsif action='assignment' then
  person_id:=planning_review_private.uid(p->'lead_id');member_ids:=planning_review_private.ids(p->'supporter_ids');
  if person_id is not null and not exists(select 1 from public.profiles x where x.id=person_id and x.active and x.role::text in ('student','lead')) and person_id is distinct from a.lead_id then raise exception using errcode='SR422',message='Choose an active student lead';end if;
  if person_id=any(member_ids) then raise exception using errcode='SR422',message='Lead already participates';end if;
  if exists(select 1 from unnest(member_ids) x where not exists(select 1 from public.profiles y where y.id=x and y.active and y.role::text in ('student','lead','mentor','admin'))
   and not exists(select 1 from public.planning_project_review_supporters z where z.board_id=ident and z.user_id=x)) then raise exception using errcode='SR422',message='Choose active supporters';end if;
  insert into public.planning_project_review_assignments(board_id,lead_id,recorded_by) values(ident,person_id,auth.uid())
  on conflict(board_id) do update set lead_id=excluded.lead_id,version=planning_project_review_assignments.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp();
  delete from public.planning_project_review_supporters where board_id=ident and not(user_id=any(member_ids));
  insert into public.planning_project_review_supporters(board_id,user_id) select ident,x from unnest(member_ids) x on conflict do nothing;
  result:=planning_review_private.assignment_json(ident);
 else
  foreach field in array array['progress','blockers','tradeoffs','decisions_needed','reported_decision','decision_rationale','next_test'] loop perform planning_review_private.text_field(p,field,5000);end loop;
  perform planning_review_private.references_valid(p->'evidence');perform planning_review_private.references_valid(p->'decision_references');
  student_ids:=planning_review_private.ids(p->'reported_by_student_ids');
  if exists(select 1 from unnest(student_ids) x where not exists(select 1 from public.profiles y where y.id=x and y.active and y.role::text in ('student','lead')) and not(x=any(coalesce(u.reported_by_student_ids,'{}')))) then raise exception using errcode='SR422',message='Choose reported student participants';end if;
  task_id:=planning_review_private.uid(p->'linked_task_id');carried_id:=planning_review_private.uid(p->'carry_from_update_id');
  select * into r from public.planning_sprint_reviews where id=planning_review_private.uid(p->'review_id');
  if task_id is not null and task_id is distinct from u.linked_task_id and not exists(select 1 from public.planning_tasks t join public.planning_boards b on b.id=t.board_id
   where t.id=task_id and b.active and (b.season_id=r.season_id or b.kind='area') and planning_review_private.board_visible(b.id)) then raise exception using errcode='SR422',message='Choose visible Planning work';end if;
  if carried_id is not null and not exists(select 1 from public.planning_sprint_review_updates x join public.planning_sprint_reviews y on y.id=x.review_id
   where x.id=carried_id and x.board_id=planning_review_private.uid(p->'board_id') and y.season_id=r.season_id and (y.review_date,y.created_at,y.id)<(r.review_date,r.created_at,r.id)) then raise exception using errcode='SR422',message='Choose an earlier update for this project';end if;
  if jsonb_typeof(p->'unresolved') is distinct from 'boolean' then raise exception using errcode='SR422',message='Invalid unresolved flag';end if;
  insert into public.planning_sprint_review_updates(id,review_id,board_id,progress,blockers,evidence,tradeoffs,decisions_needed,decision_references,reported_decision,decision_rationale,reported_by_student_ids,next_test,linked_task_id,carry_from_update_id,unresolved,recorded_by)
  values(ident,r.id,planning_review_private.uid(p->'board_id'),p->>'progress',p->>'blockers',p->'evidence',p->>'tradeoffs',p->>'decisions_needed',p->'decision_references',p->>'reported_decision',p->>'decision_rationale',student_ids,p->>'next_test',task_id,carried_id,(p->>'unresolved')::boolean,auth.uid())
  on conflict(id) do update set progress=excluded.progress,blockers=excluded.blockers,evidence=excluded.evidence,tradeoffs=excluded.tradeoffs,decisions_needed=excluded.decisions_needed,decision_references=excluded.decision_references,reported_decision=excluded.reported_decision,decision_rationale=excluded.decision_rationale,reported_by_student_ids=excluded.reported_by_student_ids,next_test=excluded.next_test,linked_task_id=excluded.linked_task_id,carry_from_update_id=excluded.carry_from_update_id,unresolved=excluded.unresolved,version=planning_sprint_review_updates.version+1,recorded_by=auth.uid(),recorded_at=clock_timestamp()
  returning to_jsonb(planning_sprint_review_updates.*) into result;
 end if;
 insert into planning_review_private.history(action,entity_id,actor_id,request_id,before_data,after_data) values(action,ident,auth.uid(),request_id,old,result);
 insert into planning_review_private.requests(actor_id,request_id,action,payload,status,entity_id,version) values(auth.uid(),request_id,action,p,'applied',ident,(result->>'version')::integer);
 return planning_review_private.receipt(request_id,expected_actor);
exception when others then raise exception using errcode=case when sqlstate like 'SR%' then sqlstate else 'SR422' end,message=planning_review_private.error_message(case when sqlstate like 'SR%' then sqlstate else 'SR422' end),detail='',hint='';
end $$;
create function public.sprint_review_mutation_status(request_id uuid,expected_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(4418,30);perform planning_review_private.actor(expected_actor);
 if request_id is null then raise exception using errcode='SR422',message='Request identity required';end if;
 return planning_review_private.receipt(request_id,expected_actor);
exception when others then raise exception using errcode=case when sqlstate like 'SR%' then sqlstate else 'SR500' end,message=planning_review_private.error_message(sqlstate),detail='',hint='';
end $$;
create function public.sprint_review_cancel_mutation(request_id uuid,expected_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(4418,30);perform planning_review_private.actor(expected_actor);
 if request_id is null then raise exception using errcode='SR422',message='Request identity required';end if;
 insert into planning_review_private.requests(actor_id,request_id,status) values(expected_actor,request_id,'cancelled') on conflict do nothing;
 return planning_review_private.receipt(request_id,expected_actor);
exception when others then raise exception using errcode=case when sqlstate like 'SR%' then sqlstate else 'SR500' end,message=planning_review_private.error_message(sqlstate),detail='',hint='';
end $$;

alter table public.planning_sprint_reviews enable row level security;
alter table public.planning_project_review_assignments enable row level security;
alter table public.planning_project_review_supporters enable row level security;
alter table public.planning_sprint_review_updates enable row level security;
alter table planning_review_private.history enable row level security;
alter table planning_review_private.requests enable row level security;
revoke all on public.planning_sprint_reviews,public.planning_project_review_assignments,public.planning_project_review_supporters,public.planning_sprint_review_updates from public,anon,authenticated,service_role;
revoke all on all tables in schema planning_review_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema planning_review_private from public,anon,authenticated,service_role;
revoke all on all functions in schema planning_review_private from public,anon,authenticated,service_role;
revoke all on function public.sprint_review_context(uuid,uuid),public.sprint_review_save(text,uuid,uuid,jsonb),public.sprint_review_mutation_status(uuid,uuid),public.sprint_review_cancel_mutation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sprint_review_context(uuid,uuid),public.sprint_review_save(text,uuid,uuid,jsonb),public.sprint_review_mutation_status(uuid,uuid),public.sprint_review_cancel_mutation(uuid,uuid) to authenticated;
commit;
