create or replace function public.issue_parent_student_qr(p_student_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_student public.students%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select s.* into v_student
  from public.students s
  where s.id = p_student_id
    and s.active = true
    and exists (
      select 1
      from public.guardians g
      join public.student_guardians sg
        on sg.guardian_id = g.id
       and sg.school_id = g.school_id
      where g.user_id = auth.uid()
        and g.school_id = s.school_id
        and sg.student_id = s.id
    )
  limit 1;

  if not found then
    raise exception 'This child is not linked to your family account or is inactive';
  end if;

  update public.tags
     set status = 'revoked',
         revoked_at = now()
   where school_id = v_student.school_id
     and student_id = v_student.id
     and status = 'active';

  insert into public.tags (school_id, student_id, token_hash, status)
  values (v_student.school_id, v_student.id, p_token_hash, 'active');

  return jsonb_build_object(
    'id', v_student.id,
    'full_name', v_student.full_name,
    'class_name', v_student.class_name
  );
end;
$$;

revoke all on function public.issue_parent_student_qr(uuid, text) from public;
revoke all on function public.issue_parent_student_qr(uuid, text) from anon;
grant execute on function public.issue_parent_student_qr(uuid, text) to authenticated;