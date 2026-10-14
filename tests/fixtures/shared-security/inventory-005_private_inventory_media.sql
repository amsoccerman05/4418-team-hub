begin;
-- Apply after 004. Bucket remains private; database rows contain object paths, never image bytes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('inventory-media','inventory-media',false,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function private.can_manage_media(kind text,entity uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when kind='items' then exists(select 1 from public.inventory_items where id=entity and coalesce(private.can_edit(area_id),false))
 when kind='locations' then exists(select 1 from public.locations where id=entity and (private.is_admin() or (private.current_role()='lead' and area_id=private.current_area()))) else false end
$$;
create or replace function private.can_manage_media_path(object_path text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 return private.can_manage_media(split_part(object_path,'/',1),split_part(object_path,'/',2)::uuid) and array_length(string_to_array(object_path,'/'),1)=3;
exception when invalid_text_representation then return false;
end $$;
grant execute on function private.can_manage_media(text,uuid),private.can_manage_media_path(text) to authenticated;
revoke all on function private.can_manage_media(text,uuid),private.can_manage_media_path(text) from public;
grant insert,update,delete on public.inventory_media to authenticated;
create policy media_write on public.inventory_media for all to authenticated using(private.can_manage_media(entity_type,entity_id)) with check(private.can_manage_media(entity_type,entity_id) and path like entity_type||'/'||entity_id::text||'/%');
create function private.guard_media() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.id<>old.id or new.entity_id<>old.entity_id or new.entity_type<>old.entity_type) then raise exception 'Media identity is immutable';end if;
 if not exists(select 1 from storage.objects where bucket_id='inventory-media' and name=new.path) then raise exception 'Upload the image before saving its reference';end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create trigger guard_media before insert or update on public.inventory_media for each row execute function private.guard_media();
create policy inventory_media_read on storage.objects for select to authenticated using(bucket_id='inventory-media' and private.current_role() is not null);
create policy inventory_media_insert on storage.objects for insert to authenticated with check(bucket_id='inventory-media' and private.can_manage_media_path(name));
create policy inventory_media_update on storage.objects for update to authenticated using(bucket_id='inventory-media' and private.can_manage_media_path(name)) with check(bucket_id='inventory-media' and private.can_manage_media_path(name));
create policy inventory_media_delete on storage.objects for delete to authenticated using(bucket_id='inventory-media' and private.can_manage_media_path(name));
insert into private.inventory_schema_versions values(5);
commit;
