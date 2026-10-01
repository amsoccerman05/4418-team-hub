-- Read-only invitation display reconciliation. No records or invitation actions change.
begin;
CREATE OR REPLACE FUNCTION public.team_management_context_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;
begin
 if not team_private.admin() then raise exception 'Active mentor or admin required' using errcode='42501';end if;
 c:=public.team_management_context();
 return c||jsonb_build_object('members',(select coalesce(jsonb_agg(m||jsonb_build_object('email',u.email) order by m->>'display_name'),'[]') from jsonb_array_elements(c->'members') m left join auth.users u on u.id=(m->>'id')::uuid),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'display_name',i.display_name,'user_id',i.user_id,'created_at',i.created_at,
 'status',case when identity_match.n=1 and identity_match.usable then 'account_active'
 when identity_match.n=1 and identity_match.awaiting_setup and i.status='pending' then 'pending'
 when i.status='processing' and i.created_at>=now()-interval '2 minutes' then 'processing' else 'review' end,
 'review_reason',case when identity_match.n=1 then 'account_not_ready'
 when exists(select 1 from auth.users other where lower(other.email)=i.email) then 'identity_unmatched' else 'invitation_incomplete' end
 ) order by i.created_at desc),'[]') from team_private.invitations i
 left join lateral (
 select count(*) n,coalesce(bool_and(p.active and u.last_sign_in_at is null and (u.banned_until is null or u.banned_until<=now())),false) awaiting_setup,
 coalesce(bool_and(p.active and u.last_sign_in_at is not null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())),false) usable
 from auth.users u join public.profiles p on p.id=u.id
 where lower(u.email)=i.email and
 ((i.user_id is not null and u.id=i.user_id) or
 (i.user_id is null and u.raw_user_meta_data->>'team_invitation_id'=i.id::text
 and u.created_at>=i.created_at and u.invited_at>=i.created_at))
 ) identity_match on true));
end $function$
;
commit;
