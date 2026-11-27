alter table public.authorized_collectors
  add column if not exists phone text,
  add column if not exists token_hash text,
  add column if not exists expires_at timestamptz,
  add column if not exists used_at timestamptz;

create unique index if not exists authorized_collectors_token_hash_uidx
  on public.authorized_collectors(token_hash) where token_hash is not null;
create index if not exists authorized_collectors_active_pickup_idx
  on public.authorized_collectors(school_id,student_id,valid_on,expires_at)
  where token_hash is not null and used_at is null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tagin-pickup-photos','tagin-pickup-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists tagin_pickup_photo_parent_upload on storage.objects;
create policy tagin_pickup_photo_parent_upload on storage.objects for insert to authenticated
with check(bucket_id='tagin-pickup-photos'
 and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
 and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
 and private.is_guardian_of_student(((storage.foldername(name))[2])::uuid,((storage.foldername(name))[1])::uuid));

drop policy if exists tagin_pickup_photo_related_read on storage.objects;
create policy tagin_pickup_photo_related_read on storage.objects for select to authenticated
using(bucket_id='tagin-pickup-photos' and exists(
 select 1 from public.authorized_collectors ac where ac.photo_path=name and (
  private.is_guardian_of_student(ac.student_id,ac.school_id)
  or private.has_school_role(ac.school_id,array['school_admin','gate_staff']::public.membership_role[])
  or private.has_staff_permission(ac.school_id,'gate.verify_collector')
 )));

create or replace function private.create_parent_pickup(
 p_school_id uuid,p_student_id uuid,p_full_name text,p_relationship text,p_phone text,p_photo_path text,p_token_hash text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_id uuid; v_expires timestamptz;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='28000'; end if;
 if length(btrim(coalesce(p_full_name,''))) not between 2 and 160 then raise exception 'Enter the full name of the pickup person.' using errcode='22023'; end if;
 if p_token_hash is null or length(p_token_hash)<>64 then raise exception 'Invalid pickup pass.' using errcode='22023'; end if;
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

create or replace function private.preview_parent_pickup(p_school_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v record; v_latest text;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='28000'; end if;
 select ac.id,ac.school_id,ac.student_id,ac.full_name,ac.relationship,ac.phone,ac.photo_path,
 s.full_name as student_name,s.class_name,s.level,ac.expires_at into v
 from public.authorized_collectors ac join public.students s on s.id=ac.student_id and s.school_id=ac.school_id
 where ac.school_id=p_school_id and ac.token_hash=p_token_hash and ac.standing=false
 and ac.valid_on=current_date and ac.used_at is null and ac.expires_at>now() and s.active=true for update of ac;
 if not found then raise exception 'This pickup QR is invalid, expired, or already used.' using errcode='22023'; end if;
 if not(private.is_platform_admin() or private.has_school_role(v.school_id,array['school_admin','gate_staff']::public.membership_role[])
 or private.has_staff_permission(v.school_id,'gate.verify_collector')) then raise exception 'You are not permitted to verify pickup passes for this school.' using errcode='42501'; end if;
 select e.event_type into v_latest from public.scan_events e where e.school_id=v.school_id and e.student_id=v.student_id
 and e.event_type in('check_in','check_out') order by e.created_at desc,e.id desc limit 1;
 if v_latest is distinct from 'check_in' then raise exception 'This student is not currently checked in at school.' using errcode='23514'; end if;
 return jsonb_build_object('collector_id',v.id,'student_id',v.student_id,'student_name',v.student_name,
 'class_name',v.class_name,'level',v.level,'collector_name',v.full_name,'relationship',v.relationship,
 'phone',v.phone,'photo_path',v.photo_path,'expires_at',v.expires_at);
end; $f$;

create or replace function private.complete_parent_pickup(p_school_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v record; v_latest text; v_event uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='28000'; end if;
 select ac.id,ac.school_id,ac.student_id,ac.full_name,s.full_name as student_name into v
 from public.authorized_collectors ac join public.students s on s.id=ac.student_id and s.school_id=ac.school_id
 where ac.school_id=p_school_id and ac.token_hash=p_token_hash and ac.standing=false
 and ac.valid_on=current_date and ac.used_at is null and ac.expires_at>now() and s.active=true for update of ac;
 if not found then raise exception 'This pickup QR is invalid, expired, or already used.' using errcode='22023'; end if;
 if not(private.is_platform_admin() or private.has_school_role(v.school_id,array['school_admin','gate_staff']::public.membership_role[])
 or private.has_staff_permission(v.school_id,'gate.verify_collector')) then raise exception 'You are not permitted to complete pickup for this school.' using errcode='42501'; end if;
 select e.event_type into v_latest from public.scan_events e where e.school_id=v.school_id and e.student_id=v.student_id
 and e.event_type in('check_in','check_out') order by e.created_at desc,e.id desc limit 1;
 if v_latest is distinct from 'check_in' then raise exception 'This student is not currently checked in at school.' using errcode='23514'; end if;
 insert into public.scan_events(school_id,student_id,event_type,collected_by_type,collected_by_name,scanned_by)
 values(v.school_id,v.student_id,'check_out','authorised_pickup',v.full_name,auth.uid()) returning id into v_event;
 update public.authorized_collectors set used_at=now() where id=v.id;
 return jsonb_build_object('event_id',v_event,'student_name',v.student_name,'collector_name',v.full_name);
end; $f$;

grant usage on schema private to authenticated;
revoke all on function private.create_parent_pickup(uuid,uuid,text,text,text,text,text),
 private.preview_parent_pickup(uuid,text),private.complete_parent_pickup(uuid,text) from public,anon;
grant execute on function private.create_parent_pickup(uuid,uuid,text,text,text,text,text),
 private.preview_parent_pickup(uuid,text),private.complete_parent_pickup(uuid,text) to authenticated;

create or replace function public.create_parent_pickup(p_school_id uuid,p_student_id uuid,p_full_name text,p_relationship text,p_phone text,p_photo_path text,p_token_hash text)
returns jsonb language sql security invoker set search_path='' as $$ select private.create_parent_pickup(p_school_id,p_student_id,p_full_name,p_relationship,p_phone,p_photo_path,p_token_hash); $$;
create or replace function public.preview_parent_pickup(p_school_id uuid,p_token_hash text)
returns jsonb language sql security invoker set search_path='' as $$ select private.preview_parent_pickup(p_school_id,p_token_hash); $$;
create or replace function public.complete_parent_pickup(p_school_id uuid,p_token_hash text)
returns jsonb language sql security invoker set search_path='' as $$ select private.complete_parent_pickup(p_school_id,p_token_hash); $$;
revoke all on function public.create_parent_pickup(uuid,uuid,text,text,text,text,text),
 public.preview_parent_pickup(uuid,text),public.complete_parent_pickup(uuid,text) from public,anon;
grant execute on function public.create_parent_pickup(uuid,uuid,text,text,text,text,text),
 public.preview_parent_pickup(uuid,text),public.complete_parent_pickup(uuid,text) to authenticated;

alter function public.issue_parent_student_qr(uuid,text) set schema private;
create or replace function public.issue_parent_student_qr(p_student_id uuid,p_token_hash text)
returns jsonb language sql security invoker set search_path='' as $$ select private.issue_parent_student_qr(p_student_id,p_token_hash); $$;
revoke all on function public.issue_parent_student_qr(uuid,text) from public,anon;
grant execute on function public.issue_parent_student_qr(uuid,text) to authenticated;