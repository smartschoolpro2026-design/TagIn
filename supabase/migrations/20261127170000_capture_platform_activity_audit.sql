create or replace function private.capture_activity_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_school uuid;
  v_entity_id text;
  v_actor uuid := auth.uid();
  v_changed text[] := array[]::text[];
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_key text;
  v_safe_keys text[] := array['full_name','name','class_name','level','active','is_active','status','role','platform_role','relationship','is_primary','job_title','permission_key','event_type','collected_by_type','collected_by_name','standing','valid_on','tag_type','slug','score','grade','title','starts_at','ends_at'];
  v_action text;
  v_entity text := tg_table_name;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_school := nullif(coalesce(v_new->>'school_id', v_old->>'school_id'), '')::uuid;
  if tg_table_name = 'schools' then v_school := coalesce(nullif(v_new->>'id','')::uuid, nullif(v_old->>'id','')::uuid); end if;
  v_entity_id := coalesce(v_new->>'id', v_old->>'id', v_new->>'student_id', v_old->>'student_id', v_new->>'membership_id', v_old->>'membership_id', v_new->>'user_id', v_old->>'user_id', v_new->>'guardian_id', v_old->>'guardian_id');
  foreach v_key in array v_safe_keys loop
    if (v_old ? v_key) or (v_new ? v_key) then
      if v_old->v_key is distinct from v_new->v_key then
        v_changed := array_append(v_changed, v_key);
        if v_old ? v_key then v_before := v_before || jsonb_build_object(v_key, v_old->v_key); end if;
        if v_new ? v_key then v_after := v_after || jsonb_build_object(v_key, v_new->v_key); end if;
      end if;
    end if;
  end loop;
  v_action := lower(tg_table_name) || '.' || lower(tg_op);
  insert into public.audit_logs(school_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_school, v_actor, v_action, v_entity, v_entity_id, jsonb_build_object('source','database_trigger','operation',tg_op,'changed_fields',to_jsonb(v_changed),'before',v_before,'after',v_after));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.capture_activity_audit() from public, anon, authenticated;
do $$
declare t text; tables_to_audit text[] := array['students','guardians','student_guardians','school_memberships','profiles','staff_profiles','staff_permissions','scan_events','authorized_collectors','tags','schools','assessments','assessment_scores','timetable_entries','transport_events','transport_routes','transport_vehicles','transport_stops','transport_route_drivers','transport_route_students','notifications'];
begin
 foreach t in array tables_to_audit loop
  if to_regclass('public.' || t) is not null and not exists (select 1 from pg_trigger tr join pg_class c on c.oid=tr.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=t and tr.tgname='capture_activity_audit' and not tr.tgisinternal) then
   execute format('create trigger capture_activity_audit after insert or update or delete on public.%I for each row execute function private.capture_activity_audit()',t);
  end if;
 end loop;
end;
$$;