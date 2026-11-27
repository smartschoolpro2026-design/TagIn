create table if not exists public.student_profiles (
 student_id uuid primary key references public.students(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete cascade,
 date_of_birth date, home_address text, emergency_contact_name text, emergency_contact_phone text,
 emergency_contact_relationship text, medical_alerts text,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint student_profiles_school_student_unique unique(school_id,student_id),
 constraint student_profiles_emergency_name_length check(emergency_contact_name is null or length(emergency_contact_name)<=160),
 constraint student_profiles_medical_alerts_length check(medical_alerts is null or length(medical_alerts)<=4000)
);
create table if not exists public.student_incidents (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade, incident_date date not null default current_date,
 category text not null check(category in ('behaviour','safeguarding','academic','health','other')),
 description text not null, action_taken text, follow_up_date date,
 status text not null default 'open' check(status in ('open','monitoring','resolved')),
 recorded_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint student_incidents_description_length check(length(trim(description)) between 3 and 4000),
 constraint student_incidents_school_student_unique unique(school_id,id)
);
create table if not exists public.student_document_records (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 document_type text not null check(document_type in ('birth_certificate','previous_report','transfer_certificate','identity_record','medical_record','other')),
 title text not null, reference_number text, issued_on date, expires_on date, notes text,
 recorded_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 constraint student_document_title_length check(length(trim(title)) between 2 and 160),
 constraint student_document_notes_length check(notes is null or length(notes)<=2000)
);
alter table public.student_document_records add column if not exists storage_path text;
alter table public.student_document_records add column if not exists mime_type text;
alter table public.student_document_records add column if not exists file_size bigint;
create index if not exists student_profiles_school_idx on public.student_profiles(school_id);
create index if not exists student_incidents_student_date_idx on public.student_incidents(school_id,student_id,incident_date desc);
create index if not exists student_documents_student_idx on public.student_document_records(school_id,student_id,created_at desc);
create unique index if not exists student_documents_storage_path_unique on public.student_document_records(storage_path) where storage_path is not null;
alter table public.student_profiles enable row level security;
alter table public.student_incidents enable row level security;
alter table public.student_document_records enable row level security;
drop policy if exists student_profiles_admin_manage on public.student_profiles;
create policy student_profiles_admin_manage on public.student_profiles for all to authenticated
using(private.has_school_role(school_id,array['school_admin'::public.membership_role]))
with check(private.has_school_role(school_id,array['school_admin'::public.membership_role]) and exists(select 1 from public.students s where s.id=student_profiles.student_id and s.school_id=student_profiles.school_id));
drop policy if exists student_incidents_admin_manage on public.student_incidents;
create policy student_incidents_admin_manage on public.student_incidents for all to authenticated
using(private.has_school_role(school_id,array['school_admin'::public.membership_role]))
with check(private.has_school_role(school_id,array['school_admin'::public.membership_role]) and exists(select 1 from public.students s where s.id=student_incidents.student_id and s.school_id=student_incidents.school_id));
drop policy if exists student_documents_admin_manage on public.student_document_records;
create policy student_documents_admin_manage on public.student_document_records for all to authenticated
using(private.has_school_role(school_id,array['school_admin'::public.membership_role]))
with check(private.has_school_role(school_id,array['school_admin'::public.membership_role]) and exists(select 1 from public.students s where s.id=student_document_records.student_id and s.school_id=student_document_records.school_id));
grant select,insert,update,delete on public.student_profiles,public.student_incidents,public.student_document_records to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tagin-student-documents','tagin-student-documents',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists tagin_student_docs_read on storage.objects;
create policy tagin_student_docs_read on storage.objects for select to authenticated
using(bucket_id='tagin-student-documents' and exists(select 1 from public.students s where s.id::text=split_part(name,'/',2) and s.school_id::text=split_part(name,'/',1) and private.has_school_role(s.school_id,array['school_admin'::public.membership_role])));
drop policy if exists tagin_student_docs_insert on storage.objects;
create policy tagin_student_docs_insert on storage.objects for insert to authenticated
with check(bucket_id='tagin-student-documents' and exists(select 1 from public.students s where s.id::text=split_part(name,'/',2) and s.school_id::text=split_part(name,'/',1) and private.has_school_role(s.school_id,array['school_admin'::public.membership_role])));
drop policy if exists tagin_student_docs_delete on storage.objects;
create policy tagin_student_docs_delete on storage.objects for delete to authenticated
using(bucket_id='tagin-student-documents' and exists(select 1 from public.students s where s.id::text=split_part(name,'/',2) and s.school_id::text=split_part(name,'/',1) and private.has_school_role(s.school_id,array['school_admin'::public.membership_role])));
create or replace function private.audit_advanced_student_records()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_school uuid; v_actor uuid:=auth.uid(); v_student uuid; v_action text; v_entity text; v_entity_id text; v_meta jsonb;
begin
 if tg_table_name='student_profiles' then
  v_school:=coalesce(new.school_id,old.school_id); v_student:=coalesce(new.student_id,old.student_id);
  v_action:=case when tg_op='INSERT' then 'student_profile.created' else 'student_profile.updated' end;
  v_entity:='student_profile'; v_entity_id:=v_student::text;
  v_meta:=jsonb_build_object('student_id',v_student);
 elsif tg_table_name='student_incidents' then
  v_school:=coalesce(new.school_id,old.school_id); v_student:=coalesce(new.student_id,old.student_id);
  v_action:=case when tg_op='INSERT' then 'student_incident.created' else 'student_incident.updated' end;
  v_entity:='student_incident'; v_entity_id:=coalesce(new.id,old.id)::text;
  v_meta:=jsonb_build_object('student_id',v_student,'category',coalesce(new.category,old.category),'status',coalesce(new.status,old.status));
 else
  v_school:=coalesce(new.school_id,old.school_id); v_student:=coalesce(new.student_id,old.student_id);
  v_action:=case when tg_op='INSERT' then 'student_document.created' else 'student_document.updated' end;
  v_entity:='student_document'; v_entity_id:=coalesce(new.id,old.id)::text;
  v_meta:=jsonb_build_object('student_id',v_student,'document_type',coalesce(new.document_type,old.document_type));
 end if;
 insert into public.audit_logs(school_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(v_school,v_actor,v_action,v_entity,v_entity_id,v_meta);
 return new;
end;
$$;
revoke all on function private.audit_advanced_student_records() from public,anon,authenticated;
drop trigger if exists audit_student_profiles_changes on public.student_profiles;
create trigger audit_student_profiles_changes after insert or update on public.student_profiles for each row execute function private.audit_advanced_student_records();
drop trigger if exists audit_student_incidents_changes on public.student_incidents;
create trigger audit_student_incidents_changes after insert or update on public.student_incidents for each row execute function private.audit_advanced_student_records();
drop trigger if exists audit_student_documents_changes on public.student_document_records;
create trigger audit_student_documents_changes after insert or update on public.student_document_records for each row execute function private.audit_advanced_student_records();
