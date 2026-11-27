create or replace function private.get_next_transport_action(p_school_id uuid,p_route_id uuid,p_student_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid(); v_membership_id uuid; v_last_event text; v_last_event_at timestamptz; v_attendance text; v_attendance_at timestamptz;
begin
 if v_user_id is null then raise exception 'Authentication required'; end if;
 select sm.id into v_membership_id from public.school_memberships sm
 where sm.school_id=p_school_id and sm.user_id=v_user_id and sm.role='bus_staff' and sm.status='active' limit 1;
 if v_membership_id is null or not exists(select 1 from public.transport_route_drivers rd join public.transport_routes r on r.id=rd.route_id and r.school_id=rd.school_id
 where rd.school_id=p_school_id and rd.route_id=p_route_id and rd.membership_id=v_membership_id and rd.active and r.active)
 then raise exception 'This route is not assigned to your bus staff account'; end if;
 if not exists(select 1 from public.transport_route_students rs join public.students s on s.id=rs.student_id and s.school_id=rs.school_id
 where rs.school_id=p_school_id and rs.route_id=p_route_id and rs.student_id=p_student_id and rs.active and s.active)
 then raise exception 'Student is not active on this route'; end if;
 select te.event_type,te.created_at into v_last_event,v_last_event_at from public.transport_events te
 where te.school_id=p_school_id and te.route_id=p_route_id and te.student_id=p_student_id
 and te.event_type in ('picked_up','arrived_at_school','boarded_at_school','dropped_off_at_home','dropped_off')
 and te.created_at>=date_trunc('day',now()) order by te.created_at desc,te.id desc limit 1;
 if v_last_event='picked_up' then return 'arrived_at_school';
 elsif v_last_event='arrived_at_school' then
  select se.event_type,se.created_at into v_attendance,v_attendance_at from public.scan_events se
  where se.school_id=p_school_id and se.student_id=p_student_id and se.event_type in ('check_in','check_out')
  order by se.created_at desc,se.id desc limit 1;
  if v_attendance='check_out' and v_attendance_at>v_last_event_at then return 'boarded_at_school'; end if;
  raise exception 'Gate staff must check the student out of school before bus boarding';
 elsif v_last_event='boarded_at_school' then return 'dropped_off_at_home';
 elsif v_last_event in ('dropped_off_at_home','dropped_off') then raise exception 'This student has completed the transport journey for today';
 else
  select se.event_type,se.created_at into v_attendance,v_attendance_at from public.scan_events se
  where se.school_id=p_school_id and se.student_id=p_student_id and se.event_type in ('check_in','check_out')
  order by se.created_at desc,se.id desc limit 1;
  if v_attendance='check_out' and v_attendance_at>=date_trunc('day',now()) then return 'boarded_at_school'; end if;
  return 'picked_up';
 end if;
end; $$;
revoke all on function private.get_next_transport_action(uuid,uuid,uuid) from public,anon;
grant execute on function private.get_next_transport_action(uuid,uuid,uuid) to authenticated;
create or replace function public.get_next_transport_action(p_school_id uuid,p_route_id uuid,p_student_id uuid)
returns text language sql set search_path='' as $$ select private.get_next_transport_action(p_school_id,p_route_id,p_student_id); $$;
revoke all on function public.get_next_transport_action(uuid,uuid,uuid) from public,anon;
grant execute on function public.get_next_transport_action(uuid,uuid,uuid) to authenticated;
