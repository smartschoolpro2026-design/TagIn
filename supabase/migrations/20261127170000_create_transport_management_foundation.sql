-- Transport Management foundation for TagIn.
-- Transport records are isolated from school attendance; bus actions never write scan_events.

create table public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  registration_number text not null check (length(trim(registration_number)) between 2 and 24),
  vehicle_name text,
  capacity integer not null check (capacity between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, registration_number)
);

create table public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 100),
  direction text not null default 'both' check (direction in ('morning','afternoon','both')),
  vehicle_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  foreign key (school_id, vehicle_id) references public.transport_vehicles(school_id, id) on delete restrict
);

create table public.transport_stops (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  route_id uuid not null,
  stop_name text not null check (length(trim(stop_name)) between 2 and 120),
  stop_order integer not null check (stop_order > 0),
  scheduled_time time,
  created_at timestamptz not null default now(),
  unique (school_id, id),
  unique (route_id, stop_order),
  foreign key (school_id, route_id) references public.transport_routes(school_id, id) on delete cascade
);

create table public.transport_route_drivers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  route_id uuid not null,
  membership_id uuid not null references public.school_memberships(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (route_id, membership_id),
  foreign key (school_id, route_id) references public.transport_routes(school_id, id) on delete cascade
);

create table public.transport_route_students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  route_id uuid not null,
  student_id uuid not null,
  pickup_stop_id uuid,
  dropoff_stop_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (route_id, student_id),
  foreign key (school_id, route_id) references public.transport_routes(school_id, id) on delete cascade,
  foreign key (student_id, school_id) references public.students(id, school_id) on delete restrict,
  foreign key (school_id, pickup_stop_id) references public.transport_stops(school_id, id) on delete restrict,
  foreign key (school_id, dropoff_stop_id) references public.transport_stops(school_id, id) on delete restrict
);

create table public.transport_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  route_id uuid not null,
  student_id uuid not null,
  vehicle_id uuid,
  stop_id uuid,
  event_type text not null check (event_type in ('picked_up','dropped_off','missed','incident')),
  note text check (note is null or length(note) <= 500),
  scanned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (school_id, route_id) references public.transport_routes(school_id, id) on delete restrict,
  foreign key (student_id, school_id) references public.students(id, school_id) on delete restrict,
  foreign key (school_id, vehicle_id) references public.transport_vehicles(school_id, id) on delete restrict,
  foreign key (school_id, stop_id) references public.transport_stops(school_id, id) on delete restrict
);

create index transport_routes_school_active_idx on public.transport_routes(school_id, active);
create index transport_route_students_route_active_idx on public.transport_route_students(route_id, active);
create index transport_events_school_created_idx on public.transport_events(school_id, created_at desc);
create index transport_events_student_route_created_idx on public.transport_events(student_id, route_id, created_at desc);

alter table public.transport_vehicles enable row level security;
alter table public.transport_routes enable row level security;
alter table public.transport_stops enable row level security;
alter table public.transport_route_drivers enable row level security;
alter table public.transport_route_students enable row level security;
alter table public.transport_events enable row level security;

create policy transport_vehicles_read_school on public.transport_vehicles for select to authenticated
using (
  private.is_platform_admin()
  or private.has_school_role(school_id, array['school_admin']::membership_role[])
  or exists (
    select 1 from public.transport_routes r
    join public.transport_route_drivers rd on rd.route_id = r.id
    join public.school_memberships sm on sm.id = rd.membership_id
    where r.vehicle_id = transport_vehicles.id and r.school_id = transport_vehicles.school_id
      and rd.active and sm.user_id = (select auth.uid()) and sm.status = 'active'
  )
);
create policy transport_vehicles_admin_manage on public.transport_vehicles for all to authenticated
using (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]))
with check (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]));

create policy transport_routes_read_school on public.transport_routes for select to authenticated
using (
  private.is_platform_admin()
  or private.has_school_role(school_id, array['school_admin']::membership_role[])
  or exists (
    select 1 from public.transport_route_drivers rd
    join public.school_memberships sm on sm.id = rd.membership_id
    where rd.route_id = transport_routes.id and rd.active
      and sm.user_id = (select auth.uid()) and sm.status = 'active'
  )
);
create policy transport_routes_admin_manage on public.transport_routes for all to authenticated
using (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]))
with check (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]));

create policy transport_stops_read_school on public.transport_stops for select to authenticated
using (
  private.is_platform_admin()
  or private.has_school_role(school_id, array['school_admin']::membership_role[])
  or exists (
    select 1 from public.transport_route_drivers rd
    join public.school_memberships sm on sm.id = rd.membership_id
    where rd.route_id = transport_stops.route_id and rd.active
      and sm.user_id = (select auth.uid()) and sm.status = 'active'
  )
);
create policy transport_stops_admin_manage on public.transport_stops for all to authenticated
using (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]))
with check (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]));

