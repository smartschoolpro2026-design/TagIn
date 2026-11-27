create or replace function public.record_attendance_event(p_school_id uuid,p_student_id uuid,p_event_type text,p_collected_by_name text default null)
returns public.scan_events language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid:=auth.uid(); v_student public.students%rowtype; v_latest text; v_event public.scan_events%rowtype;
begin
 if v_actor is null then raise exception 'Authentication required.' using errcode='28000'; end if;
 if p_event_type not in ('check_in','check_out') then raise exception 'Unsupported attendance action.' using errcode='22023'; end if;
 if p_event_type='check_out' and nullif(btrim(p_collected_by_name),'') is null then raise exception 'Enter the name of the person collecting the student.' using errcode='22023'; end if;
 if not (private.is_platform_admin() or private.has_school_role(p_school_id,array['school_admin','gate_staff']::public.membership_role[]) or private.has_staff_permission(p_school_id,'gate.scan') or (p_event_type='check_in' and private.has_staff_permission(p_school_id,'gate.check_in')) or (p_event_type='check_out' and private.has_staff_permission(p_school_id,'gate.check_out'))) then
  raise exception 'You are not permitted to record attendance for this school.' using errcode='42501';
 end if;
 select s.* into v_student from public.students s where s.id=p_student_id and s.school_id=p_school_id and s.active=true for update;
 if not found then raise exception 'Active student not found in this school.' using errcode='P0002'; end if;
 select e.event_type into v_latest from public.scan_events e where e.school_id=p_school_id and e.student_id=p_student_id and e.event_type in ('check_in','check_out') order by e.created_at desc,e.id desc limit 1;
 if p_event_type='check_in' and v_latest='check_in' then raise exception 'This student is already checked in.' using errcode='23505'; end if;
 if p_event_type='check_out' and v_latest is distinct from 'check_in' then raise exception 'This student does not have an active school check-in.' using errcode='23514'; end if;
 insert into public.scan_events(school_id,student_id,event_type,collected_by_name,scanned_by) values(p_school_id,p_student_id,p_event_type,case when p_event_type='check_out' then btrim(p_collected_by_name) else null end,v_actor) returning * into v_event;
 return v_event;
end;
$function$;
revoke all on function public.record_attendance_event(uuid,uuid,text,text) from public;
revoke all on function public.record_attendance_event(uuid,uuid,text,text) from anon;
grant execute on function public.record_attendance_event(uuid,uuid,text,text) to authenticated;
drop policy if exists scan_events_staff_attendance_read on public.scan_events;
create policy scan_events_staff_attendance_read on public.scan_events for select to authenticated using (private.has_staff_permission(school_id,'gate.check_in') or private.has_staff_permission(school_id,'gate.check_out'));
