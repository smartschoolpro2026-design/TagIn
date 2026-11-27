create or replace function private.notify_guardians_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type not in ('check_in', 'check_out') then
    return new;
  end if;

  insert into public.notifications (user_id, student_id, message)
  select
    g.user_id,
    new.student_id,
    s.full_name || case
      when new.event_type = 'check_in' then ' has arrived at school.'
      else ' has departed from school.'
    end
  from public.student_guardians sg
  join public.guardians g
    on g.id = sg.guardian_id
   and g.school_id = sg.school_id
  join public.students s
    on s.id = sg.student_id
   and s.school_id = sg.school_id
  join public.profiles p
    on p.id = g.user_id
   and p.is_active = true
  where sg.student_id = new.student_id
    and sg.school_id = new.school_id;

  return new;
end;
$$;

revoke all on function private.notify_guardians_attendance() from public, anon, authenticated;

drop trigger if exists notify_guardians_after_attendance on public.scan_events;
create trigger notify_guardians_after_attendance
after insert on public.scan_events
for each row
execute function private.notify_guardians_attendance();