create policy transport_route_drivers_read_related on public.transport_route_drivers for select to authenticated
using (
  private.is_platform_admin()
  or private.has_school_role(school_id, array['school_admin']::membership_role[])
  or exists (
    select 1 from public.school_memberships sm
    where sm.id = membership_id and sm.user_id = (select auth.uid())
      and sm.status = 'active' and sm.role = 'bus_staff'
  )
);
create policy transport_route_drivers_admin_manage on public.transport_route_drivers for all to authenticated
using (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]))
with check (
  (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]))
  and exists (
    select 1 from public.school_memberships sm
    where sm.id = membership_id and sm.school_id = transport_route_drivers.school_id
      and sm.status = 'active' and sm.role = 'bus_staff'
  )
);

create policy transport_route_students_read_assigned on public.transport_route_students for select to authenticated
using (
  private.is_platform_admin()
  or private.has_school_role(school_id, array['school_admin']::membership_role[])
  or exists (
    select 1 from public.transport_route_drivers rd
    join public.school_memberships sm on sm.id = rd.membership_id
    where rd.route_id = transport_route_students.route_id and rd.active
      and sm.user_id = (select auth.uid()) and sm.status = 'active'
  )
);
create policy transport_route_students_admin_manage on public.transport_route_students for all to authenticated
using (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]))
with check (private.is_platform_admin() or private.has_school_role(school_id, array['school_admin']::membership_role[]));

create policy transport_events_read_assigned on public.transport_events for select to authenticated
using (
  private.is_platform_admin()
  or private.has_school_role(school_id, array['school_admin']::membership_role[])
  or exists (
    select 1 from public.transport_route_drivers rd
    join public.school_memberships sm on sm.id = rd.membership_id
    where rd.route_id = transport_events.route_id and rd.active
      and sm.user_id = (select auth.uid()) and sm.status = 'active'
  )
);

revoke all on public.transport_events from anon, authenticated;
grant select on public.transport_events to authenticated;
grant select, insert, update on public.transport_vehicles, public.transport_routes, public.transport_stops, public.transport_route_drivers, public.transport_route_students to authenticated;

create or replace function public.record_transport_event(
  p_school_id uuid, p_route_id uuid, p_student_id uuid, p_event_type text,
  p_stop_id uuid default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_vehicle_id uuid;
  v_event_id uuid;
  v_last_event text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_event_type not in ('picked_up','dropped_off','missed','incident') then raise exception 'Invalid transport event'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'Note is too long'; end if;

  select sm.id into v_membership_id from public.school_memberships sm
  where sm.school_id = p_school_id and sm.user_id = v_user_id
    and sm.role = 'bus_staff' and sm.status = 'active' limit 1;
  if v_membership_id is null then raise exception 'Active driver account required'; end if;

  select r.vehicle_id into v_vehicle_id
  from public.transport_routes r
  join public.transport_route_drivers rd on rd.route_id = r.id
  where r.id = p_route_id and r.school_id = p_school_id and r.active
    and rd.membership_id = v_membership_id and rd.school_id = p_school_id and rd.active;
  if not found then raise exception 'This route is not assigned to your driver account'; end if;

  if not exists (
    select 1 from public.transport_route_students rs
    join public.students s on s.id = rs.student_id and s.school_id = rs.school_id
    where rs.school_id = p_school_id and rs.route_id = p_route_id
      and rs.student_id = p_student_id and rs.active and s.active
  ) then raise exception 'Student is not active on this route'; end if;

  if p_stop_id is not null and not exists (
    select 1 from public.transport_stops ts
    where ts.id = p_stop_id and ts.school_id = p_school_id and ts.route_id = p_route_id
  ) then raise exception 'Stop does not belong to this route'; end if;

  if p_event_type in ('picked_up','dropped_off') then
    perform 1 from public.students s where s.id = p_student_id and s.school_id = p_school_id for update;
    select te.event_type into v_last_event from public.transport_events te
    where te.school_id = p_school_id and te.route_id = p_route_id and te.student_id = p_student_id
      and te.event_type in ('picked_up','dropped_off')
      and te.created_at::date = (now() at time zone 'utc')::date
    order by te.created_at desc limit 1;
    if p_event_type = 'picked_up' and v_last_event = 'picked_up' then raise exception 'Student is already recorded as picked up for this journey'; end if;
    if p_event_type = 'dropped_off' and v_last_event is distinct from 'picked_up' then raise exception 'Student must be picked up before drop-off'; end if;
  end if;

  insert into public.transport_events(school_id,route_id,student_id,vehicle_id,stop_id,event_type,note,scanned_by)
  values(p_school_id,p_route_id,p_student_id,v_vehicle_id,p_stop_id,p_event_type,nullif(trim(p_note),''),v_user_id)
  returning id into v_event_id;

  insert into public.audit_logs(school_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_school_id,v_user_id,'transport.' || p_event_type,'transport_event',v_event_id::text,
    jsonb_build_object('route_id',p_route_id,'student_id',p_student_id,'stop_id',p_stop_id));
  return v_event_id;
end;
$$;
revoke all on function public.record_transport_event(uuid,uuid,uuid,text,uuid,text) from public, anon;
grant execute on function public.record_transport_event(uuid,uuid,uuid,text,uuid,text) to authenticated;
