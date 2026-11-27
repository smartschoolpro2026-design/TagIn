drop policy if exists students_read_school_or_guardian on public.students;
create policy students_read_school_or_guardian on public.students
for select to authenticated
using (
 (select private.is_platform_admin())
 or (select private.has_school_role(students.school_id,array['school_admin','gate_staff']::public.membership_role[]))
 or (select private.is_guardian_of_student(students.id,students.school_id))
 or (select private.has_staff_permission(students.school_id,'students.read_basic'))
 or (select private.has_staff_permission(students.school_id,'students.create'))
 or (select private.has_staff_permission(students.school_id,'students.update'))
 or (select private.has_staff_permission(students.school_id,'registers.manage'))
 or (select private.has_staff_permission(students.school_id,'gate.scan'))
);
drop policy if exists students_read_assigned_transport_route on public.students;
create policy students_read_assigned_transport_route on public.students
for select to authenticated
using (
 exists (
  select 1
  from public.transport_route_students rs
  join public.transport_route_drivers rd on rd.route_id=rs.route_id and rd.school_id=rs.school_id
  join public.school_memberships sm on sm.id=rd.membership_id
  where rs.school_id=students.school_id and rs.student_id=students.id
    and rs.active and rd.active and sm.user_id=(select auth.uid())
    and sm.status='active' and sm.role='bus_staff'
 )
);
drop policy if exists tags_read_assigned_transport_route on public.tags;
create policy tags_read_assigned_transport_route on public.tags
for select to authenticated
using (
 exists (
  select 1
  from public.transport_route_students rs
  join public.transport_route_drivers rd on rd.route_id=rs.route_id and rd.school_id=rs.school_id
  join public.school_memberships sm on sm.id=rd.membership_id
  where rs.school_id=tags.school_id and rs.student_id=tags.student_id
    and rs.active and rd.active and sm.user_id=(select auth.uid())
    and sm.status='active' and sm.role='bus_staff'
 )
);