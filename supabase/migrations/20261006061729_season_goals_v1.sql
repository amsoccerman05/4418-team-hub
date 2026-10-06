-- REVIEW ONLY. Additive Season Goals proposal; no production application authorized.
-- Existing planning_private.member()/manager() and all Task/Finance rights stay unchanged.
begin;
-- Match ECMAScript String.trim exactly (including NBSP, line separators and BOM).
-- These are the required-text semantics used by the browser contract.
create function planning_private.goal_trim(value text) returns text language sql immutable strict set search_path='' as $$
 select btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
create table public.planning_goals (
 id uuid primary key, season_id uuid not null references public.planning_seasons(id),
 title text not null check(length(planning_private.goal_trim(title)) between 1 and 200),
 description text not null default '' check(length(description)<=5000),
 category text not null check(category in ('engineering','performance','fundraising','team_growth')),
 owner_id uuid not null references public.profiles(id),
 baseline numeric not null check(baseline::text not in ('NaN','Infinity','-Infinity') and abs(baseline)<=1e12),
 target numeric not null check(target::text not in ('NaN','Infinity','-Infinity') and abs(target)<=1e12),
 unit text not null check(length(planning_private.goal_trim(unit)) between 1 and 60),
 direction text not null check(direction in ('increase','decrease','equal')),
 deadline date not null check(deadline between date '0001-01-01' and date '9999-12-31'),
 fundraising_measure text check(fundraising_measure in ('pledged','received')),
 next_milestone_id uuid,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),version integer not null default 1 check(version>0),
 unique(id,season_id),
 check((category='fundraising')=(fundraising_measure is not null)),
 check((direction='increase' and target>baseline) or (direction='decrease' and target<baseline) or (direction='equal' and target=baseline))
);
create index planning_goals_season on public.planning_goals(season_id,created_at);
create table public.planning_goal_supporters (
 goal_id uuid not null references public.planning_goals(id),user_id uuid not null references public.profiles(id),
 primary key(goal_id,user_id)
);
create table public.planning_goal_task_links (
 goal_id uuid not null references public.planning_goals(id),task_id uuid not null references public.planning_tasks(id),
 primary key(goal_id,task_id)
);
create table public.planning_goal_milestone_links (
 goal_id uuid not null,season_id uuid not null,milestone_id uuid not null,
 primary key(goal_id,milestone_id),foreign key(goal_id,season_id) references public.planning_goals(id,season_id),
 foreign key(milestone_id,season_id) references public.planning_items(id,season_id)
);
alter table public.planning_goals add constraint planning_goal_next_milestone_link
 foreign key(id,next_milestone_id) references public.planning_goal_milestone_links(goal_id,milestone_id)
 deferrable initially deferred;
create table public.planning_goal_updates (
 id uuid primary key,goal_id uuid not null references public.planning_goals(id),
 kind text not null check(kind in ('measurement','weekly')),
 measured_value numeric check(measured_value::text not in ('NaN','Infinity','-Infinity') and abs(measured_value)<=1e12),
 status text not null check(status in ('on_track','at_risk','blocked','achieved')),
 evidence text not null check(length(planning_private.goal_trim(evidence)) between 1 and 5000),
 evidence_url text check(evidence_url is null or (length(evidence_url)<=2000 and evidence_url ~ '^https://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9a-fA-F:]+\])(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' and coalesce(substring(evidence_url from '^https://[^/?#]+:([0-9]{1,5})(?:[/?#]|$)')::integer,443)<=65535)),
 next_step text not null check(length(planning_private.goal_trim(next_step)) between 1 and 2000),
 observed_on date not null check(observed_on between date '0001-01-01' and date '9999-12-31'),
 author_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 goal_version integer not null check(goal_version>1),unique(goal_id,goal_version),
 check((kind='measurement')=(measured_value is not null))
);
create index planning_goal_updates_goal on public.planning_goal_updates(goal_id,goal_version desc);
create table planning_private.goal_operations (
 operation_id uuid primary key,actor_id uuid not null references public.profiles(id),
 kind text check(kind in ('save','update')),payload jsonb,
 state text not null check(state in ('committed','cancelled')),result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 check((state='committed' and kind is not null and payload is not null and result is not null)
    or (state='cancelled' and kind is null and payload is null and result is null))
);
create table planning_private.goal_history (
 id bigint generated always as identity primary key,operation_id uuid not null unique references planning_private.goal_operations(operation_id),
 goal_id uuid not null references public.planning_goals(id),actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('created','edited','measurement','weekly')),
 before_data jsonb,after_data jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create function planning_private.goal_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Goal evidence and operation history are append only' using errcode='42501';end $$;
