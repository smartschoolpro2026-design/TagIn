drop policy if exists transport_events_read_gate_staff on public.transport_events;
create policy transport_events_read_gate_staff on public.transport_events
for select to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(school_id,array['school_admin','gate_staff']::public.membership_role[]))
);