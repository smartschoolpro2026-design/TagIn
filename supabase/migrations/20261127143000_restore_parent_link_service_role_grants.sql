-- Restore only the service-role table privileges required by the
-- create-parent-account Edge Function. RLS remains enabled and bypassed
-- only by the trusted server-side service_role credential.
grant select on public.school_memberships to service_role;
grant select on public.students to service_role;
grant select, insert, update, delete on public.guardians to service_role;
grant select, insert, update, delete on public.student_guardians to service_role;
grant insert on public.audit_logs to service_role;
