-- TagIn security hardening v1
-- Applied to Supabase project wlkqsivehfwogdquodxx on 2026-11-26.

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION private.is_guardian_of_student(uuid, uuid) FROM PUBLIC;

DROP POLICY IF EXISTS collectors_parent_insert_one_day ON public.authorized_collectors;
CREATE POLICY collectors_parent_insert_one_day
ON public.authorized_collectors
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT private.is_guardian_of_student(authorized_collectors.student_id, authorized_collectors.school_id))
  AND created_by = (SELECT auth.uid())
  AND standing = false
  AND valid_on = CURRENT_DATE
);

DROP POLICY IF EXISTS collectors_parent_update_own_one_day ON public.authorized_collectors;
CREATE POLICY collectors_parent_update_own_one_day
ON public.authorized_collectors
FOR UPDATE TO authenticated
USING (
  (SELECT private.is_guardian_of_student(authorized_collectors.student_id, authorized_collectors.school_id))
  AND created_by = (SELECT auth.uid())
  AND standing = false
  AND valid_on = CURRENT_DATE
)
WITH CHECK (
  (SELECT private.is_guardian_of_student(authorized_collectors.student_id, authorized_collectors.school_id))
  AND created_by = (SELECT auth.uid())
  AND standing = false
  AND valid_on = CURRENT_DATE
);
