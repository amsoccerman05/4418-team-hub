begin;
-- Protected against duplicate execution; the entire upgrade is one transaction.
create table if not exists private.inventory_schema_versions(version integer primary key);
do $$ begin if exists(select 1 from private.inventory_schema_versions where version=4) then raise exception 'Inventory migration 004 already applied; do not rerun';end if;end $$;
lock table public.inventory_items,public.locations in access exclusive mode;
create table public.trips (
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name))>0),event_name text not null default '',destination text not null default '',
 start_date date,end_date date,status text not null default 'planning' check(status in ('planning','packing','in_transit','at_event','returning','closed','cancelled')),
 notes text not null default '',created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(end_date is null or start_date is null or end_date>=start_date)
);
alter table public.locations add column classification text not null default 'permanent' check(classification in ('permanent','project','robot','travel','temporary','checkout','other')),
 add column area_id uuid references public.areas(id),add column trip_id uuid references public.trips(id);
-- Unassigned counts become an explicit physical-accounting balance; no items are dropped.
insert into public.locations(id,name,code,location_type,description) values('44180000-0000-4000-8000-000000000099','Unassigned','UNASSIGNED','Storage','Existing counts without a configured home. Assign a home before auditing.');
alter table public.inventory_items disable trigger guard_inventory_item;
alter table public.inventory_items disable trigger log_inventory_item;
update public.inventory_items set location_id='44180000-0000-4000-8000-000000000099' where location_id is null;
alter table public.inventory_items enable trigger guard_inventory_item;
alter table public.inventory_items enable trigger log_inventory_item;
create table public.inventory_balances (
 id uuid primary key default gen_random_uuid(),inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,quantity numeric not null default 0 check(quantity>=0 and quantity<'Infinity'::numeric),
 last_verified_at timestamptz,last_verified_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(inventory_item_id,location_id)
);
insert into public.inventory_balances(inventory_item_id,location_id,quantity,last_verified_at,last_verified_by)
 select id,location_id,quantity,last_verified_at,last_verified_by from public.inventory_items;
create table public.trip_manifest_items (
 id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.trips(id),inventory_item_id uuid not null references public.inventory_items(id),
 quantity numeric not null check(quantity>0 and quantity<'Infinity'::numeric),home_location_id uuid not null references public.locations(id),current_location_id uuid not null references public.locations(id),
 ownership text not null, status text not null check(status in ('approved','packed','returned','resolved')),resolution text not null default '',notes text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(),inventory_item_id uuid references public.inventory_items(id) on delete set null,item_name text not null,
 quantity numeric not null check(quantity>=0 and quantity<'Infinity'::numeric),from_location_id uuid references public.locations(id),to_location_id uuid references public.locations(id),trip_id uuid references public.trips(id),
 movement_type text not null check(movement_type in ('transfer','trip_pack','trip_internal_move','trip_return','adjustment','resolution')),user_id uuid references auth.users(id),note text not null default '',created_at timestamptz not null default now()
);
create table public.inventory_media (
 id uuid primary key default gen_random_uuid(),entity_type text not null check(entity_type in ('items','locations')),entity_id uuid not null,
 path text not null unique,alt_text text not null default '',updated_at timestamptz not null default now(),unique(entity_type,entity_id)
);
create index balances_location_idx on public.inventory_balances(location_id);
create index manifest_trip_idx on public.trip_manifest_items(trip_id);
create index movements_item_idx on public.inventory_movements(inventory_item_id,created_at desc);
create index movements_trip_idx on public.inventory_movements(trip_id,created_at desc);
create index locations_trip_idx on public.locations(trip_id);
-- All balance and manifest writes go through checked transactions, including for admins.
do $$ declare t text;begin
 foreach t in array array['trips','inventory_balances','trip_manifest_items','inventory_movements','inventory_media'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy team_read on public.%I for select to authenticated using(private.current_role() is not null)',t);
 end loop;
end $$;
-- Archived locations remain readable so history and references never disappear.
drop policy locations_read on public.locations;
create policy locations_read on public.locations for select to authenticated using(private.current_role() is not null);

create function private.balance_set(i uuid,l uuid,q numeric) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(l::text,4418));
 insert into public.inventory_balances(inventory_item_id,location_id,quantity) values(i,l,q)
 on conflict(inventory_item_id,location_id) do update set quantity=excluded.quantity,updated_at=clock_timestamp();
