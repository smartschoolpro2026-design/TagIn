DROP POLICY students_read_school_or_guardian ON public.students;
CREATE POLICY students_read_school_or_guardian
ON public.students FOR SELECT TO authenticated
USING (
  (SELECT private.is_platform_admin())
  OR (SELECT private.has_school_role(students.school_id, ARRAY[
    'school_admin'::public.membership_role,
    'gate_staff'::public.membership_role,
    'bus_staff'::public.membership_role
  ]))
  OR (SELECT private.is_guardian_of_student(students.id, students.school_id))
  OR (SELECT private.has_staff_permission(students.school_id, 'students.read_basic'))
  OR (SELECT private.has_staff_permission(students.school_id, 'students.create'))
  OR (SELECT private.has_staff_permission(students.school_id, 'students.update'))
  OR (SELECT private.has_staff_permission(students.school_id, 'registers.manage'))
  OR (SELECT private.has_staff_permission(students.school_id, 'gate.scan'))
  OR (SELECT private.has_staff_permission(students.school_id, 'transport.view_assigned'))
);

CREATE POLICY students_staff_insert
ON public.students FOR INSERT TO authenticated
WITH CHECK (
  (SELECT private.has_staff_permission(students.school_id, 'students.create'))
);

CREATE POLICY students_staff_update
ON public.students FOR UPDATE TO authenticated
USING (
  (SELECT private.has_staff_permission(students.school_id, 'students.update'))
)
WITH CHECK (
  (SELECT private.has_staff_permission(students.school_id, 'students.update'))
);

DROP POLICY tags_staff_read ON public.tags;
CREATE POLICY tags_staff_read
ON public.tags FOR SELECT TO authenticated
USING (
  (SELECT private.is_platform_admin())
  OR (SELECT private.has_school_role(tags.school_id, ARRAY[
    'school_admin'::public.membership_role,
    'gate_staff'::public.membership_role
  ]))
  OR (SELECT private.has_staff_permission(tags.school_id, 'gate.scan'))
);

DROP POLICY scan_events_staff_insert ON public.scan_events;
CREATE POLICY scan_events_staff_insert
ON public.scan_events FOR INSERT TO authenticated
WITH CHECK (
  scanned_by = (SELECT auth.uid())
  AND (
    (SELECT private.is_platform_admin())
    OR (SELECT private.has_school_role(scan_events.school_id, ARRAY[
      'school_admin'::public.membership_role,
      'gate_staff'::public.membership_role,
      'bus_staff'::public.membership_role
    ]))
    OR (SELECT private.has_staff_permission(scan_events.school_id, 'gate.check_in'))
    OR (SELECT private.has_staff_permission(scan_events.school_id, 'gate.check_out'))
    OR (SELECT private.has_staff_permission(scan_events.school_id, 'transport.board'))
    OR (SELECT private.has_staff_permission(scan_events.school_id, 'transport.drop_off'))
  )
);

DROP POLICY scan_events_staff_read ON public.scan_events;
CREATE POLICY scan_events_staff_read
ON public.scan_events FOR SELECT TO authenticated
USING (
  (SELECT private.is_platform_admin())
  OR (SELECT private.has_school_role(scan_events.school_id, ARRAY[
    'school_admin'::public.membership_role,
    'gate_staff'::public.membership_role,
    'bus_staff'::public.membership_role
  ]))
  OR (SELECT private.has_staff_permission(scan_events.school_id, 'gate.scan'))
  OR (SELECT private.has_staff_permission(scan_events.school_id, 'transport.view_assigned'))
);

DROP POLICY collectors_read_related ON public.authorized_collectors;
CREATE POLICY collectors_read_related
ON public.authorized_collectors FOR SELECT TO authenticated
USING (
  (SELECT private.is_platform_admin())
  OR (SELECT private.has_school_role(authorized_collectors.school_id, ARRAY[
    'school_admin'::public.membership_role,
    'gate_staff'::public.membership_role,
    'bus_staff'::public.membership_role
  ]))
  OR (SELECT private.has_staff_permission(authorized_collectors.school_id, 'gate.verify_collector'))
  OR (SELECT private.is_guardian_of_student(authorized_collectors.student_id, authorized_collectors.school_id))
);
