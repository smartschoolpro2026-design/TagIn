alter table public.transport_route_drivers
  add column if not exists assignment_type text not null default 'driver';

alter table public.transport_route_drivers
  drop constraint if exists transport_route_drivers_assignment_type_check;
alter table public.transport_route_drivers
  add constraint transport_route_drivers_assignment_type_check
  check (assignment_type in ('driver','assistant'));

alter table public.transport_events
  drop constraint if exists transport_events_event_type_check;
alter table public.transport_events
  add constraint transport_events_event_type_check
  check (event_type in ('picked_up','arrived_at_school','boarded_at_school','dropped_off_at_home','dropped_off','missed','incident'));

create or replace function private.record_transport_event(
  p_school_id uuid,p_route_id uuid,p_student_id uuid,p_event_type text,
  p_stop_id uuid default null,p_note text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_membership_id uuid; v_vehicle_id uuid;
  v_event_id uuid; v_last_event text; v_last_event_at timestamptz;
  v_last_attendance text; v_last_attendance_at timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_user_id and p.is_active) then raise exception 'Active account required'; end if;
  if p_event_type not in ('picked_up','arrived_at_school','boarded_at_school','dropped_off_at_home','dropped_off','missed','incident') then raise exception 'Invalid transport event'; end if;
  if p_note is not null and length(p_note)>500 then raise exception 'Note is too long'; end if;
  select sm.id into v_membership_id from public.school_memberships sm
  where sm.school_id=p_school_id and sm.user_id=v_user_id and sm.role='bus_staff' and sm.status='active' limit 1;
  if v_membership_id is null then raise exception 'Active bus staff account required'; end if;
  select r.vehicle_id into v_vehicle_id from public.transport_routes r
  join public.transport_route_drivers rd on rd.route_id=r.id
  where r.id=p_route_id and r.school_id=p_school_id and r.active
    and rd.membership_id=v_membership_id and rd.school_id=p_school_id and rd.active;
  if not found then raise exception 'This route is not assigned to your driver or assistant account'; end if;
  if not exists(select 1 from public.transport_route_students rs join public.students s on s.id=rs.student_id and s.school_id=rs.school_id
    where rs.school_id=p_school_id and rs.route_id=p_route_id and rs.student_id=p_student_id and rs.active and s.active)
    then raise exception 'Student is not active on this route'; end if;
  if p_stop_id is not null and not exists(select 1 from public.transport_stops ts where ts.id=p_stop_id and ts.school_id=p_school_id and ts.route_id=p_route_id)
    then raise exception 'Stop does not belong to this route'; end if;
  perform 1 from public.students s where s.id=p_student_id and s.school_id=p_school_id for update;
  select te.event_type,te.created_at into v_last_event,v_last_event_at from public.transport_events te
  where te.school_id=p_school_id and te.route_id=p_route_id and te.student_id=p_student_id
    and te.event_type in ('picked_up','arrived_at_school','boarded_at_school','dropped_off_at_home','dropped_off')
    and te.created_at>=date_trunc('day',now()) order by te.created_at desc,te.id desc limit 1;
  if p_event_type='picked_up' and v_last_event is not null and v_last_event not in ('dropped_off_at_home','dropped_off') then
    raise exception 'This student already has an active transport journey'; end if;
  if p_event_type='arrived_at_school' and v_last_event is distinct from 'picked_up' then raise exception 'Record the home pickup before school arrival'; end if;
  if p_event_type='boarded_at_school' then
    if v_last_event is not null and v_last_event not in ('arrived_at_school') then raise exception 'The student must complete the school arrival stage before boarding'; end if;
    select se.event_type,se.created_at into v_last_attendance,v_last_attendance_at from public.scan_events se
    where se.school_id=p_school_id and se.student_id=p_student_id and se.event_type in ('check_in','check_out')
    order by se.created_at desc,se.id desc limit 1;
    if v_last_attendance is distinct from 'check_out' or v_last_attendance_at<date_trunc('day',now())
      or (v_last_event_at is not null and v_last_attendance_at<=v_last_event_at) then
      raise exception 'Gate staff must check the student out of school before bus boarding'; end if;
  end if;
  if p_event_type='dropped_off_at_home' and v_last_event is distinct from 'boarded_at_school' then raise exception 'Record school boarding before home drop-off'; end if;
  if p_event_type='dropped_off' and v_last_event is distinct from 'picked_up' then raise exception 'Student must be picked up before drop-off'; end if;
  insert into public.transport_events(school_id,route_id,student_id,vehicle_id,stop_id,event_type,note,scanned_by)
  values(p_school_id,p_route_id,p_student_id,v_vehicle_id,p_stop_id,p_event_type,nullif(trim(p_note),''),v_user_id)
  returning id into v_event_id;
  insert into public.audit_logs(school_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_school_id,v_user_id,'transport.'||p_event_type,'transport_event',v_event_id::text,jsonb_build_object('route_id',p_route_id,'student_id',p_student_id,'stop_id',p_stop_id));
  return v_event_id;
end; $$;
revoke all on function private.record_transport_event(uuid,uuid,uuid,text,uuid,text) from public,anon;
grant execute on function private.record_transport_event(uuid,uuid,uuid,text,uuid,text) to authenticated;
create or replace function public.record_transport_event(p_school_id uuid,p_route_id uuid,p_student_id uuid,p_event_type text,p_stop_id uuid default null,p_note text default null)
returns uuid language sql set search_path='' as $$ select private.record_transport_event(p_school_id,p_route_id,p_student_id,p_event_type,p_stop_id,p_note); $$;
revoke all on function public.record_transport_event(uuid,uuid,uuid,text,uuid,text) from public,anon;
grant execute on function public.record_transport_event(uuid,uuid,uuid,text,uuid,text) to authenticated;

drop policy if exists scan_events_staff_insert on public.scan_events;
create policy scan_events_staff_insert on public.scan_events for insert to authenticated with check (
 scanned_by=(select auth.uid()) and ((select private.is_platform_admin())
 or (select private.has_school_role(scan_events.school_id,array['school_admin','gate_staff']::public.membership_role[]))
 or (select private.has_staff_permission(scan_events.school_id,'gate.scan'))
 or (select private.has_staff_permission(scan_events.school_id,'gate.check_in'))
 or (select private.has_staff_permission(scan_events.school_id,'gate.check_out'))));
drop policy if exists scan_events_staff_read on public.scan_events;
create policy scan_events_staff_read on public.scan_events for select to authenticated using (
 (select private.is_platform_admin())
 or (select private.has_school_role(scan_events.school_id,array['school_admin','gate_staff']::public.membership_role[]))
 or (select private.has_staff_permission(scan_events.school_id,'gate.scan')));
drop policy if exists scan_events_staff_attendance_read on public.scan_events;
create policy scan_events_staff_attendance_read on public.scan_events for select to authenticated using (
 (select private.has_staff_permission(scan_events.school_id,'gate.check_in'))
 or (select private.has_staff_permission(scan_events.school_id,'gate.check_out')));
