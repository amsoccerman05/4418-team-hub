begin;
create schema if not exists private;
revoke all on schema private from public;

create table public.areas (
 id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
 description text, lead_name text not null default '', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', email text not null default '',
 role text not null default 'readonly' check(role in ('readonly','student','lead','admin','mentor')),
 primary_area_id uuid references public.areas(id) on delete set null,
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.locations (
 id uuid primary key default gen_random_uuid(), name text not null, code text,
 parent_id uuid references public.locations(id) on delete restrict,
 location_type text check(location_type in ('Storage','Side','Shelf','Bin','Drawer')),
 description text, room text not null default '', storage text not null default '',
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(parent_id is distinct from id)
);
create table public.categories (name text primary key check(length(trim(name))>0));
create table public.inventory_items (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name))>0),
 item_type text not null default 'Part' check(item_type in ('Part','Consumable','Raw Material','Tool','Asset')),
 ownership text not null default 'FRC 4418' check(ownership in ('Shared / School','FRC 4418','BEST')),
 area_id uuid not null references public.areas(id) on delete restrict,
 category text not null check(length(trim(category))>0),
 quantity numeric not null default 0 check(quantity>=0 and quantity<'Infinity'::numeric),
 expected_quantity numeric check(expected_quantity>=0 and expected_quantity<'Infinity'::numeric),
 minimum_quantity numeric not null default 0 check(minimum_quantity>=0 and minimum_quantity<'Infinity'::numeric),
 target_quantity numeric not null default 0 check(target_quantity>=0 and target_quantity<'Infinity'::numeric),
 unit text not null default 'each', location_id uuid references public.locations(id) on delete restrict,
 slot_position text not null default '', manufacturer text not null default '', manufacturer_part_number text not null default '',
 vendor text not null default '', vendor_url text not null default '', approx_unit_cost numeric not null default 0 check(approx_unit_cost>=0 and approx_unit_cost<'Infinity'::numeric),
 notes text not null default '', last_verified_at timestamptz, last_verified_by uuid references auth.users(id) on delete set null,
 legacy_updated_by text not null default '',
 order_status text not null default 'Needs Order' check(order_status in ('Needs Order','Ordered','Received')),
 tracking_mode text not null default 'quantity' check(tracking_mode in ('quantity','individual')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null
);
create table public.inventory_events (
 id uuid primary key default gen_random_uuid(),
 inventory_item_id uuid references public.inventory_items(id) on delete set null,
 item_name text not null, area_id uuid references public.areas(id) on delete set null,
 user_id uuid references auth.users(id) on delete set null,
 event_type text not null check(event_type in ('quantity_changed','item_created','item_updated','item_deleted','item_verified','drawer_verified','location_changed')),
 quantity_before numeric, quantity_after numeric, change_amount numeric,
 notes text not null default '', created_at timestamptz not null default now()
);
create index inventory_area_idx on public.inventory_items(area_id);
create index inventory_location_idx on public.inventory_items(location_id);
create index location_parent_idx on public.locations(parent_id);
create index events_item_time_idx on public.inventory_events(inventory_item_id,created_at desc);
create index events_time_idx on public.inventory_events(created_at desc);
create index profile_area_idx on public.profiles(primary_area_id);

create function private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,display_name) values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'display_name',''));
 return new;
end $$;
create trigger create_inventory_profile after insert on auth.users for each row execute function private.create_profile();
-- Backfill already-created Auth users; never trust metadata for roles.
insert into public.profiles(id,email) select id,coalesce(email,'') from auth.users on conflict(id) do nothing;
commit;
