insert into public.staff_permissions (membership_id, permission_key)
select sm.id, 'students.create'
from public.school_memberships sm
where sm.role='staff'::public.membership_role
  and sm.status='active'::public.membership_status
  and not exists (
    select 1 from public.staff_permissions sp
    where sp.membership_id=sm.id and sp.permission_key='students.create'
  );