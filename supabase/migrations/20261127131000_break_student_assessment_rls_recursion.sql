-- Break an RLS recursion between students and assessments.
-- The old students policy queried assessments directly. The guardian assessment
-- policy queries students, so PostgreSQL detected infinite recursion.
create or replace function private.teacher_has_assigned_assessment_class(target_school_id uuid, target_class_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.assessments a
    join public.school_memberships sm
      on sm.id = a.teacher_membership_id
     and sm.school_id = a.school_id
    where a.school_id = target_school_id
      and a.class_name = target_class_name
      and sm.user_id = (select auth.uid())
      and sm.status = 'active'
      and sm.role = 'staff'::public.membership_role
  );
$function$;

revoke all on function private.teacher_has_assigned_assessment_class(uuid,text) from public, anon;
grant execute on function private.teacher_has_assigned_assessment_class(uuid,text) to authenticated;

drop policy if exists students_read_assigned_assessment_class on public.students;
create policy students_read_assigned_assessment_class
on public.students
for select
to authenticated
using ((select private.teacher_has_assigned_assessment_class(students.school_id, students.class_name)));
