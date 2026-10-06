-- Synthetic Storage schema and deliberately broad unrelated policy. Local tests only.
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,user_metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant all on storage.objects to anon,authenticated,service_role;
create policy deliberately_broad_other_app on storage.objects for all to anon,authenticated using(true) with check(true);
