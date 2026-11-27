-- The public RPC must execute with the owner's privileges to call the
-- private SECURITY DEFINER implementation, which performs its own auth.uid()
-- and school/platform-admin authorization checks.
create or replace function public.record_audit_export_attempt(
  p_school_id uuid,
  p_format text,
  p_record_count integer,
  p_filters jsonb,
  p_success boolean
) returns void
language sql
security definer
set search_path = ''
as $$
  select private.record_audit_export_attempt(
    p_school_id, p_format, p_record_count, p_filters, p_success
  );
$$;

revoke all on function public.record_audit_export_attempt(uuid,text,integer,jsonb,boolean) from public, anon;
grant execute on function public.record_audit_export_attempt(uuid,text,integer,jsonb,boolean) to authenticated;
