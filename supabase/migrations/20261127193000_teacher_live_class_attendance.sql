-- Let each teacher read attendance only for students in classes assigned to that teacher.
drop policy if exists "scan_events_assigned_teacher_read" on public.scan_events;
create policy "scan_events_assigned_teacher_read"
on public.scan_events
for select
to authenticated
using (
  exists (
    select 1
    from public.students s
    join public.school_classes c
      on c.id = s.class_id
     and c.school_id = s.school_id
    join public.school_memberships sm
      on sm.id = c.teacher_membership_id
     and sm.school_id = c.school_id
    where s.id = scan_events.student_id
      and s.school_id = scan_events.school_id
      and sm.user_id = (select auth.uid())
      and sm.role = 'staff'
      and sm.status = 'active'
  )
);

-- Enable realtime delivery for new attendance records, safely if not already published.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'scan_events'
  ) then
    alter publication supabase_realtime add table public.scan_events;
  end if;
end
$$;
