create table if not exists public.school_classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_name text not null check (length(btrim(class_name)) between 1 and 80),
  level text not null default '',
  teacher_membership_id uuid references public.school_memberships(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_classes_school_level_name_key unique (school_id, level, class_name)
);

alter table public.students add column if not exists class_id uuid references public.school_classes(id) on delete set null;

insert into public.school_classes (school_id, class_name, level)
select distinct s.school_id, btrim(s.class_name), coalesce(btrim(s.level),'')
from public.students s
where nullif(btrim(s.class_name),'') is not null
on conflict (school_id, level, class_name) do nothing;

update public.students s
set class_id = c.id
from public.school_classes c
where c.school_id = s.school_id
  and c.class_name = btrim(s.class_name)
  and c.level = coalesce(btrim(s.level),'')
  and s.class_id is null;

create or replace function private.sync_student_class_labels()
returns trigger
language plpgsql
set search_path = ''
as $$
declare class_row public.school_classes%rowtype;
begin
  if new.class_id is null then return new; end if;
  select * into class_row from public.school_classes where id = new.class_id and school_id = new.school_id;
  if not found then raise exception 'Selected class does not belong to this school'; end if;
  new.class_name := class_row.class_name;
  new.level := nullif(class_row.level,'');
  return new;
end;
$$;

drop trigger if exists students_sync_class_labels on public.students;
create trigger students_sync_class_labels
before insert or update of class_id, school_id on public.students
for each row execute function private.sync_student_class_labels();

create or replace function private.teacher_has_assigned_class(target_school_id uuid, target_class_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.school_classes c
    join public.school_memberships sm on sm.id = c.teacher_membership_id
      and sm.school_id = c.school_id
      and sm.user_id = (select auth.uid())
      and sm.role = 'staff'::public.membership_role
      and sm.status = 'active'::public.membership_status
    where c.id = target_class_id and c.school_id = target_school_id
  );
$$;

alter table public.school_classes enable row level security;
grant select, insert, update, delete on public.school_classes to authenticated;

drop policy if exists school_classes_read_school_admin_or_assigned_teacher on public.school_classes;
create policy school_classes_read_school_admin_or_assigned_teacher on public.school_classes
for select to authenticated using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::public.membership_role[]))
  or teacher_membership_id in (
    select sm.id from public.school_memberships sm
    where sm.user_id = (select auth.uid()) and sm.school_id = school_classes.school_id
      and sm.role = 'staff'::public.membership_role and sm.status = 'active'::public.membership_status
  )
);

drop policy if exists school_classes_admin_manage on public.school_classes;
create policy school_classes_admin_manage on public.school_classes
for all to authenticated using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::public.membership_role[]))
) with check (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id, array['school_admin']::public.membership_role[]))
);

grant execute on function private.teacher_has_assigned_class(uuid,uuid) to authenticated;

drop policy if exists students_staff_insert on public.students;
create policy students_staff_insert on public.students
for insert to authenticated with check (
  (select private.has_staff_permission(school_id, 'students.create'))
  and class_id is not null
  and (select private.teacher_has_assigned_class(school_id, class_id))
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='school_classes') then
      alter publication supabase_realtime add table public.school_classes;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='students') then
      alter publication supabase_realtime add table public.students;
    end if;
  end if;
end $$;
