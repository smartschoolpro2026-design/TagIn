-- Backfill student creation activity for records created before the audit trigger was installed.
-- The original creator cannot be recovered when no actor was stored, so mark it explicitly.
insert into public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
select s.school_id, null, 'students.insert', 'students', s.id::text,
  jsonb_build_object(
    'source', 'historical_backfill',
    'historical_unattributed', true,
    'operation', 'INSERT',
    'changed_fields', jsonb_build_array('full_name', 'class_name'),
    'before', '{}'::jsonb,
    'after', jsonb_build_object('id', s.id, 'full_name', s.full_name, 'class_name', s.class_name)
  ),
  s.created_at
from public.students s
where not exists (
  select 1 from public.audit_logs a
  where a.entity_type = 'students'
    and a.entity_id = s.id::text
    and a.action = 'students.insert'
);
