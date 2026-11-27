drop policy if exists tagin_pickup_photo_related_read on storage.objects;
create policy tagin_pickup_photo_related_read on storage.objects for select to authenticated
using(bucket_id='tagin-pickup-photos' and exists(
 select 1 from public.authorized_collectors ac where ac.photo_path=name and (
  private.is_guardian_of_student(ac.student_id,ac.school_id)
  or private.has_school_role(ac.school_id,array['school_admin','gate_staff']::public.membership_role[])
  or private.has_staff_permission(ac.school_id,'gate.verify_collector')
  or private.has_staff_permission(ac.school_id,'gate.scan')
  or private.has_staff_permission(ac.school_id,'gate.check_out')
 )));
create or replace function private.preview_student_pickup(p_school_id uuid,p_student_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v record; v_latest text;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='28000'; end if;
 if not(private.is_platform_admin() or private.has_school_role(p_school_id,array['school_admin','gate_staff']::public.membership_role[])
 or private.has_staff_permission(p_school_id,'gate.verify_collector') or private.has_staff_permission(p_school_id,'gate.scan')
 or private.has_staff_permission(p_school_id,'gate.check_out')) then
 raise exception 'You are not permitted to verify student collection for this school.' using errcode='42501'; end if;
 select e.event_type into v_latest from public.scan_events e where e.school_id=p_school_id and e.student_id=p_student_id
 and e.event_type in('check_in','check_out') order by e.created_at desc,e.id desc limit 1;
 select ac.id,ac.full_name as collector_name,ac.relationship,ac.phone,ac.photo_path,ac.expires_at into v
 from public.authorized_collectors ac where ac.school_id=p_school_id and ac.student_id=p_student_id
 and ac.standing=false and ac.valid_on=current_date and ac.used_at is null and ac.expires_at>now()
 order by ac.created_at desc limit 1;
 if not found then return jsonb_build_object('has_authorized_collector',false,'is_checked_in',v_latest='check_in'); end if;
 return jsonb_build_object('has_authorized_collector',true,'is_checked_in',v_latest='check_in',
 'collector_id',v.id,'collector_name',v.collector_name,'relationship',v.relationship,'phone',v.phone,
 'photo_path',v.photo_path,'expires_at',v.expires_at);
end; $f$;