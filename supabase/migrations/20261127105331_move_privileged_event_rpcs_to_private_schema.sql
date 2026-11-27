alter function public.record_attendance_event(uuid,uuid,text,text) set schema private;
alter function public.record_transport_event(uuid,uuid,uuid,text,uuid,text) set schema private;
grant usage on schema private to authenticated;
revoke all on function private.record_attendance_event(uuid,uuid,text,text) from public,anon;
revoke all on function private.record_transport_event(uuid,uuid,uuid,text,uuid,text) from public,anon;
grant execute on function private.record_attendance_event(uuid,uuid,text,text) to authenticated;
grant execute on function private.record_transport_event(uuid,uuid,uuid,text,uuid,text) to authenticated;
create or replace function public.record_attendance_event(p_school_id uuid,p_student_id uuid,p_event_type text,p_collected_by_name text default null)
returns public.scan_events language sql security invoker set search_path=''
as $$ select private.record_attendance_event(p_school_id,p_student_id,p_event_type,p_collected_by_name); $$;
create or replace function public.record_transport_event(p_school_id uuid,p_route_id uuid,p_student_id uuid,p_event_type text,p_stop_id uuid default null,p_note text default null)
returns uuid language sql security invoker set search_path=''
as $$ select private.record_transport_event(p_school_id,p_route_id,p_student_id,p_event_type,p_stop_id,p_note); $$;
revoke all on function public.record_attendance_event(uuid,uuid,text,text) from public,anon;
revoke all on function public.record_transport_event(uuid,uuid,uuid,text,uuid,text) from public,anon;
grant execute on function public.record_attendance_event(uuid,uuid,text,text) to authenticated;
grant execute on function public.record_transport_event(uuid,uuid,uuid,text,uuid,text) to authenticated;
