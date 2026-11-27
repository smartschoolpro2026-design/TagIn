create policy tags_staff_attendance_read
on public.tags
for select
to authenticated
using (
  (select private.is_platform_admin())
  or (select private.has_school_role(tags.school_id, array['school_admin','gate_staff']::public.membership_role[]))
  or (select private.has_staff_permission(tags.school_id, 'gate.scan'))
  or (select private.has_staff_permission(tags.school_id, 'gate.check_in'))
  or (select private.has_staff_permission(tags.school_id, 'gate.check_out'))
);