create trigger planning_goal_updates_immutable before update or delete on public.planning_goal_updates for each row execute function planning_private.goal_immutable();
create trigger planning_goal_updates_no_truncate before truncate on public.planning_goal_updates for each statement execute function planning_private.goal_immutable();
create trigger planning_goal_operations_immutable before update or delete on planning_private.goal_operations for each row execute function planning_private.goal_immutable();
create trigger planning_goal_operations_no_truncate before truncate on planning_private.goal_operations for each statement execute function planning_private.goal_immutable();
create trigger planning_goal_history_immutable before update or delete on planning_private.goal_history for each row execute function planning_private.goal_immutable();
create trigger planning_goal_history_no_truncate before truncate on planning_private.goal_history for each statement execute function planning_private.goal_immutable();

create function planning_private.goal_require_actor(expected_actor uuid) returns void language plpgsql volatile set search_path='' as $$
begin
 if expected_actor is null or auth.uid() is distinct from expected_actor then raise exception 'Account changed. Return to the original account to resolve this operation.' using errcode='42501';end if;
 if not planning_private.member() then raise exception 'Active team account required' using errcode='42501';end if;
end $$;
create function planning_private.goal_student(person uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where id=person and active and role::text in ('student','lead'))
$$;
create function planning_private.goal_contributor(person uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where id=person and active and role::text in ('student','lead','mentor','admin'))
$$;
create function planning_private.goal_person(person uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',id,'name',left(coalesce(nullif(planning_private.goal_trim(display_name),''),'Team member'),200),'active',coalesce(active,false)) from public.profiles where id=person
$$;
create function planning_private.goal_snapshot(goal uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(g)||jsonb_build_object(
 'supporter_ids',(select coalesce(jsonb_agg(user_id order by user_id),'[]') from public.planning_goal_supporters where goal_id=g.id),
 'task_ids',(select coalesce(jsonb_agg(task_id order by task_id),'[]') from public.planning_goal_task_links where goal_id=g.id),
 'milestone_ids',(select coalesce(jsonb_agg(milestone_id order by milestone_id),'[]') from public.planning_goal_milestone_links where goal_id=g.id))
 from public.planning_goals g where id=goal
$$;
create function planning_private.goal_uuid_list(p jsonb,key text) returns uuid[] language plpgsql set search_path='' as $$
declare answer uuid[];
begin
 if jsonb_typeof(p->key) is distinct from 'array' then raise exception 'Expected a % list',key using errcode='22023';end if;
 if jsonb_array_length(p->key)>50 then raise exception 'Too many %',key using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p->key) x where jsonb_typeof(x) is distinct from 'string') then raise exception 'Invalid identity in %',key using errcode='22023';end if;
 select coalesce(array_agg(value::uuid order by value::uuid),'{}') into answer from jsonb_array_elements_text(p->key);
 if cardinality(answer)<>(select count(distinct x) from unnest(answer) x) then raise exception 'Duplicate identity in %',key using errcode='22023';end if;
 return answer;
end $$;
-- Hold existing role rows while writing. Re-evaluate the existing manager() predicate only
-- after all possible waits; JWT role claims and client capabilities never grant authority.
create function planning_private.goal_lock_actor(actor uuid) returns void language plpgsql volatile set search_path='' as $$
begin
 perform 1 from public.profiles where id=actor for share;
 perform 1 from public.team_member_positions where user_id=actor order by position_key for share;
 perform 1 from public.team_positions where key in (select position_key from public.team_member_positions where user_id=actor) order by key for share;
end $$;
create function planning_private.goal_receipt(op planning_private.goal_operations) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('status',op.state,'operation_id',op.operation_id,'result',op.result)
$$;

