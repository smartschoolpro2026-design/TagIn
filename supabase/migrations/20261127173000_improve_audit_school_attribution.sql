create or replace function private.capture_activity_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
 v_old jsonb := '{}'::jsonb; v_new jsonb := '{}'::jsonb; v_school uuid;
 v_entity_id text; v_actor uuid := auth.uid(); v_changed text[] := array[]::text[];
 v_before jsonb := '{}'::jsonb; v_after jsonb := '{}'::jsonb; v_key text;
 v_safe_keys text[] := array['id','full_name','name','class_name','level','active','is_active','status','role','platform_role','relationship','is_primary','job_title','permission_key','event_type','collected_by_type','collected_by_name','standing','valid_on','tag_type','slug','score','grade','title','starts_at','ends_at','student_id','guardian_id','membership_id','user_id'];
 v_action text; v_entity text := tg_table_name; v_target uuid;
begin
 if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
 if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
 v_school := nullif(coalesce(v_new->>'school_id',v_old->>'school_id'),'')::uuid;
 if tg_table_name='schools' then v_school:=coalesce(nullif(v_new->>'id','')::uuid,nullif(v_old->>'id','')::uuid); end if;
 if tg_table_name='profiles' then
  v_target:=coalesce(nullif(v_new->>'id','')::uuid,nullif(v_old->>'id','')::uuid);
  select sm.school_id into v_school from public.school_memberships sm where sm.user_id=v_target order by sm.created_at limit 1;
 elsif tg_table_name in ('staff_profiles','staff_permissions') then
  select sm.school_id into v_school from public.school_memberships sm where sm.id=coalesce(nullif(v_new->>'membership_id','')::uuid,nullif(v_old->>'membership_id','')::uuid);
 end if;
 v_entity_id:=coalesce(v_new->>'id',v_old->>'id',v_new->>'student_id',v_old->>'student_id',v_new->>'membership_id',v_old->>'membership_id',v_new->>'user_id',v_old->>'user_id',v_new->>'guardian_id',v_old->>'guardian_id');
 foreach v_key in array v_safe_keys loop
  if (v_old ? v_key) or (v_new ? v_key) then
   if v_old->v_key is distinct from v_new->v_key then
    v_changed:=array_append(v_changed,v_key);
    if v_old ? v_key then v_before:=v_before||jsonb_build_object(v_key,v_old->v_key); end if;
    if v_new ? v_key then v_after:=v_after||jsonb_build_object(v_key,v_new->v_key); end if;
   end if;
  end if;
 end loop;
 v_action:=lower(tg_table_name)||'.'||lower(tg_op);
 insert into public.audit_logs(school_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(v_school,v_actor,v_action,v_entity,v_entity_id,jsonb_build_object('source','database_trigger','operation',tg_op,'changed_fields',to_jsonb(v_changed),'before',v_before,'after',v_after));
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;