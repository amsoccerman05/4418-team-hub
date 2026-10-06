-- Disposable integration prerequisite only. These four shared-app contracts are
-- absent from this repo's migration history. Auth and Storage are REAL CLI services.
-- Do not apply this file to an existing/shared database.
begin;
do $$begin
  if to_regclass('public.profiles') is not null then
    raise exception 'Refusing an existing application database';
  end if;
  if to_regclass('auth.users') is null or to_regclass('storage.objects') is null then
    raise exception 'Real Supabase Auth and Storage schemas are required';
  end if;
end$$;
create table public.profiles (
  id uuid primary key references auth.users(id), display_name text, role text, active boolean
);
create table public.areas(id uuid primary key, name text, active boolean);
create table public.team_positions(key text primary key, active boolean);
create table public.team_member_positions(
  user_id uuid references public.profiles(id),
  position_key text references public.team_positions(key), revoked_at timestamptz
);
alter table public.profiles enable row level security;
alter table public.areas enable row level security;
alter table public.team_positions enable row level security;
alter table public.team_member_positions enable row level security;
revoke all on public.profiles,public.areas,public.team_positions,public.team_member_positions from anon,authenticated,service_role;
-- Deliberately permissive unrelated-app policy tests the production restrictive
-- Fabrication bucket boundary on the real Storage API. It grants no app-table access.
create policy fabrication_integration_other_app on storage.objects
  for all to anon,authenticated using(true) with check(true);
commit;