create function planning_private.goals_context(selected_season uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid; season public.planning_seasons; manager boolean; writable boolean;
begin
 if not planning_private.member() then raise exception 'Active team account required' using errcode='42501';end if;
 manager:=planning_private.manager();
 select * into season from public.planning_seasons where (selected_season is null or id=selected_season)
 and (manager or status='active') order by (status='active') desc,created_at desc limit 1;
 sid:=season.id;
 if selected_season is not null and sid is null then raise exception 'Season unavailable' using errcode='42501';end if;
 writable:=sid is not null and season.status<>'archived' and (manager or season.status='active');
 return jsonb_build_object('user_id',auth.uid(),'season_id',sid,
 'season',case when sid is null then null else jsonb_build_object('id',sid,'name',season.name,'status',season.status) end,
 'capabilities',jsonb_build_object('can_create',writable and (manager or planning_private.goal_student(auth.uid())),'can_manage',manager,'can_reassign',writable and manager),
 'eligible_owners',(select coalesce(jsonb_agg(planning_private.goal_person(p.id) order by p.display_name,p.id),'[]') from public.profiles p where p.active and p.role::text in ('student','lead') and (manager or p.id=auth.uid())),
 'members',(select coalesce(jsonb_agg(planning_private.goal_person(p.id) order by p.display_name,p.id),'[]') from public.profiles p where p.active and p.role::text in ('student','lead','mentor','admin')),
 'goals',(select coalesce(jsonb_agg(planning_private.goal_snapshot(g.id)||jsonb_build_object(
  'owner',planning_private.goal_person(g.owner_id),
  'supporters',(select coalesce(jsonb_agg(planning_private.goal_person(s.user_id) order by s.user_id),'[]') from public.planning_goal_supporters s where goal_id=g.id),
  'capabilities',jsonb_build_object('can_edit',writable and (manager or (g.owner_id=auth.uid() and planning_private.goal_student(auth.uid()))),
   'can_reassign',writable and manager,
   'can_update',writable and (manager or (g.owner_id=auth.uid() and planning_private.goal_student(auth.uid())) or (planning_private.goal_contributor(auth.uid()) and exists(select 1 from public.planning_goal_supporters where goal_id=g.id and user_id=auth.uid())))),
  'measurement_locked',exists(select 1 from public.planning_goal_updates where goal_id=g.id),
  'updates',(select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('author',planning_private.goal_person(u.author_id)) order by u.goal_version desc),'[]') from public.planning_goal_updates u where goal_id=g.id)
 ) order by g.created_at,g.id),'[]') from public.planning_goals g where g.season_id=sid),
 'tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,
  'board_id',case when (b.season_id=sid or b.kind='area') and (manager or b.active) then t.board_id else null end,
  'title',case when (b.season_id=sid or b.kind='area') and (manager or b.active) then t.title else 'Unavailable task' end,
  'status',case when (b.season_id=sid or b.kind='area') and (manager or b.active) then t.status else 'unavailable' end,
  'owner_ids',case when (b.season_id=sid or b.kind='area') and (manager or b.active) then (select coalesce(jsonb_agg(a.user_id order by a.user_id),'[]') from public.planning_task_assignees a where a.task_id=t.id) else '[]'::jsonb end,
  'available',b.active and (b.season_id=sid or b.kind='area')) order by t.title,t.id),'[]')
  from public.planning_tasks t join public.planning_boards b on b.id=t.board_id
  where sid is not null and ((b.active and (b.season_id=sid or b.kind='area')) or exists(select 1 from public.planning_goal_task_links l join public.planning_goals g on g.id=l.goal_id where l.task_id=t.id and g.season_id=sid))),
 'milestones',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,
  'title',case when i.start_date between date '0001-01-01' and date '9999-12-31' and i.end_date between date '0001-01-01' and date '9999-12-31' then i.title else 'Unavailable milestone' end,
  'start_date',case when i.start_date between date '0001-01-01' and date '9999-12-31' and i.end_date between date '0001-01-01' and date '9999-12-31' then i.start_date else null end,
  'status',case when i.start_date between date '0001-01-01' and date '9999-12-31' and i.end_date between date '0001-01-01' and date '9999-12-31' then i.status else 'unavailable' end,
  'available',i.kind='milestone' and i.start_date between date '0001-01-01' and date '9999-12-31' and i.end_date between date '0001-01-01' and date '9999-12-31') order by i.start_date,i.id),'[]') from public.planning_items i where i.season_id=sid and (i.kind='milestone' or exists(select 1 from public.planning_goal_milestone_links l where l.milestone_id=i.id))));