end $$;
create function private.balance_sync(i uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform set_config('app.balance_sync','yes',true);
 update public.inventory_items set quantity=(select coalesce(sum(quantity),0) from public.inventory_balances where inventory_item_id=i) where id=i;
 perform set_config('app.balance_sync','',true);
end $$;
-- Compatibility bridge: item quantity is a derived total; old clients can adjust the home balance.
-- Moving home metadata is only compatible when all stock is still at that home.
create function private.bridge_item_balance() returns trigger language plpgsql security definer set search_path='' as $$
declare home uuid;present numeric; delta numeric;
begin
 if current_setting('app.balance_sync',true)='yes' then return null;end if;
 home:=coalesce(new.location_id,'44180000-0000-4000-8000-000000000099');
 if exists(select 1 from public.locations where id=home and (not active or trip_id is not null)) then raise exception 'Choose an active non-travel home location';end if;
 if tg_op='INSERT' then perform private.balance_set(new.id,home,new.quantity);
 else
  if new.location_id is distinct from old.location_id then
   if exists(select 1 from public.inventory_balances where inventory_item_id=new.id and location_id<>coalesce(old.location_id,'44180000-0000-4000-8000-000000000099') and quantity>0) then raise exception 'Return or move allocated stock before changing its home location';end if;
   perform private.balance_set(new.id,coalesce(old.location_id,'44180000-0000-4000-8000-000000000099'),0);
   perform private.balance_set(new.id,home,old.quantity);
   insert into public.inventory_movements(inventory_item_id,item_name,quantity,from_location_id,to_location_id,movement_type,user_id,note) values(new.id,new.name,old.quantity,old.location_id,home,'transfer',auth.uid(),'Home location changed');
  end if;
  delta:=new.quantity-old.quantity;
  if delta<>0 then
   select coalesce(sum(quantity),0) into present from public.inventory_balances where inventory_item_id=new.id and location_id=home;
   if present+delta<0 then raise exception 'This total would remove stock held elsewhere. Correct the specific location instead.';end if;
   perform private.balance_set(new.id,home,present+delta);
   insert into public.inventory_movements(inventory_item_id,item_name,quantity,from_location_id,to_location_id,movement_type,user_id,note) values(new.id,new.name,abs(delta),case when delta<0 then home end,case when delta>0 then home end,'adjustment',auth.uid(),'Home quantity correction');
  end if;
 end if;
 if tg_op='INSERT' or new.last_verified_at is distinct from old.last_verified_at then
  update public.inventory_balances set last_verified_at=new.last_verified_at,last_verified_by=new.last_verified_by,updated_at=clock_timestamp() where inventory_item_id=new.id and location_id=home;
 end if;
 return null;
end $$;
create trigger bridge_item_balance after insert or update on public.inventory_items for each row execute function private.bridge_item_balance();
-- New location metadata is restricted even when directly edited through REST.
create function private.guard_location_v2() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.trip_id is distinct from old.trip_id or (old.trip_id is not null and (new.active is distinct from old.active or new.parent_id is distinct from old.parent_id))) then
  if current_setting('app.trip_write',true)<>'yes' or current_setting('app.trip_write',true) is null then raise exception 'Manage travel locations through the trip workflow';end if;
 end if;
 if not new.active and exists(select 1 from public.inventory_balances where location_id=new.id and quantity>0) then raise exception 'Move remaining stock before archiving a location';end if;
 if new.trip_id is not null and new.classification<>'travel' then raise exception 'Trip locations must be travel locations';end if;
 return new;
