drop policy if exists staff_password_reset_requests_insert on public.staff_password_reset_requests;
create policy staff_password_reset_requests_insert on public.staff_password_reset_requests for insert to authenticated
with check(
 private.has_school_role(staff_password_reset_requests.school_id,array['school_admin'::public.membership_role])
 and staff_password_reset_requests.requested_by=(select auth.uid())
 and exists(
  select 1 from public.school_memberships sm
  where sm.id=staff_password_reset_requests.membership_id
   and sm.school_id=staff_password_reset_requests.school_id
   and sm.user_id=staff_password_reset_requests.staff_user_id
   and sm.role in ('staff','gate_staff','bus_staff')
 )
);