end $$;

create function planning_private.goal_save(p jsonb,expected_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ident uuid; oid uuid; sid uuid; owner uuid; next_id uuid; supporters uuid[]; tasks uuid[]; milestones uuid[];
 old public.planning_goals; season public.planning_seasons; before_data jsonb; after_data jsonb; manager boolean;
 op planning_private.goal_operations; result jsonb; revision integer; val_baseline numeric; val_target numeric;
begin
 perform planning_private.goal_require_actor(expected_actor);
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Goal payload required' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('operation_id','id','expected_version','season_id','title','description','category','owner_id','baseline','target','unit','direction','deadline','fundraising_measure','supporter_ids','task_ids','milestone_ids','next_milestone_id')) then raise exception 'Unknown goal field' using errcode='22023';end if;
 oid:=(p->>'operation_id')::uuid;ident:=(p->>'id')::uuid;
 if oid is null or ident is null then raise exception 'Operation and goal identities required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(4418,30);
 perform planning_private.goal_require_actor(expected_actor);
 select * into op from planning_private.goal_operations where operation_id=oid;
 if found then
  if op.actor_id<>expected_actor then raise exception 'Operation belongs to another account' using errcode='42501';end if;
  if op.state='cancelled' then raise exception 'Operation was cancelled before application' using errcode='22023';end if;
  if op.kind<>'save' or op.payload is distinct from p then raise exception 'Operation identity was reused with different input' using errcode='22023';end if;
  return planning_private.goal_receipt(op);
 end if;
 select * into old from public.planning_goals where id=ident for update;
 sid:=(p->>'season_id')::uuid;owner:=(p->>'owner_id')::uuid;next_id:=nullif(p->>'next_milestone_id','')::uuid;
 select * into season from public.planning_seasons where id=sid for share;
 supporters:=planning_private.goal_uuid_list(p,'supporter_ids');tasks:=planning_private.goal_uuid_list(p,'task_ids');milestones:=planning_private.goal_uuid_list(p,'milestone_ids');
 perform 1 from public.profiles where id=any(supporters||array[owner,expected_actor]) order by id for share;
 perform planning_private.goal_lock_actor(expected_actor);
 perform 1 from public.planning_tasks where id=any(tasks) order by id for share;
 perform 1 from public.planning_boards where id in (select board_id from public.planning_tasks where id=any(tasks)) order by id for share;
 perform 1 from public.planning_items where id=any(milestones) order by id for share;
 perform planning_private.goal_require_actor(expected_actor);manager:=planning_private.manager();
 if season.id is null or season.status='archived' or (not manager and season.status<>'active') then raise exception 'Season is unavailable or archived' using errcode='42501';end if;
 if old.id is null then
  if (p->>'expected_version')::integer is distinct from 0 then raise exception 'New goal requires version 0' using errcode='22023';end if;
  if not manager and (not planning_private.goal_student(expected_actor) or owner is distinct from expected_actor) then raise exception 'Students may create only self-owned goals' using errcode='42501';end if;
 else
  if not manager and (old.owner_id<>expected_actor or not planning_private.goal_student(expected_actor)) then raise exception 'Only the student owner or Planning leadership may edit this goal' using errcode='42501';end if;
  if old.version is distinct from (p->>'expected_version')::integer then raise exception 'Changed by another teammate. Refresh before saving.' using errcode='40001';end if;
  if old.season_id is distinct from sid then raise exception 'Goal season cannot change' using errcode='22023';end if;
  if old.owner_id is distinct from owner and not manager then raise exception 'Only Planning leadership can reassign goals' using errcode='42501';end if;
 end if;
 if not planning_private.goal_student(owner) then raise exception 'Choose an active student owner' using errcode='22023';end if;
 if owner=any(supporters) then raise exception 'The owner is already responsible for this goal' using errcode='22023';end if;
 if exists(select 1 from unnest(supporters) x where not planning_private.goal_contributor(x) and not exists(select 1 from public.planning_goal_supporters where goal_id=ident and user_id=x)) then raise exception 'Choose active student or leadership support members' using errcode='22023';end if;
 if exists(select 1 from unnest(tasks) x where not exists(select 1 from public.planning_tasks t join public.planning_boards b on b.id=t.board_id where t.id=x and b.active and (b.season_id=sid or b.kind='area')) and not exists(select 1 from public.planning_goal_task_links where goal_id=ident and task_id=x)) then raise exception 'Choose an active task in this season or a functional board' using errcode='22023';end if;
 if exists(select 1 from unnest(milestones) x where not exists(select 1 from public.planning_items where id=x and season_id=sid and kind='milestone' and start_date between date '0001-01-01' and date '9999-12-31' and end_date between date '0001-01-01' and date '9999-12-31') and not exists(select 1 from public.planning_goal_milestone_links where goal_id=ident and milestone_id=x and season_id=sid)) then raise exception 'Choose an available milestone in this season' using errcode='22023';end if;
 if next_id is not null and not next_id=any(milestones) then raise exception 'Next milestone must be one of the linked milestones' using errcode='22023';end if;
 if next_id is not null and next_id is distinct from old.next_milestone_id and not exists(select 1 from public.planning_items where id=next_id and season_id=sid and kind='milestone' and start_date between date '0001-01-01' and date '9999-12-31' and end_date between date '0001-01-01' and date '9999-12-31') then raise exception 'Choose an available next milestone' using errcode='22023';end if;
 if jsonb_typeof(p->'baseline') is distinct from 'number' or jsonb_typeof(p->'target') is distinct from 'number' then raise exception 'Baseline and target must be finite numbers' using errcode='22023';end if;
 val_baseline:=(p->>'baseline')::numeric;val_target:=(p->>'target')::numeric;
 if abs(val_baseline)>1e12 or abs(val_target)>1e12 then raise exception 'Baseline and target must be finite numbers within 1e12' using errcode='22023';end if;
 if old.id is not null and exists(select 1 from public.planning_goal_updates where goal_id=ident) and
 (old.baseline is distinct from val_baseline or old.target is distinct from val_target or old.unit is distinct from planning_private.goal_trim(p->>'unit') or old.direction is distinct from p->>'direction' or old.category is distinct from p->>'category' or old.fundraising_measure is distinct from p->>'fundraising_measure') then
 raise exception 'Measurement definition is locked after evidence. Create a new goal for a different measure.' using errcode='22023';end if;
 before_data:=planning_private.goal_snapshot(ident);
 insert into public.planning_goals(id,season_id,title,description,category,owner_id,baseline,target,unit,direction,deadline,fundraising_measure,next_milestone_id,created_by)
 values(ident,sid,planning_private.goal_trim(p->>'title'),coalesce(p->>'description',''),p->>'category',owner,val_baseline,val_target,planning_private.goal_trim(p->>'unit'),p->>'direction',(p->>'deadline')::date,p->>'fundraising_measure',next_id,expected_actor)
 on conflict(id) do update set title=excluded.title,description=excluded.description,category=excluded.category,owner_id=excluded.owner_id,baseline=excluded.baseline,target=excluded.target,unit=excluded.unit,direction=excluded.direction,deadline=excluded.deadline,fundraising_measure=excluded.fundraising_measure,next_milestone_id=excluded.next_milestone_id,updated_at=clock_timestamp(),version=planning_goals.version+1 returning version into revision;
 delete from public.planning_goal_supporters where goal_id=ident;
 insert into public.planning_goal_supporters select ident,x from unnest(supporters) x;
 delete from public.planning_goal_task_links where goal_id=ident;
 insert into public.planning_goal_task_links select ident,x from unnest(tasks) x;
 delete from public.planning_goal_milestone_links where goal_id=ident;
 insert into public.planning_goal_milestone_links select ident,sid,x from unnest(milestones) x;
 after_data:=planning_private.goal_snapshot(ident);
 result:=jsonb_build_object('goal_id',ident,'version',revision,'update_id',null);
 insert into planning_private.goal_operations(operation_id,actor_id,kind,payload,state,result) values(oid,expected_actor,'save',p,'committed',result) returning * into op;
 insert into planning_private.goal_history(operation_id,goal_id,actor_id,action,before_data,after_data) values(oid,ident,expected_actor,case when old.id is null then 'created' else 'edited' end,before_data,after_data);
 return planning_private.goal_receipt(op);
end $$;

create function planning_private.goal_update(p jsonb,expected_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ident uuid;oid uuid;gid uuid;g public.planning_goals;season public.planning_seasons;op planning_private.goal_operations;
 old jsonb;u public.planning_goal_updates;manager boolean;revision integer;result jsonb;measurement numeric;
begin
 perform planning_private.goal_require_actor(expected_actor);
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Goal update payload required' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('operation_id','id','goal_id','expected_version','kind','measured_value','status','evidence','evidence_url','next_step','observed_on')) then raise exception 'Unknown update field' using errcode='22023';end if;
 oid:=(p->>'operation_id')::uuid;ident:=(p->>'id')::uuid;gid:=(p->>'goal_id')::uuid;
 if oid is null or ident is null or gid is null then raise exception 'Operation, update and goal identities required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(4418,30);perform planning_private.goal_require_actor(expected_actor);
 select * into op from planning_private.goal_operations where operation_id=oid;
 if found then
  if op.actor_id<>expected_actor then raise exception 'Operation belongs to another account' using errcode='42501';end if;
  if op.state='cancelled' then raise exception 'Operation was cancelled before application' using errcode='22023';end if;
  if op.kind<>'update' or op.payload is distinct from p then raise exception 'Operation identity was reused with different input' using errcode='22023';end if;
  return planning_private.goal_receipt(op);
 end if;
 select * into g from public.planning_goals where id=gid for update;
 select * into season from public.planning_seasons where id=g.season_id for share;
 perform planning_private.goal_lock_actor(expected_actor);
 perform planning_private.goal_require_actor(expected_actor);manager:=planning_private.manager();
 if g.id is null or season.status='archived' or (not manager and season.status<>'active') then raise exception 'Goal is unavailable or archived' using errcode='42501';end if;
 if not manager and not (g.owner_id=expected_actor and planning_private.goal_student(expected_actor)) and not (planning_private.goal_contributor(expected_actor) and exists(select 1 from public.planning_goal_supporters where goal_id=gid and user_id=expected_actor)) then raise exception 'Only the student owner, named supporters or Planning leadership may add evidence' using errcode='42501';end if;
 if g.version is distinct from (p->>'expected_version')::integer then raise exception 'Changed by another teammate. Refresh before saving.' using errcode='40001';end if;
 if (p->>'observed_on')::date>current_date then raise exception 'Evidence date cannot be in the future' using errcode='22023';end if;
 if p->>'kind'='measurement' then
  if jsonb_typeof(p->'measured_value') is distinct from 'number' then raise exception 'Measurement must be a finite number' using errcode='22023';end if;
  measurement:=(p->>'measured_value')::numeric;
 elsif p->'measured_value' is distinct from 'null'::jsonb then raise exception 'Weekly updates do not contain a measurement' using errcode='22023';end if;
 old:=planning_private.goal_snapshot(gid);
 update public.planning_goals set version=version+1,updated_at=clock_timestamp() where id=gid returning version into revision;
 insert into public.planning_goal_updates(id,goal_id,kind,measured_value,status,evidence,evidence_url,next_step,observed_on,author_id,goal_version)
 values(ident,gid,p->>'kind',measurement,p->>'status',planning_private.goal_trim(p->>'evidence'),nullif(planning_private.goal_trim(p->>'evidence_url'),''),planning_private.goal_trim(p->>'next_step'),(p->>'observed_on')::date,expected_actor,revision) returning * into u;
 result:=jsonb_build_object('goal_id',gid,'version',revision,'update_id',ident);
 insert into planning_private.goal_operations(operation_id,actor_id,kind,payload,state,result) values(oid,expected_actor,'update',p,'committed',result) returning * into op;
 insert into planning_private.goal_history(operation_id,goal_id,actor_id,action,before_data,after_data) values(oid,gid,expected_actor,u.kind,old,jsonb_build_object('goal',planning_private.goal_snapshot(gid),'update',to_jsonb(u)));
 return planning_private.goal_receipt(op);
end $$;

create function planning_private.goal_operation(operation_id uuid,expected_actor uuid,cancel boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare op planning_private.goal_operations;
begin
 perform planning_private.goal_require_actor(expected_actor);
 if operation_id is null then raise exception 'Operation identity required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(4418,30);
 perform planning_private.goal_lock_actor(expected_actor);perform planning_private.goal_require_actor(expected_actor);
 select * into op from planning_private.goal_operations o where o.operation_id=goal_operation.operation_id;
 if found then
  if op.actor_id<>expected_actor then raise exception 'Operation belongs to another account' using errcode='42501';end if;
  return planning_private.goal_receipt(op);
 end if;
 if cancel then
  insert into planning_private.goal_operations(operation_id,actor_id,state) values(operation_id,expected_actor,'cancelled') returning * into op;
  return planning_private.goal_receipt(op);
 end if;
 return jsonb_build_object('status','not_found','operation_id',operation_id,'result',null);
end $$;

-- Public invoker shims expose only guarded entry points. No tables or general helpers
-- are exposed; planning_private is not an API schema.
create function public.planning_goals_context(selected_season uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select planning_private.goals_context(selected_season)$$;
create function public.planning_goal_save(p jsonb,expected_actor uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select planning_private.goal_save(p,expected_actor)$$;
create function public.planning_goal_update(p jsonb,expected_actor uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select planning_private.goal_update(p,expected_actor)$$;
create function public.planning_goal_operation_status(operation_id uuid,expected_actor uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select planning_private.goal_operation(operation_id,expected_actor,false)$$;
create function public.planning_goal_operation_cancel(operation_id uuid,expected_actor uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select planning_private.goal_operation(operation_id,expected_actor,true)$$;

alter table public.planning_goals enable row level security;
alter table public.planning_goal_supporters enable row level security;
alter table public.planning_goal_updates enable row level security;
alter table public.planning_goal_task_links enable row level security;
alter table public.planning_goal_milestone_links enable row level security;
alter table planning_private.goal_operations enable row level security;
alter table planning_private.goal_history enable row level security;
revoke all on public.planning_goals,public.planning_goal_supporters,public.planning_goal_updates,public.planning_goal_task_links,public.planning_goal_milestone_links,planning_private.goal_operations,planning_private.goal_history from public,anon,authenticated,service_role;
revoke all on sequence planning_private.goal_history_id_seq from public,anon,authenticated,service_role;
revoke all on function planning_private.goal_trim(text),planning_private.goal_immutable(),planning_private.goal_require_actor(uuid),planning_private.goal_student(uuid),planning_private.goal_contributor(uuid),planning_private.goal_person(uuid),planning_private.goal_snapshot(uuid),planning_private.goal_uuid_list(jsonb,text),planning_private.goal_lock_actor(uuid),planning_private.goal_receipt(planning_private.goal_operations),planning_private.goals_context(uuid),planning_private.goal_save(jsonb,uuid),planning_private.goal_update(jsonb,uuid),planning_private.goal_operation(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.planning_goals_context(uuid),public.planning_goal_save(jsonb,uuid),public.planning_goal_update(jsonb,uuid),public.planning_goal_operation_status(uuid,uuid),public.planning_goal_operation_cancel(uuid,uuid) from public,anon,authenticated,service_role;
grant usage on schema planning_private to authenticated;
grant execute on function planning_private.goals_context(uuid),planning_private.goal_save(jsonb,uuid),planning_private.goal_update(jsonb,uuid),planning_private.goal_operation(uuid,uuid,boolean) to authenticated;
grant execute on function public.planning_goals_context(uuid),public.planning_goal_save(jsonb,uuid),public.planning_goal_update(jsonb,uuid),public.planning_goal_operation_status(uuid,uuid),public.planning_goal_operation_cancel(uuid,uuid) to authenticated;
commit;
