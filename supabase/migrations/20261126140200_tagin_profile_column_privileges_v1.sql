-- Keep the forced-password-change flag server-managed.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (full_name) ON TABLE public.profiles TO authenticated;
