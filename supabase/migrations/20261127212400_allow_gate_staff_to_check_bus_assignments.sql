drop policy if exists transport_route_students_read_gate_staff on public.transport_route_students;
create policy transport_route_students_read_gate_staff on public.transport_route_students
for select to authenticated
using (
 (select private.is_platform_admin())
 or (select private.has_school_role(school_id,array['school_admin','gate_staff']::public.membership_role[]))
);
drop policy if exists transport_routes_read_gate_staff on public.transport_routes;
create policy transport_routes_read_gate_staff on public.transport_routes
for select to authenticated
using (
 (select private.is_platform_admin())
 or (select private.has_school_role(school_id,array['school_admin','gate_staff']::public.membership_role[]))
);