alter table private.student_qr_secrets add column if not exists reference_code text;
update private.student_qr_secrets set reference_code = 'TG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)) where reference_code is null;
alter table private.student_qr_secrets alter column reference_code set not null;
create unique index if not exists student_qr_secrets_reference_code_uidx on private.student_qr_secrets(reference_code);

create or replace function public.get_or_create_student_qr(p_student_id uuid,p_token text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_student public.students%rowtype; v_token text; v_hash text; v_reference text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select s.* into v_student from public.students s where s.id=p_student_id and s.active=true;
 if not found then raise exception 'Student is unavailable'; end if;
 if not (private.is_platform_admin() or private.has_school_role(v_student.school_id,array['school_admin']::public.membership_role[])) then raise exception 'Not permitted to manage this student QR'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_student.id::text,0));
 select q.token,q.token_hash,q.reference_code into v_token,v_hash,v_reference from private.student_qr_secrets q where q.student_id=v_student.id for update;
 if v_token is null then
  if coalesce(length(p_token),0)<40 or coalesce(length(p_token_hash),0)<>64 then raise exception 'Invalid QR credential'; end if;
  v_token:=p_token; v_hash:=p_token_hash;
  v_reference:='TG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  update public.tags set status='revoked',revoked_at=now() where school_id=v_student.school_id and student_id=v_student.id and tag_type='bag' and status='active';
  insert into public.tags(school_id,student_id,token_hash,tag_type,status) values(v_student.school_id,v_student.id,v_hash,'bag','active');
  insert into private.student_qr_secrets(student_id,school_id,token,token_hash,reference_code) values(v_student.id,v_student.school_id,v_token,v_hash,v_reference);
 end if;
 return jsonb_build_object('token',v_token,'student_id',v_student.id,'reference_code',v_reference);
end; $$;

create or replace function public.replace_student_qr(p_student_id uuid,p_token text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_student public.students%rowtype; v_reference text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select s.* into v_student from public.students s where s.id=p_student_id and s.active=true;
 if not found then raise exception 'Student is unavailable'; end if;
 if not (private.is_platform_admin() or private.has_school_role(v_student.school_id,array['school_admin']::public.membership_role[])) then raise exception 'Not permitted to replace this student QR'; end if;
 if coalesce(length(p_token),0)<40 or coalesce(length(p_token_hash),0)<>64 then raise exception 'Invalid QR credential'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_student.id::text,0));
 select q.reference_code into v_reference from private.student_qr_secrets q where q.student_id=v_student.id for update;
 if v_reference is null then v_reference:='TG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)); end if;
 update public.tags set status='revoked',revoked_at=now() where school_id=v_student.school_id and student_id=v_student.id and tag_type='bag' and status='active';
 insert into public.tags(school_id,student_id,token_hash,tag_type,status) values(v_student.school_id,v_student.id,p_token_hash,'bag','active');
 insert into private.student_qr_secrets(student_id,school_id,token,token_hash,reference_code,updated_at) values(v_student.id,v_student.school_id,p_token,p_token_hash,v_reference,now())
 on conflict(student_id) do update set school_id=excluded.school_id,token=excluded.token,token_hash=excluded.token_hash,updated_at=now();
 return jsonb_build_object('token',p_token,'student_id',v_student.id,'reference_code',v_reference);
end; $$;

create or replace function public.get_or_create_parent_student_qr(p_student_id uuid,p_token text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_student public.students%rowtype; v_token text; v_hash text; v_reference text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select s.* into v_student from public.students s where s.id=p_student_id and s.active=true and exists (
  select 1 from public.guardians g join public.student_guardians sg on sg.guardian_id=g.id and sg.school_id=g.school_id
  where g.user_id=auth.uid() and g.school_id=s.school_id and sg.student_id=s.id
 ) limit 1;
 if not found then raise exception 'This child is not linked to your family account or is inactive'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_student.id::text,0));
 select q.token,q.token_hash,q.reference_code into v_token,v_hash,v_reference from private.student_qr_secrets q where q.student_id=v_student.id for update;
 if v_token is null then
  if coalesce(length(p_token),0)<40 or coalesce(length(p_token_hash),0)<>64 then raise exception 'Invalid QR credential'; end if;
  v_token:=p_token; v_hash:=p_token_hash;
  v_reference:='TG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  update public.tags set status='revoked',revoked_at=now() where school_id=v_student.school_id and student_id=v_student.id and tag_type='bag' and status='active';
  insert into public.tags(school_id,student_id,token_hash,tag_type,status) values(v_student.school_id,v_student.id,v_hash,'bag','active');
  insert into private.student_qr_secrets(student_id,school_id,token,token_hash,reference_code) values(v_student.id,v_student.school_id,v_token,v_hash,v_reference);
 end if;
 return jsonb_build_object('token',v_token,'student_id',v_student.id,'reference_code',v_reference);
end; $$;
revoke all on function public.get_or_create_student_qr(uuid,text,text) from public,anon;
grant execute on function public.get_or_create_student_qr(uuid,text,text) to authenticated;
revoke all on function public.replace_student_qr(uuid,text,text) from public,anon;
grant execute on function public.replace_student_qr(uuid,text,text) to authenticated;
revoke all on function public.get_or_create_parent_student_qr(uuid,text,text) from public,anon;
grant execute on function public.get_or_create_parent_student_qr(uuid,text,text) to authenticated;