end $$;
create trigger guard_location_v2 before insert or update on public.locations for each row execute function private.guard_location_v2();

-- One RPC owns accounting, provenance and trip lifecycle. Row locks serialize all moves per item.
create function public.inventory_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); i public.inventory_items; t public.trips; m public.trip_manifest_items; source public.locations; dest public.locations;
 iid uuid;tid uuid;src uuid;dst uuid;mid uuid; qty numeric;have numeric;other numeric;new_id uuid;note text:=coalesce(p_data->>'note','');action_type text;new_status text;part record;oldqty numeric;
begin
 if not private.can_count() then raise exception 'You do not have permission for this action' using errcode='42501';end if;
 if p_action='create_trip' then
  if not private.is_admin() then raise exception 'Only admins and mentors create trips' using errcode='42501';end if;
  insert into public.trips(name,event_name,destination,start_date,end_date,notes,created_by) values(trim(p_data->>'name'),coalesce(p_data->>'event',''),coalesce(p_data->>'destination',''),nullif(p_data->>'start','')::date,nullif(p_data->>'end','')::date,note,actor) returning id into tid;
  insert into public.locations(name,code,location_type,classification,trip_id) values(p_data->>'name',p_data->>'name','Storage','travel',tid) returning id into src;
  foreach action_type in array array['Trailer','Pit Toolbox A','Pit Toolbox B','Robot Cart','Programming Case','Battery Cart'] loop
   insert into public.locations(name,code,location_type,parent_id,classification,trip_id) values(action_type,action_type,'Storage',src,'travel',tid);
  end loop;return jsonb_build_object('id',tid);
 end if;
 tid:=nullif(p_data->>'tripId','')::uuid;mid:=nullif(p_data->>'manifestId','')::uuid;
 if mid is not null then select trip_id into strict tid from public.trip_manifest_items where id=mid;end if;
 if tid is not null then
  select * into strict t from public.trips where id=tid for update;
  if t.status in ('closed','cancelled') then raise exception 'This trip is archived';end if;
 end if;
 if p_action='trip_status' then
  if not private.is_admin() then raise exception 'Only admins and mentors manage trips' using errcode='42501';end if;
  new_status:=p_data->>'status';
  if new_status in ('closed','cancelled') then
   if exists(select 1 from public.trip_manifest_items where trip_id=tid and status in ('approved','packed')) then raise exception 'Unresolved manifest items remain. Return them or explicitly resolve each item first.';end if;
   if exists(select 1 from public.inventory_balances b join public.locations l on l.id=b.location_id where l.trip_id=tid and b.quantity>0) then raise exception 'Travel locations still contain stock';end if;
   perform set_config('app.trip_write','yes',true);update public.locations set active=false where trip_id=tid;perform set_config('app.trip_write','',true);
  end if;
  update public.trips set status=new_status,updated_at=clock_timestamp(),notes=notes||case when note<>'' then E'\n'||note else '' end where id=tid;
  insert into public.inventory_movements(item_name,quantity,trip_id,movement_type,user_id,note) values(t.name,0,tid,'resolution',actor,'Trip status: '||new_status||'. '||note);
  return '{}'::jsonb;
 end if;
 if p_action='create_location' then
  if not(private.is_admin() or private.current_role()='lead') then raise exception 'Only leads, admins and mentors manage locations' using errcode='42501';end if;
  if not private.is_admin() and (coalesce(p_data->>'classification','project')<>'project' or tid is not null) then raise exception 'Leads can create project locations in their assigned area';end if;
  if private.current_role()='lead' and private.current_area() is null then raise exception 'Assign a lead area first';end if;
  insert into public.locations(name,code,location_type,classification,area_id,description) values(trim(p_data->>'name'),trim(p_data->>'name'),'Storage',coalesce(p_data->>'classification','project'),case when private.is_admin() then nullif(p_data->>'areaId','')::uuid else private.current_area() end,note) returning id into new_id;
  return jsonb_build_object('id',new_id);
 end if;
 if p_action in ('pack','internal','return','resolve') and mid is null then raise exception 'An approved manifest allocation is required';end if;
 iid:=nullif(p_data->>'itemId','')::uuid;
 if mid is not null then select * into strict m from public.trip_manifest_items where id=mid for update;iid:=m.inventory_item_id;end if;
 select * into strict i from public.inventory_items where id=iid for update;
 qty:=(p_data->>'quantity')::numeric;src:=nullif(p_data->>'from','')::uuid;dst:=nullif(p_data->>'to','')::uuid;
 if mid is not null then src:=case when m.status='approved' then m.home_location_id else m.current_location_id end;end if;
 if p_action='return' then dst:=m.home_location_id;end if;
 if p_action='pack' then dst:=m.current_location_id;end if;
 if p_action in ('approve','pack','internal','return','resolve') and tid is null then raise exception 'A trip is required';end if;
 if p_action in ('pack','internal','return') and t.status='planning' then raise exception 'Start packing before moving trip inventory';end if;
 if p_action='approve' then
  if not(private.is_admin() or private.current_role()='lead') then raise exception 'A lead, admin or mentor must approve manifest items' using errcode='42501';end if;
  if t.status not in ('planning','packing') then raise exception 'Approve items during planning or packing';end if;
 end if;
 if p_action='resolve' then
  if not private.is_admin() or trim(note)='' then raise exception 'A mentor/admin and a resolution note are required';end if;
  if m.status not in ('approved','packed') then raise exception 'This allocation is already resolved';end if;
  if m.status='approved' then
   if qty is null or qty<=0 or qty>m.quantity then raise exception 'Quantity exceeds this approval';end if;
   if qty<m.quantity then
    update public.trip_manifest_items set quantity=quantity-qty,updated_at=clock_timestamp() where id=mid;
    insert into public.trip_manifest_items(trip_id,inventory_item_id,quantity,home_location_id,current_location_id,ownership,status,resolution,notes) values(tid,i.id,qty,m.home_location_id,m.current_location_id,m.ownership,'resolved','Not packed: '||note,m.notes);
   else update public.trip_manifest_items set status='resolved',resolution='Not packed: '||note,updated_at=clock_timestamp() where id=mid;end if;
   insert into public.inventory_movements(inventory_item_id,item_name,quantity,trip_id,movement_type,user_id,note) values(i.id,i.name,0,tid,'resolution',actor,'Unpacked approval resolved: '||note);return '{}'::jsonb;
  end if;
  if p_data->>'resolution' not in ('lost','consumed','transferred','manual') then raise exception 'Choose a resolution';end if;
  if p_data->>'resolution' in ('lost','consumed') then dst:=null;elsif dst is null then raise exception 'Select the actual non-travel destination';end if;
 end if;
 select coalesce(sum(quantity),0) into have from public.inventory_balances where inventory_item_id=i.id and location_id=src;
 if p_action='adjust' and p_data->>'delta' is not null then qty:=greatest(0,have+(p_data->>'delta')::numeric);end if;
 if p_action='adjust' then
  if qty is null or qty<0 or qty>='Infinity'::numeric then raise exception 'Enter a finite nonnegative count';end if;
 else
  if qty is null or qty<=0 or qty>='Infinity'::numeric then raise exception 'Enter a finite quantity greater than zero';end if;
 end if;
 select * into strict source from public.locations where id=src and active for share;
 if dst is not null then select * into strict dest from public.locations where id=dst and active for share;end if;
 if p_action in ('move','adjust') and (source.trip_id is not null or dest.trip_id is not null) then raise exception 'Use the trip manifest for travel inventory';end if;
 if p_action='approve' and (source.trip_id is not null or dest.trip_id is distinct from tid) then raise exception 'Choose a non-travel home and a location in this trip';end if;
 if p_action in ('pack','internal') and dest.trip_id is distinct from tid then raise exception 'Destination must belong to this trip';end if;
 if p_action in ('internal','return','resolve') and source.trip_id is distinct from tid then raise exception 'Source must belong to this trip';end if;
 if p_action='resolve' and dst is not null and dest.trip_id is not null then raise exception 'Resolve to a non-travel location';end if;
 if p_action='approve' then
  insert into public.trip_manifest_items(trip_id,inventory_item_id,quantity,home_location_id,current_location_id,ownership,status,notes) values(tid,i.id,qty,src,dst,i.ownership,'approved',note) returning id into new_id;
  insert into public.inventory_movements(inventory_item_id,item_name,quantity,trip_id,movement_type,user_id,note) values(i.id,i.name,0,tid,'resolution',actor,'Approved '||qty||' for packing. '||note);return jsonb_build_object('id',new_id);
 end if;
 select coalesce(sum(quantity),0) into have from public.inventory_balances where inventory_item_id=i.id and location_id=src;
 if p_action='adjust' then
  if p_data->>'delta' is null and i.updated_at is distinct from (p_data->>'updatedAt')::timestamptz then raise exception 'Item changed. Review the latest counts before correcting.' using errcode='40001';end if;
  perform private.balance_set(i.id,src,qty);
  insert into public.inventory_movements(inventory_item_id,item_name,quantity,from_location_id,to_location_id,movement_type,user_id,note) values(i.id,i.name,abs(qty-have),case when qty<have then src end,case when qty>have then src end,'adjustment',actor,note);
  if coalesce((p_data->>'verify')::boolean,false) then update public.inventory_balances set last_verified_at=clock_timestamp(),last_verified_by=actor where inventory_item_id=i.id and location_id=src;end if;
  perform private.balance_sync(i.id);
  if coalesce((p_data->>'verify')::boolean,false) then
   if i.location_id is distinct from src then insert into public.inventory_events(inventory_item_id,item_name,area_id,user_id,event_type,notes) values(i.id,i.name,i.area_id,actor,'item_verified',src::text);end if;
   if i.location_id=src then perform set_config('app.balance_sync','yes',true);update public.inventory_items set last_verified_at=clock_timestamp() where id=i.id;perform set_config('app.balance_sync','',true);end if;
  end if;
  return jsonb_build_object('before',have,'quantity',qty,'item',(select to_jsonb(x) from public.inventory_items x where id=i.id));
 end if;
 if dst is null and p_action<>'resolve' then raise exception 'A destination is required';end if;
 if src=dst then raise exception 'Source and destination must differ';end if;
 if qty>have then raise exception 'Not enough quantity at the source';end if;
 if p_action in ('pack','internal','return','resolve') then
  if (p_action='pack' and m.status<>'approved') or (p_action<>'pack' and m.status<>'packed') or qty>m.quantity then raise exception 'Allocation changed or quantity exceeds this manifest allocation';end if;
  new_status:=case when p_action='return' then 'returned' when p_action='resolve' then 'resolved' else 'packed' end;
  if qty<m.quantity then
   update public.trip_manifest_items set quantity=quantity-qty,updated_at=clock_timestamp() where id=mid;
   insert into public.trip_manifest_items(trip_id,inventory_item_id,quantity,home_location_id,current_location_id,ownership,status,resolution,notes) values(tid,i.id,qty,m.home_location_id,coalesce(dst,src),m.ownership,new_status,case when p_action='resolve' then (p_data->>'resolution')||': '||note else '' end,m.notes);
  else update public.trip_manifest_items set current_location_id=coalesce(dst,src),status=new_status,resolution=case when p_action='resolve' then (p_data->>'resolution')||': '||note else '' end,updated_at=clock_timestamp() where id=mid;end if;
 end if;
 action_type:=case p_action when 'move' then 'transfer' when 'pack' then 'trip_pack' when 'internal' then 'trip_internal_move' when 'return' then 'trip_return' when 'resolve' then 'resolution' else null end;
 if action_type is null then raise exception 'Unknown inventory action';end if;
 perform private.balance_set(i.id,src,have-qty);
 if dst is not null then
  select coalesce(sum(quantity),0) into other from public.inventory_balances where inventory_item_id=i.id and location_id=dst;perform private.balance_set(i.id,dst,other+qty);
 end if;
 insert into public.inventory_movements(inventory_item_id,item_name,quantity,from_location_id,to_location_id,trip_id,movement_type,user_id,note) values(i.id,i.name,qty,src,dst,tid,action_type,actor,case when p_action='resolve' then (p_data->>'resolution')||': ' else '' end||note);
 perform private.balance_sync(i.id);
 return '{}'::jsonb;
