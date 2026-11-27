-- TagIn student operations v1. Additive migration: retains existing schools,
-- profiles, memberships, audit_logs, enums, and helper functions.

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  class_name text,
  level text,
  uses_bus boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, school_id)
);

create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  relationship text,
  phone text,
  photo_path text,
  created_at timestamptz not null default now(),
  unique (id, school_id),
  unique (school_id, user_id)
);

create table if not exists public.student_guardians (
  school_id uuid not null,
  student_id uuid not null,
  guardian_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (student_id, guardian_id),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete restrict,
  foreign key (guardian_id, school_id) references public.guardians(id, school_id) on delete restrict
);

create table if not exists public.authorized_collectors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  relationship text,
  photo_path text,
  standing boolean not null default true,
  valid_on date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete restrict,
  check ((standing = true and valid_on is null) or (standing = false and valid_on is not null))
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active','lost','replaced','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (student_id, school_id) references public.students(id, school_id) on delete restrict
);

create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  tag_id uuid,
  event_type text not null check (event_type in ('check_in','check_out','bus_pickup','bus_board','bus_drop')),
  collected_by_type text,
  collected_by_name text,
  scanned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete restrict,
  foreign key (tag_id) references public.tags(id) on delete restrict,
  check (event_type <> 'check_out' or collected_by_name is not null)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid references public.students(id) on delete restrict,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists students_school_active_idx on public.students(school_id, active);
create index if not exists guardians_user_idx on public.guardians(user_id);
create index if not exists student_guardians_guardian_idx on public.student_guardians(guardian_id);
create index if not exists collectors_school_student_idx on public.authorized_collectors(school_id, student_id);
create index if not exists tags_school_student_status_idx on public.tags(school_id, student_id, status);
create index if not exists scan_events_school_created_idx on public.scan_events(school_id, created_at desc);
create index if not exists scan_events_student_created_idx on public.scan_events(student_id, created_at desc);
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);

create or replace function private.is_guardian_of_student(target_student_id uuid, target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.student_guardians sg
    join public.guardians g
      on g.id = sg.guardian_id and g.school_id = sg.school_id
    join public.profiles p on p.id = g.user_id and p.is_active = true
    where sg.student_id = target_student_id
      and sg.school_id = target_school_id
      and g.user_id = (select auth.uid())
  );
$function$;

grant execute on function private.is_guardian_of_student(uuid,uuid) to authenticated;

alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.student_guardians enable row level security;
alter table public.authorized_collectors enable row level security;
alter table public.tags enable row level security;
alter table public.scan_events enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;

drop policy if exists students_read_school_or_guardian on public.students;
create policy students_read_school_or_guardian on public.students for select to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, null))
  or (select private.is_guardian_of_student(id, school_id))
);

drop policy if exists students_admin_manage on public.students;
create policy students_admin_manage on public.students for all to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
)
with check (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
);

drop policy if exists guardians_read_own_or_staff on public.guardians;
create policy guardians_read_own_or_staff on public.guardians for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
);

drop policy if exists guardians_admin_manage on public.guardians;
create policy guardians_admin_manage on public.guardians for all to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
)
with check (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
);

drop policy if exists student_guardians_read_related on public.student_guardians;
create policy student_guardians_read_related on public.student_guardians for select to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin','gate_staff','bus_staff']::membership_role[]))
  or (select private.is_guardian_of_student(student_id, school_id))
);

drop policy if exists student_guardians_admin_manage on public.student_guardians;
create policy student_guardians_admin_manage on public.student_guardians for all to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
)
with check (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
);

drop policy if exists collectors_read_related on public.authorized_collectors;
create policy collectors_read_related on public.authorized_collectors for select to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin','gate_staff','bus_staff']::membership_role[]))
  or (select private.is_guardian_of_student(student_id, school_id))
);

drop policy if exists collectors_parent_insert_one_day on public.authorized_collectors;
create policy collectors_parent_insert_one_day on public.authorized_collectors for insert to authenticated
with check (
  (select private.is_guardian_of_student(student_id, school_id))
  and created_by = (select auth.uid())
  and standing = false
  and valid_on >= current_date
);

drop policy if exists collectors_parent_update_own_one_day on public.authorized_collectors;
create policy collectors_parent_update_own_one_day on public.authorized_collectors for update to authenticated
using (
  (select private.is_guardian_of_student(student_id, school_id))
  and created_by = (select auth.uid())
  and standing = false
)
with check (
  (select private.is_guardian_of_student(student_id, school_id))
  and created_by = (select auth.uid())
  and standing = false
);

drop policy if exists collectors_admin_manage on public.authorized_collectors;
create policy collectors_admin_manage on public.authorized_collectors for all to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
)
with check (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
);

drop policy if exists tags_staff_read on public.tags;
create policy tags_staff_read on public.tags for select to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin','gate_staff']::membership_role[]))
);

drop policy if exists tags_admin_manage on public.tags;
create policy tags_admin_manage on public.tags for all to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
)
with check (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::membership_role[]))
);

drop policy if exists scan_events_staff_read on public.scan_events;
create policy scan_events_staff_read on public.scan_events for select to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin','gate_staff','bus_staff']::membership_role[]))
);

drop policy if exists scan_events_guardian_read on public.scan_events;
create policy scan_events_guardian_read on public.scan_events for select to authenticated
using ((select private.is_guardian_of_student(student_id, school_id)));

drop policy if exists scan_events_staff_insert on public.scan_events;
create policy scan_events_staff_insert on public.scan_events for insert to authenticated
with check (
  scanned_by = (select auth.uid())
  and (
    (select private.is_platform_admin())
    or (select private.has_school_role(school_id, array['school_admin','gate_staff','bus_staff']::membership_role[]))
  )
);

drop policy if exists push_subscriptions_own_manage on public.push_subscriptions;
create policy push_subscriptions_own_manage on public.push_subscriptions for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

revoke all on
  public.students, public.guardians, public.student_guardians,
  public.authorized_collectors, public.tags, public.scan_events,
  public.push_subscriptions
from anon;
grant select, insert, update, delete on
  public.students, public.guardians, public.student_guardians,
  public.authorized_collectors, public.tags, public.scan_events,
  public.push_subscriptions
to authenticated;

comment on table public.tags is 'Student QR credentials; only a one-way token hash is stored.';
comment on table public.scan_events is 'Append-only student arrival, departure, and bus scan history.';
comment on table public.authorized_collectors is 'Standing or date-limited people authorized to collect a student.';
