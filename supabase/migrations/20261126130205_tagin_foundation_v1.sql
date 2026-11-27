-- TagIn foundation v1: platform identity, schools, memberships, and audit trail.
-- Additive migration only. Does not alter or delete existing objects.

create type public.platform_role as enum ('user', 'super_admin');
create type public.school_status as enum ('active', 'suspended');
create type public.membership_role as enum ('school_admin', 'gate_staff', 'bus_staff', 'parent');
create type public.membership_status as enum ('active', 'inactive');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  address text,
  status public.school_status not null default 'active',
  photos_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  phone text,
  platform_role public.platform_role not null default 'user',
  must_change_password boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.membership_role not null,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (school_id, user_id, role)
);

create index school_memberships_user_school_idx
  on public.school_memberships (user_id, school_id)
  where status = 'active';
create index school_memberships_school_role_idx
  on public.school_memberships (school_id, role)
  where status = 'active';

create table public.audit_logs (
  id bigint generated always as identity primary key,
  school_id uuid references public.schools(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (length(trim(action)) between 2 and 120),
  entity_type text not null check (length(trim(entity_type)) between 2 and 80),
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_school_created_idx
  on public.audit_logs (school_id, created_at desc);
create index audit_logs_actor_created_idx
  on public.audit_logs (actor_user_id, created_at desc);

-- Keep authorization helpers outside exposed schemas. They read membership data
-- without causing recursive RLS evaluation and are callable only by signed-in users.
create schema private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.platform_role = 'super_admin'
      and p.is_active = true
  );
$$;

create function private.has_school_role(
  target_school_id uuid,
  allowed_roles public.membership_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_memberships sm
    join public.profiles p on p.id = sm.user_id
    join public.schools s on s.id = sm.school_id
    where sm.user_id = (select auth.uid())
      and sm.school_id = target_school_id
      and sm.status = 'active'
      and p.is_active = true
      and s.status = 'active'
      and (allowed_roles is null or sm.role = any(allowed_roles))
  );
$$;

revoke all on function private.is_platform_admin() from public, anon;
revoke all on function private.has_school_role(uuid, public.membership_role[]) from public, anon;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.has_school_role(uuid, public.membership_role[]) to authenticated;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.school_memberships enable row level security;
alter table public.audit_logs enable row level security;

create policy "schools_read_for_members_and_platform_admin"
on public.schools for select to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(id, null))
);

create policy "schools_insert_platform_admin_only"
on public.schools for insert to authenticated
with check ((select private.is_platform_admin()));

create policy "schools_update_platform_admin_only"
on public.schools for update to authenticated
using ((select private.is_platform_admin()))
with check ((select private.is_platform_admin()));

create policy "schools_delete_platform_admin_only"
on public.schools for delete to authenticated
using ((select private.is_platform_admin()));

create policy "profiles_read_self_or_school_admin_or_platform_admin"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (select private.is_platform_admin())
  or exists (
    select 1
    from public.school_memberships mine
    join public.school_memberships theirs
      on theirs.school_id = mine.school_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and mine.role = 'school_admin'
      and theirs.user_id = profiles.id
      and theirs.status = 'active'
  )
);

create policy "profiles_update_self_limited_to_own_row"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and platform_role = 'user'
  and is_active = true
);

create policy "memberships_read_self_admin_or_platform_admin"
on public.school_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_platform_admin())
  or (select private.has_school_role(
    school_id, array['school_admin']::public.membership_role[]
  ))
);

create policy "memberships_insert_admin_or_platform_admin"
on public.school_memberships for insert to authenticated
with check (
  (select private.is_platform_admin())
  or (
    (select private.has_school_role(
      school_id, array['school_admin']::public.membership_role[]
    ))
    and role <> 'school_admin'
  )
);

create policy "memberships_update_admin_or_platform_admin"
on public.school_memberships for update to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(
    school_id, array['school_admin']::public.membership_role[]
  ))
)
with check (
  (select private.is_platform_admin())
  or (
    (select private.has_school_role(
      school_id, array['school_admin']::public.membership_role[]
    ))
    and role <> 'school_admin'
  )
);

create policy "memberships_delete_admin_or_platform_admin"
on public.school_memberships for delete to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(
    school_id, array['school_admin']::public.membership_role[]
  ))
);

create policy "audit_logs_read_school_admin_or_platform_admin"
on public.audit_logs for select to authenticated
using (
  (select private.is_platform_admin())
  or (
    school_id is not null
    and (select private.has_school_role(
      school_id, array['school_admin']::public.membership_role[]
    ))
  )
);

-- Explicit grants are required: new Supabase projects no longer rely on
-- automatic Data API exposure. RLS remains the row-level authorization layer.
grant select, insert, update, delete on public.schools to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.school_memberships to authenticated;
grant select on public.audit_logs to authenticated;
grant usage, select on sequence public.audit_logs_id_seq to authenticated;

comment on table public.schools is 'Tenant records for the TagIn multi-school platform.';
comment on table public.profiles is 'Application profile linked one-to-one with Supabase Auth users.';
comment on table public.school_memberships is 'Per-school roles; users may have multiple roles or belong to multiple schools.';
comment on table public.audit_logs is 'Append-only audit history; client inserts and updates are intentionally not granted.';
