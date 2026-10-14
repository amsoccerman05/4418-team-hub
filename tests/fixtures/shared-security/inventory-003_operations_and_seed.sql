begin;
create function public.change_inventory_quantity(p_id uuid, p_delta numeric default null, p_quantity numeric default null, p_expected_updated_at timestamptz default null, p_verify boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_item public.inventory_items; saved public.inventory_items; amount numeric;
begin
 if not private.can_count() then raise exception 'You do not have permission to change quantities' using errcode='42501';end if;
 if (p_delta is null)=(p_quantity is null) then raise exception 'Provide a delta or an absolute quantity';end if;
 select * into strict current_item from public.inventory_items where id=p_id for update;
 if p_delta is null and (p_expected_updated_at is null or current_item.updated_at<>p_expected_updated_at) then raise exception 'This item changed on another device. Refresh and try again.' using errcode='40001';end if;
 amount:=case when p_delta is null then p_quantity else greatest(0,current_item.quantity+p_delta) end;
 update public.inventory_items set quantity=amount,last_verified_at=case when p_verify then clock_timestamp() else last_verified_at end where id=p_id returning * into saved;
 return jsonb_build_object('before',current_item.quantity,'item',to_jsonb(saved));
end $$;

create function public.verify_inventory_drawer(p_location_id uuid,p_expected jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare item public.inventory_items;
begin
 if not private.can_count() then raise exception 'You do not have permission to audit drawers' using errcode='42501';end if;
 if not exists(select 1 from public.locations where id=p_location_id and location_type='Drawer') then raise exception 'Select a drawer location';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_location_id::text,4418));
 -- Lock existing rows and reject unseen changes rather than verifying a stale screen.
 perform 1 from public.inventory_items where location_id=p_location_id order by id for update;
 if (select count(*) from public.inventory_items where location_id=p_location_id)<>jsonb_array_length(p_expected) then raise exception 'Drawer contents changed. Review the latest counts before verifying.' using errcode='40001';end if;
 for item in select * from public.inventory_items where location_id=p_location_id loop
  if not exists(select 1 from jsonb_array_elements(p_expected) e where (e->>'id')::uuid=item.id and (e->>'updated_at')::timestamptz=item.updated_at) then raise exception 'Drawer contents changed. Review the latest counts before verifying.' using errcode='40001';end if;
 end loop;
 perform set_config('app.drawer_audit','yes',true);
 update public.inventory_items set last_verified_at=clock_timestamp() where location_id=p_location_id;
 perform set_config('app.drawer_audit','',true);
end $$;

-- The entire patch (including imports/migrations) commits or rolls back together.
-- Runs as the caller: every table operation is subject to RLS and guard triggers.
create function public.apply_inventory_changes(p_changes jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r jsonb; payload jsonb; existing public.inventory_items; value public.inventory_items;
begin
 for r in select * from jsonb_array_elements(coalesce(p_changes->'areas','[]')) loop
  payload:=r->'record';
  insert into public.areas(id,slug,name,lead_name,active) values((payload->>'id')::uuid,payload->>'slug',payload->>'name',coalesce(payload->>'lead_name',''),true)
  on conflict(id) do update set name=excluded.name,lead_name=excluded.lead_name,updated_at=clock_timestamp();
 end loop;
 for r in select * from jsonb_array_elements(coalesce(p_changes->'locations','[]')) loop
  payload:=r->'record';
  insert into public.locations(id,name,code,parent_id,location_type,description,room,storage) values((payload->>'id')::uuid,payload->>'name',payload->>'code',(payload->>'parent_id')::uuid,payload->>'location_type',payload->>'description',coalesce(payload->>'room',''),coalesce(payload->>'storage',''))
  on conflict(id) do update set name=excluded.name,code=excluded.code,parent_id=excluded.parent_id,location_type=excluded.location_type,description=excluded.description,room=excluded.room,storage=excluded.storage;
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
revoke all on function public.change_inventory_quantity(uuid,numeric,numeric,timestamptz,boolean),public.verify_inventory_drawer(uuid,jsonb),public.apply_inventory_changes(jsonb) from public,anon;
grant execute on function public.change_inventory_quantity(uuid,numeric,numeric,timestamptz,boolean),public.verify_inventory_drawer(uuid,jsonb),public.apply_inventory_changes(jsonb) to authenticated;
-- Trigger functions are not RPCs and must not be callable as public API functions.
revoke all on all functions in schema private from public;

insert into public.areas(id,slug,name) values
 ('44180000-0000-4000-8000-000000000001','fabrication','Fabrication'),
 ('44180000-0000-4000-8000-000000000002','power','Power'),
 ('44180000-0000-4000-8000-000000000003','software','Software'),
 ('44180000-0000-4000-8000-000000000004','operations','Operations'),
 ('44180000-0000-4000-8000-000000000005','cad','CAD'),
 ('44180000-0000-4000-8000-000000000006','strategy','Strategy'),
 ('44180000-0000-4000-8000-000000000007','finance','Finance'),
 ('44180000-0000-4000-8000-000000000008','business','Business'),
 ('44180000-0000-4000-8000-000000000009','communications','Communications'),
 ('44180000-0000-4000-8000-000000000010','general-admin','General / Admin') on conflict(slug) do nothing;
-- No demo inventory is seeded. Realtime publication may not exist in local SQL tests.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.inventory_items,public.locations,public.inventory_events,public.profiles,public.areas;
 end if;
end $$;
commit;