end $$;
revoke all on function public.inventory_action(text,jsonb) from public,anon;
grant execute on function public.inventory_action(text,jsonb) to authenticated;
revoke all on all functions in schema private from public;

-- Batch drawer verification covers every home expectation and every balance actually here.
create function public.verify_balance_location(p_location uuid,p_expected jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r record;expected_count integer;
begin
 if not private.can_count() then raise exception 'No audit permission' using errcode='42501';end if;
 if not exists(select 1 from public.locations where id=p_location and active) then raise exception 'Location is archived';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_location::text,4418));
 perform 1 from public.inventory_items where location_id=p_location or id in(select inventory_item_id from public.inventory_balances where location_id=p_location and quantity>0) order by id for update;
 select count(*) into expected_count from public.inventory_items where location_id=p_location or id in(select inventory_item_id from public.inventory_balances where location_id=p_location and quantity>0);
 if expected_count<>jsonb_array_length(p_expected) then raise exception 'Location contents changed. Review again.';end if;
 for r in select * from public.inventory_items where location_id=p_location or id in(select inventory_item_id from public.inventory_balances where location_id=p_location and quantity>0) loop
  if not exists(select 1 from jsonb_array_elements(p_expected) e where e->>'id'=r.id::text and (e->>'updated_at')::timestamptz=r.updated_at) then raise exception 'Location contents changed. Review again.';end if;
  insert into public.inventory_balances(inventory_item_id,location_id,quantity) values(r.id,p_location,0) on conflict do nothing;
  update public.inventory_balances set last_verified_at=clock_timestamp(),last_verified_by=auth.uid(),updated_at=clock_timestamp() where inventory_item_id=r.id and location_id=p_location;
  perform set_config('app.balance_sync','yes',true);
  perform set_config('app.drawer_audit','yes',true);
  update public.inventory_items set last_verified_at=case when location_id=p_location then clock_timestamp() else last_verified_at end where id=r.id;
  perform set_config('app.drawer_audit','',true);
  perform set_config('app.balance_sync','',true);
  if r.location_id is distinct from p_location then insert into public.inventory_events(inventory_item_id,item_name,area_id,user_id,event_type,notes) values(r.id,r.name,r.area_id,auth.uid(),'drawer_verified',p_location::text);end if;
 end loop;
