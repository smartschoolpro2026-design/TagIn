-- The demo seeder runs only after verifying the caller is an active Platform Admin.
-- Restore the standard backend service-role table privileges required by Supabase Edge Functions.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant usage on schema private to service_role;
grant all privileges on all tables in schema private to service_role;
grant all privileges on all sequences in schema private to service_role;
