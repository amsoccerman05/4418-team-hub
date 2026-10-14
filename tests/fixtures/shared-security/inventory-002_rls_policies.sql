begin;
create function private.current_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=(select auth.uid()) and active
$$;
create function private.current_area() returns uuid language sql stable security definer set search_path='' as $$
 select primary_area_id from public.profiles where id=(select auth.uid()) and active
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.current_role() in ('admin','mentor'),false)
$$;
create function private.can_count() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.current_role() in ('student','lead','admin','mentor'),false)
$$;
create function private.can_edit(area uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_admin() or (private.current_role()='lead' and area=private.current_area())
$$;
-- Helpers live outside the exposed API schema, with fixed search paths and no role argument.
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.current_role(),private.current_area(),private.is_admin(),private.can_count(),private.can_edit(uuid) to authenticated;

alter table public.areas enable row level security;
alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_events enable row level security;
revoke all on public.areas,public.profiles,public.locations,public.categories,public.inventory_items,public.inventory_events from anon;
grant select,insert,update,delete on public.areas,public.locations,public.categories,public.inventory_items to authenticated;
grant select,update on public.profiles to authenticated;
grant select on public.inventory_events to authenticated;
revoke insert,update,delete on public.inventory_events from authenticated;

create policy areas_read on public.areas for select to authenticated using(private.current_role() is not null and (active or private.is_admin()));
create policy areas_write on public.areas for all to authenticated using(private.is_admin()) with check(private.is_admin());
create policy locations_read on public.locations for select to authenticated using(private.current_role() is not null and (active or private.is_admin()));
create policy locations_write on public.locations for all to authenticated using(private.is_admin()) with check(private.is_admin());
create policy categories_read on public.categories for select to authenticated using(private.current_role() is not null);
create policy categories_write on public.categories for all to authenticated using(private.is_admin()) with check(private.is_admin());
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or private.current_role() is not null);
create policy profiles_write on public.profiles for update to authenticated using(private.is_admin()) with check(private.is_admin());
create policy items_read on public.inventory_items for select to authenticated using(private.current_role() is not null);
create policy items_insert on public.inventory_items for insert to authenticated with check(private.can_edit(area_id));
create policy items_update on public.inventory_items for update to authenticated using(private.can_count()) with check(private.can_count());
create policy items_delete on public.inventory_items for delete to authenticated using(private.can_edit(area_id));
create policy events_read on public.inventory_events for select to authenticated using(private.current_role() is not null);

-- RLS controls rows. This trigger additionally prevents unauthorized column changes.
create function private.guard_item() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if tg_op='INSERT' or new.location_id is distinct from old.location_id then
  -- Serialize drawer membership changes with audit verification (including new arrivals).
  if new.location_id is not null then perform pg_advisory_xact_lock(hashtextextended(new.location_id::text,4418));end if;
  if tg_op='UPDATE' and old.location_id is not null then perform pg_advisory_xact_lock(hashtextextended(old.location_id::text,4418));end if;
 end if;
 if tg_op='INSERT' then
  if not coalesce(private.can_edit(new.area_id),false) then raise exception 'You cannot create items in this area' using errcode='42501';end if;
  new.created_by:=actor; new.created_at:=clock_timestamp();
  -- Imported historical verification dates may be preserved by admins; no verifier is invented.
  new.last_verified_by:=null;
 else
  if not private.can_count() then raise exception 'You cannot change inventory' using errcode='42501';end if;
  if new.id<>old.id or new.created_at<>old.created_at or new.created_by is distinct from old.created_by then raise exception 'Item identity is immutable' using errcode='42501';end if;
  if (to_jsonb(new)-array['quantity','last_verified_at','last_verified_by','updated_at','updated_by']) is distinct from (to_jsonb(old)-array['quantity','last_verified_at','last_verified_by','updated_at','updated_by']) then
   if not coalesce(private.can_edit(old.area_id) and private.can_edit(new.area_id),false) then raise exception 'Only the assigned lead, admin or mentor can edit item metadata' using errcode='42501';end if;
  end if;
  if new.last_verified_at is distinct from old.last_verified_at then new.last_verified_at:=clock_timestamp();new.last_verified_by:=actor;
  else new.last_verified_by:=old.last_verified_by;end if;
 end if;
 new.updated_by:=actor;new.updated_at:=clock_timestamp();return new;
end $$;
create trigger guard_inventory_item before insert or update on public.inventory_items for each row execute function private.guard_item();

create function private.log_item() returns trigger language plpgsql security definer set search_path='' as $$
declare row_item public.inventory_items; kind text;
begin
 row_item:=case when tg_op='DELETE' then old else new end;
 if tg_op='INSERT' then kind:='item_created';elsif tg_op='DELETE' then kind:='item_deleted';else kind:='item_updated';end if;
 if tg_op='UPDATE' and new.quantity is distinct from old.quantity then
  insert into public.inventory_events(inventory_item_id,item_name,area_id,user_id,event_type,quantity_before,quantity_after,change_amount)
  values(new.id,new.name,new.area_id,auth.uid(),'quantity_changed',old.quantity,new.quantity,new.quantity-old.quantity);
  kind:=null;
 end if;
 if tg_op='UPDATE' and new.last_verified_at is distinct from old.last_verified_at then
  insert into public.inventory_events(inventory_item_id,item_name,area_id,user_id,event_type,quantity_before,quantity_after,change_amount,notes)
  values(new.id,new.name,new.area_id,auth.uid(),case when current_setting('app.drawer_audit',true)='yes' then 'drawer_verified' else 'item_verified' end,old.quantity,new.quantity,0,coalesce(new.location_id::text,''));
  kind:=null;
 end if;
 if tg_op='UPDATE' and new.location_id is distinct from old.location_id then kind:='location_changed';end if;
 if kind is not null then
  insert into public.inventory_events(inventory_item_id,item_name,area_id,user_id,event_type,notes)
  values(case when tg_op='DELETE' then null else row_item.id end,row_item.name,row_item.area_id,auth.uid(),kind,case when tg_op='DELETE' then 'Deleted item ID: '||old.id::text else '' end);
 end if;
 return null;
end $$;
create trigger log_inventory_item after insert or update or delete on public.inventory_items for each row execute function private.log_item();

create function private.guard_location() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(4419);
 if tg_op='UPDATE' and new.id<>old.id then raise exception 'Location identity is immutable';end if;
 if exists(with recursive ancestors as (select id,parent_id from public.locations where id=new.parent_id union select l.id,l.parent_id from public.locations l join ancestors a on l.id=a.parent_id) select 1 from ancestors where id=new.id) then raise exception 'A location cannot contain itself';end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create trigger guard_location before insert or update on public.locations for each row execute function private.guard_location();
create function private.guard_profile() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.email<>old.email or new.created_at<>old.created_at then raise exception 'Profile identity is immutable';end if;
 if old.role in ('admin','mentor') and old.active and (not new.active or new.role not in ('admin','mentor')) then
  perform pg_advisory_xact_lock(4418);
  if not exists(select 1 from public.profiles where id<>old.id and active and role in ('admin','mentor')) then raise exception 'Keep at least one active admin or mentor';end if;
 end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create trigger guard_profile before update on public.profiles for each row execute function private.guard_profile();
commit;
