create table if not exists public.student_profiles (
 student_id uuid primary key references public.students(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 date_of_birth date,
 home_address text,
 emergency_contact_name text,
 emergency_contact_phone text,
 emergency_contact_relationship text,
 medical_alerts text,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint student_profiles_school_student_unique unique(school_id,student_id),
 constraint student_profiles_emergency_name_length check(emergency_contact_name is null or length(emergency_contact_name)<=160),
 constraint student_profiles_medical_alerts_length check(medical_alerts is null or length(medical_alerts)<=4000)
);
create index if not exists student_profiles_school_idx on public.student_profiles(school_id);
create table if not exists public.student_incidents (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 incident_date date not null default current_date,
 category text not null check(category in ('behaviour','safeguarding','academic','health','other')),
 description text not null,
 action_taken text,
 follow_up_date date,
 status text not null default 'open' check(status in ('open','monitoring','resolved')),
 recorded_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint student_incidents_description_length check(length(trim(description)) between 3 and 4000),
 constraint student_incidents_school_student_unique unique(school_id,id)
);
create index if not exists student_incidents_student_date_idx on public.student_incidents(school_id,student_id,incident_date desc);
alter table public.student_profiles enable row level security;
alter table public.student_incidents enable row level security;
create policy student_profiles_admin_manage on public.student_profiles for all to authenticated
using(private.has_school_role(student_profiles.school_id,array['school_admin'::public.membership_role]))
with check(private.has_school_role(student_profiles.school_id,array['school_admin'::public.membership_role]) and exists(select 1 from public.students s where s.id=student_profiles.student_id and s.school_id=student_profiles.school_id));
create policy student_incidents_admin_manage on public.student_incidents for all to authenticated
using(private.has_school_role(student_incidents.school_id,array['school_admin'::public.membership_role]))
with check(private.has_school_role(student_incidents.school_id,array['school_admin'::public.membership_role]) and exists(select 1 from public.students s where s.id=student_incidents.student_id and s.school_id=student_incidents.school_id));
grant select,insert,update,delete on public.student_profiles to authenticated;
grant select,insert,update,delete on public.student_incidents to authenticated;


create table if not exists public.student_document_records (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 document_type text not null check(document_type in ('birth_certificate','previous_report','transfer_certificate','identity_record','medical_record','other')),
 title text not null,
 reference_number text,
 issued_on date,
 expires_on date,
 notes text,
 recorded_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 constraint student_document_title_length check(length(trim(title)) between 2 and 160),
 constraint student_document_notes_length check(notes is null or length(notes)<=2000)
);
create index if not exists student_documents_student_idx on public.student_document_records(school_id,student_id,created_at desc);
alter table public.student_document_records enable row level security;
create policy student_documents_admin_manage on public.student_document_records for all to authenticated
using(private.has_school_role(student_document_records.school_id,array['school_admin'::public.membership_role]))
with check(private.has_school_role(student_document_records.school_id,array['school_admin'::public.membership_role]) and exists(select 1 from public.students s where s.id=student_document_records.student_id and s.school_id=student_document_records.school_id));
grant select,insert,update,delete on public.student_document_records to authenticated;
