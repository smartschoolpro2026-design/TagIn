CREATE TABLE public.staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL UNIQUE REFERENCES public.school_memberships(id) ON DELETE CASCADE,
  job_title text NOT NULL CHECK (length(trim(job_title)) BETWEEN 2 AND 80),
  department text NULL CHECK (department IS NULL OR length(trim(department)) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.staff_profiles IS
  'Additional staff identity details for the unified School Staff membership category.';

CREATE TABLE public.staff_permissions (
  membership_id uuid NOT NULL REFERENCES public.school_memberships(id) ON DELETE CASCADE,
  permission_key text NOT NULL CHECK (permission_key IN (
    'students.read_basic',
    'students.create',
    'students.update',
    'registers.manage',
    'gate.scan',
    'gate.check_in',
    'gate.check_out',
    'gate.verify_collector',
    'transport.view_assigned',
    'transport.board',
    'transport.drop_off'
  )),
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, permission_key)
);

COMMENT ON TABLE public.staff_permissions IS
  'Per-staff, per-school permissions assigned by the school administrator.';

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_permissions TO authenticated;

CREATE POLICY staff_profiles_read_self_or_school_admin
ON public.staff_profiles
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.school_memberships sm
    WHERE sm.id = staff_profiles.membership_id
      AND (
        sm.user_id = (SELECT auth.uid())
        OR (SELECT private.is_platform_admin())
        OR (SELECT private.has_school_role(sm.school_id, ARRAY['school_admin']::public.membership_role[]))
      )
  )
);

CREATE POLICY staff_profiles_admin_manage
ON public.staff_profiles
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.school_memberships sm
    WHERE sm.id = staff_profiles.membership_id
      AND (
        (SELECT private.is_platform_admin())
        OR (SELECT private.has_school_role(sm.school_id, ARRAY['school_admin']::public.membership_role[]))
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.school_memberships sm
    WHERE sm.id = staff_profiles.membership_id
      AND (
        (SELECT private.is_platform_admin())
        OR (SELECT private.has_school_role(sm.school_id, ARRAY['school_admin']::public.membership_role[]))
      )
  )
);

CREATE POLICY staff_permissions_read_self_or_school_admin
ON public.staff_permissions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.school_memberships sm
    WHERE sm.id = staff_permissions.membership_id
      AND (
        sm.user_id = (SELECT auth.uid())
        OR (SELECT private.is_platform_admin())
        OR (SELECT private.has_school_role(sm.school_id, ARRAY['school_admin']::public.membership_role[]))
      )
  )
);

CREATE POLICY staff_permissions_admin_manage
ON public.staff_permissions
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.school_memberships sm
    WHERE sm.id = staff_permissions.membership_id
      AND (
        (SELECT private.is_platform_admin())
        OR (SELECT private.has_school_role(sm.school_id, ARRAY['school_admin']::public.membership_role[]))
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.school_memberships sm
    WHERE sm.id = staff_permissions.membership_id
      AND (
        (SELECT private.is_platform_admin())
        OR (SELECT private.has_school_role(sm.school_id, ARRAY['school_admin']::public.membership_role[]))
      )
  )
);

CREATE OR REPLACE FUNCTION private.has_staff_permission(
  target_school_id uuid,
  requested_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_memberships sm
    JOIN public.profiles p ON p.id = sm.user_id
    JOIN public.schools s ON s.id = sm.school_id
    JOIN public.staff_profiles sp ON sp.membership_id = sm.id
    JOIN public.staff_permissions perm ON perm.membership_id = sm.id
    WHERE sm.user_id = (SELECT auth.uid())
      AND sm.school_id = target_school_id
      AND sm.role = 'staff'::public.membership_role
      AND sm.status = 'active'
      AND p.is_active = true
      AND s.status = 'active'
      AND perm.permission_key = requested_permission
  );
$function$;

REVOKE ALL ON FUNCTION private.has_staff_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_staff_permission(uuid, text) TO authenticated;
