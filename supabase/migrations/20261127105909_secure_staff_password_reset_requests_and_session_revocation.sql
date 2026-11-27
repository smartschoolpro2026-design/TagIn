create table if not exists public.staff_password_reset_requests (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 membership_id uuid not null references public.school_memberships(id) on delete cascade,
 staff_user_id uuid not null references public.profiles(id) on delete cascade,
 requested_by uuid not null references public.profiles(id) on delete restrict,
 request_note text,
 status text not null default 'pending' check(status in ('pending','fulfilled','rejected')),
 reviewed_by uuid references public.profiles(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint staff_reset_note_length check(request_note is null or length(request_note)<=300)
);
create index if not exists staff_password_reset_school_status_idx on public.staff_password_reset_requests(school_id,status,created_at desc);
create unique index if not exists staff_password_reset_one_pending_idx on public.staff_password_reset_requests(membership_id) where status='pending';
alter table public.staff_password_reset_requests enable row level security;
drop policy if exists staff_password_reset_requests_read on public.staff_password_reset_requests;
create policy staff_password_reset_requests_read on public.staff_password_reset_requests for select to authenticated
using(private.is_platform_admin() or private.has_school_role(school_id,array['school_admin'::public.membership_role]));
drop policy if exists staff_password_reset_requests_insert on public.staff_password_reset_requests;
create policy staff_password_reset_requests_insert on public.staff_password_reset_requests for insert to authenticated
with check(private.has_school_role(school_id,array['school_admin'::public.membership_role])
 and requested_by=(select auth.uid())
 and exists(select 1 from public.school_memberships sm where sm.id=membership_id and sm.school_id=school_id and sm.user_id=staff_user_id and sm.role in ('staff','gate_staff','bus_staff')));
drop policy if exists staff_password_reset_requests_platform_update on public.staff_password_reset_requests;
create policy staff_password_reset_requests_platform_update on public.staff_password_reset_requests for update to authenticated
using(private.is_platform_admin()) with check(private.is_platform_admin());
grant select,insert,update on public.staff_password_reset_requests to authenticated;
create or replace function private.audit_staff_password_reset_request()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.audit_logs(school_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(new.school_id,coalesce(new.reviewed_by,new.requested_by),
  case when tg_op='INSERT' then 'staff.password_reset_requested' else 'staff.password_reset_reviewed' end,
  'staff_password_reset_request',new.id::text,
  jsonb_build_object('membership_id',new.membership_id,'status',new.status));
 return new;
end;
$$;
revoke all on function private.audit_staff_password_reset_request() from public,anon,authenticated;
drop trigger if exists audit_staff_password_reset_requests on public.staff_password_reset_requests;
create trigger audit_staff_password_reset_requests after insert or update on public.staff_password_reset_requests for each row execute function private.audit_staff_password_reset_request();
create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_deleted integer;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'Service role required' using errcode='42501';
 end if;
 delete from auth.sessions where user_id=p_user_id;
 get diagnostics v_deleted=row_count;
 return v_deleted;
end;
$$;
revoke all on function public.revoke_user_sessions(uuid) from public,anon,authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