end $$;
revoke all on function public.verify_balance_location(uuid,jsonb) from public,anon;
grant execute on function public.verify_balance_location(uuid,jsonb) to authenticated;
-- Capability probe lets the existing UI remain usable until the owner installs this migration.
create function public.inventory_features() returns integer language sql stable as $$select 4$$;
revoke all on function public.inventory_features() from public,anon;grant execute on function public.inventory_features() to authenticated;
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.inventory_balances,public.inventory_movements,public.trip_manifest_items,public.trips,public.inventory_media;end if;end $$;
create or replace function public.apply_inventory_changes(p_changes jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r jsonb; payload jsonb; existing public.inventory_items; value public.inventory_items;
begin
 for r in select * from jsonb_array_elements(coalesce(p_changes->'areas','[]')) loop
  payload:=r->'record';
  insert into public.areas(id,slug,name,lead_name,active) values((payload->>'id')::uuid,payload->>'slug',payload->>'name',coalesce(payload->>'lead_name',''),true)
  on conflict(id) do update set name=excluded.name,lead_name=excluded.lead_name,updated_at=clock_timestamp();
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'locations','[]')) loop
  payload:=r->'record';
  insert into public.locations(id,name,code,parent_id,location_type,description,room,storage,classification,area_id) values((payload->>'id')::uuid,payload->>'name',payload->>'code',(payload->>'parent_id')::uuid,payload->>'location_type',payload->>'description',coalesce(payload->>'room',''),coalesce(payload->>'storage',''),coalesce(payload->>'classification','permanent'),nullif(payload->>'area_id','')::uuid)
  on conflict(id) do update set name=excluded.name,code=excluded.code,parent_id=excluded.parent_id,location_type=excluded.location_type,description=excluded.description,room=excluded.room,storage=excluded.storage,classification=excluded.classification,area_id=excluded.area_id;
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'categories','[]')) loop
  insert into public.categories(name) values(r#>>'{}') on conflict do nothing;
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'items','[]')) loop
  payload:=r->'record';
  select * into existing from public.inventory_items where id=(payload->>'id')::uuid for update;
  if found then
   if r->>'expected_updated_at' is null or existing.updated_at<>(r->>'expected_updated_at')::timestamptz then raise exception 'An item changed on another device. Refresh and retry.' using errcode='40001';end if;
   value:=jsonb_populate_record(existing,payload);
   update public.inventory_items set name=value.name,item_type=value.item_type,ownership=value.ownership,area_id=value.area_id,category=value.category,quantity=value.quantity,expected_quantity=value.expected_quantity,minimum_quantity=value.minimum_quantity,target_quantity=value.target_quantity,unit=value.unit,location_id=value.location_id,slot_position=value.slot_position,manufacturer=value.manufacturer,manufacturer_part_number=value.manufacturer_part_number,vendor=value.vendor,vendor_url=value.vendor_url,approx_unit_cost=value.approx_unit_cost,notes=value.notes,last_verified_at=value.last_verified_at,legacy_updated_by=value.legacy_updated_by,order_status=value.order_status,tracking_mode=value.tracking_mode where id=existing.id;
  else
   if r->>'expected_updated_at' is not null then raise exception 'An item was removed on another device. Refresh and retry.' using errcode='40001';end if;
   value:=jsonb_populate_record(null::public.inventory_items,payload);
   insert into public.inventory_items(id,name,item_type,ownership,area_id,category,quantity,expected_quantity,minimum_quantity,target_quantity,unit,location_id,slot_position,manufacturer,manufacturer_part_number,vendor,vendor_url,approx_unit_cost,notes,last_verified_at,legacy_updated_by,order_status,tracking_mode)
   values(value.id,value.name,value.item_type,value.ownership,value.area_id,value.category,value.quantity,value.expected_quantity,value.minimum_quantity,value.target_quantity,value.unit,value.location_id,value.slot_position,value.manufacturer,value.manufacturer_part_number,value.vendor,value.vendor_url,value.approx_unit_cost,value.notes,value.last_verified_at,value.legacy_updated_by,value.order_status,value.tracking_mode);
  end if;
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'deleted_items','[]')) loop
  select * into existing from public.inventory_items where id=(r->>'id')::uuid for update;
  if not found or r->>'updated_at' is null or existing.updated_at<>(r->>'updated_at')::timestamptz then raise exception 'An item changed on another device. Refresh and retry.' using errcode='40001';end if;
  delete from public.inventory_items where id=existing.id;
 end loop;
end $$;
insert into private.inventory_schema_versions values(4);
commit;
