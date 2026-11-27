grant usage on schema public to service_role;
grant select, insert, delete on table public.profiles to service_role;
grant select on table public.schools to service_role;
grant insert, delete on table public.school_memberships to service_role;
