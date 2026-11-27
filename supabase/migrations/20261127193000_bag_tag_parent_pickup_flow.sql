alter table public.tags add column if not exists tag_type text not null default 'bag';
alter table public.tags drop constraint if exists tags_tag_type_check;
alter table public.tags add constraint tags_tag_type_check check (tag_type in ('bag','parent'));

create or replace function private.issue_parent_student_qr(p_student_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='public','auth' as $function$
declare v_student public.students%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_token_hash is null or length(p_token_hash)<>64 then raise exception 'Invalid QR pass'; end if;
 select s.* into v_student from public.students s where s.id=p_student_id and s.active=true
 and exists(select 1 from public.guardians g join public.student_guardians sg on sg.guardian_id=g.id and sg.school_id=g.school_id
 where g.user_id=auth.uid() and g.school_id=s.school_id and sg.student_id=s.id) limit 1;
 if not found then raise exception 'This child is not linked to your family account or is inactive'; end if;
 update public.tags set status='revoked',revoked_at=now() where school_id=v_student.school_id and student_id=v_student.id and status='active' and tag_type='parent';
 insert into public.tags(school_id,student_id,token_hash,status,tag_type) values(v_student.school_id,v_student.id,p_token_hash,'active','parent');
 return jsonb_build_object('id',v_student.id,'full_name',v_student.full_name,'class_name',v_student.class_name);
end; $function$;

create or replace function private.create_parent_pickup(p_school_id uuid,p_student_id uuid,p_full_name text,p_relationship text,p_phone text,p_photo_path text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_id uuid; v_expires timestamptz;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='28000'; end if;
 if length(btrim(coalesce(p_full_name,''))) not between 2 and 160 then raise exception 'Enter the full name of the pickup person.' using errcode='22023'; end if;
 if p_token_hash is not null and length(p_token_hash)<>64 then raise exception 'Invalid pickup pass.' using errcode='22023'; end if;
 if p_photo_path is null or p_photo_path !~ ('^'||p_school_id::text||'/'||p_student_id::text||'/[A-Za-z0-9._-]+$') then raise exception 'Upload a valid pickup photo.' using errcode='22023'; end if;
 if not private.is_guardian_of_student(p_student_id,p_school_id) then raise exception 'You are not linked to this student.' using errcode='42501'; end if;
 if not exists(select 1 from public.students s where s.id=p_student_id and s.school_id=p_school_id and s.active=true) then raise exception 'Active student not found.' using errcode='P0002'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='tagin-pickup-photos' and o.name=p_photo_path) then raise exception 'Pickup photo upload could not be found.' using errcode='P0002'; end if;
 update public.authorized_collectors set expires_at=now(),token_hash=null where school_id=p_school_id and student_id=p_student_id and created_by=auth.uid() and standing=false and used_at is null and expires_at>now();
 v_expires:=now()+interval '12 hours';
 insert into public.authorized_collectors(school_id,student_id,full_name,relationship,photo_path,phone,standing,valid_on,created_by,token_hash,expires_at)
 values(p_school_id,p_student_id,btrim(p_full_name),nullif(btrim(coalesce(p_relationship,'')),''),p_photo_path,nullif(btrim(coalesce(p_phone,'')),''),false,current_date,auth.uid(),p_token_hash,v_expires)
 returning id into v_id;
 return jsonb_build_object('id',v_id,'expires_at',v_expires);
end; $f$;

create or replace function private.preview_student_pickup(p_school_id uuid,p_student_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v record;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='28000'; end if;
 if not(private.is_platform_admin() or private.has_school_role(p_school_id,array['school_admin','gate_staff']::public.membership_role[])
 or private.has_staff_permission(p_school_id,'gate.verify_collector') or private.has_staff_permission(p_school_id,'gate.scan')
 or private.has_staff_permission(p_school_id,'gate.check_out')) then raise exception 'You are not permitted to verify student collection for this school.' using errcode='42501'; end if;
 select ac.id,ac.full_name as collector_name,ac.relationship,ac.phone,ac.photo_path,ac.expires_at into v
 from public.authorized_collectors ac where ac.school_id=p_school_id and ac.student_id=p_student_id
 and ac.standing=false and ac.valid_on=current_date and ac.used_at is null and ac.expires_at>now()
 order by ac.created_at desc limit 1;
 if not found then return jsonb_build_object('has_authorized_collector',false); end if;
 return jsonb_build_object('has_authorized_collector',true,'collector_id',v.id,'collector_name',v.collector_name,
 'relationship',v.relationship,'phone',v.phone,'photo_path',v.photo_path,'expires_at',v.expires_at);
end; $f$;

create or replace function private.record_student_checkout(p_school_id uuid,p_student_id uuid,p_collected_by_type text,p_collected_by_name text,p_authorized_collector_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_actor uuid:=auth.uid(); v_latest text; v_collector public.authorized_collectors%rowtype; v_event public.scan_events%rowtype;
begin
 if v_actor is null then raise exception 'Authentication required.' using errcode='28000'; end if;
 if p_collected_by_type not in ('parent','authorised_pickup') then raise exception 'Invalid collection type.' using errcode='22023'; end if;
 if nullif(btrim(coalesce(p_collected_by_name,'')),'') is null then raise exception 'Enter the name of the person collecting the student.' using errcode='22023'; end if;
 if not(private.is_platform_admin() or private.has_school_role(p_school_id,array['school_admin','gate_staff']::public.membership_role[])
 or private.has_staff_permission(p_school_id,'gate.scan') or private.has_staff_permission(p_school_id,'gate.check_out')) then
 raise exception 'You are not permitted to record student collection for this school.' using errcode='42501'; end if;
 perform 1 from public.students s where s.id=p_student_id and s.school_id=p_school_id and s.active=true for update;
 if not found then raise exception 'Active student not found in this school.' using errcode='P0002'; end if;
 select e.event_type into v_latest from public.scan_events e where e.school_id=p_school_id and e.student_id=p_student_id
 and e.event_type in('check_in','check_out') order by e.created_at desc,e.id desc limit 1;
 if v_latest is distinct from 'check_in' then raise exception 'This student does not have an active school check-in.' using errcode='23514'; end if;
 if p_collected_by_type='authorised_pickup' then
  select * into v_collector from public.authorized_collectors ac where ac.id=p_authorized_collector_id and ac.school_id=p_school_id
  and ac.student_id=p_student_id and ac.standing=false and ac.valid_on=current_date and ac.used_at is null and ac.expires_at>now() for update;
  if not found then raise exception 'The assigned pickup authorisation is no longer active. Refresh the student record.' using errcode='22023'; end if;
  if btrim(p_collected_by_name)<>v_collector.full_name then raise exception 'The pickup name does not match the parent authorisation.' using errcode='22023'; end if;
  update public.authorized_collectors set used_at=now() where id=v_collector.id;
 else
  if p_authorized_collector_id is not null then raise exception 'Parent collection cannot use a pickup authorisation.' using errcode='22023'; end if;
  update public.authorized_collectors set used_at=now() where school_id=p_school_id and student_id=p_student_id
  and standing=false and valid_on=current_date and used_at is null and expires_at>now();
 end if;
 insert into public.scan_events(school_id,student_id,event_type,collected_by_type,collected_by_name,scanned_by)
 values(p_school_id,p_student_id,'check_out',p_collected_by_type,btrim(p_collected_by_name),v_actor) returning * into v_event;
 return jsonb_build_object('event_id',v_event.id,'event_type',v_event.event_type,'collected_by_type',v_event.collected_by_type,'collected_by_name',v_event.collected_by_name);
end; $f$;

grant usage on schema private to authenticated;
revoke all on function private.preview_student_pickup(uuid,uuid),private.record_student_checkout(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function private.preview_student_pickup(uuid,uuid),private.record_student_checkout(uuid,uuid,text,text,uuid) to authenticated;
create or replace function public.preview_student_pickup(p_school_id uuid,p_student_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.preview_student_pickup(p_school_id,p_student_id); $$;
create or replace function public.record_student_checkout(p_school_id uuid,p_student_id uuid,p_collected_by_type text,p_collected_by_name text,p_authorized_collector_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.record_student_checkout(p_school_id,p_student_id,p_collected_by_type,p_collected_by_name,p_authorized_collector_id); $$;
revoke all on function public.preview_student_pickup(uuid,uuid),public.record_student_checkout(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.preview_student_pickup(uuid,uuid),public.record_student_checkout(uuid,uuid,text,text,uuid) to authenticated;