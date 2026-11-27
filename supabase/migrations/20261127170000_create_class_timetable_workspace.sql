create table if not exists public.timetable_entries (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 class_name text not null,
 subject_name text not null,
 teacher_membership_id uuid references public.school_memberships(id) on delete set null,
 weekday smallint not null check (weekday between 1 and 7),
 start_time time not null,
 end_time time not null,
 room text,
 notes text,
 active boolean not null default true,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint timetable_valid_period check (end_time > start_time),
 constraint timetable_class_subject_day_start_unique unique (school_id,class_name,weekday,start_time)
);
create index if not exists timetable_entries_school_class_day_idx on public.timetable_entries(school_id,class_name,weekday,start_time) where active;
create index if not exists timetable_entries_teacher_day_idx on public.timetable_entries(teacher_membership_id,weekday,start_time) where active;
alter table public.timetable_entries enable row level security;
drop policy if exists timetable_admin_manage on public.timetable_entries;
create policy timetable_admin_manage on public.timetable_entries for all to authenticated
using (private.has_school_role(school_id, array['school_admin'::public.membership_role]))
with check (private.has_school_role(school_id, array['school_admin'::public.membership_role]));
drop policy if exists timetable_teacher_read_assigned on public.timetable_entries;
create policy timetable_teacher_read_assigned on public.timetable_entries for select to authenticated
using (active and exists (
 select 1 from public.school_memberships sm
 where sm.id=timetable_entries.teacher_membership_id
 and sm.school_id=timetable_entries.school_id
 and sm.user_id=(select auth.uid()) and sm.status='active'
 and sm.role='staff'
));
drop policy if exists timetable_guardian_read_child_class on public.timetable_entries;
create policy timetable_guardian_read_child_class on public.timetable_entries for select to authenticated
using (active and exists (
 select 1 from public.students s
 join public.student_guardians sg on sg.student_id=s.id and sg.school_id=s.school_id
 join public.guardians g on g.id=sg.guardian_id and g.school_id=sg.school_id
 where s.school_id=timetable_entries.school_id and s.active
 and s.class_name=timetable_entries.class_name and g.user_id=(select auth.uid())
));
grant select,insert,update,delete on public.timetable_entries to authenticated;
