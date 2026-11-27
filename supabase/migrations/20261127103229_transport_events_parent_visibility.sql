drop policy if exists transport_events_read_linked_guardians on public.transport_events;
create policy transport_events_read_linked_guardians
on public.transport_events
for select
to authenticated
using (private.is_guardian_of_student(student_id, school_id));
