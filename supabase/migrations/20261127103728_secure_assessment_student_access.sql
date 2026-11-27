drop policy if exists students_read_assigned_assessment_class on public.students;
create policy students_read_assigned_assessment_class on public.students for select to authenticated
using (exists (
 select 1 from public.assessments a
 join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id
 where a.school_id=students.school_id and a.class_name=students.class_name
 and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff'
));
drop policy if exists assessment_scores_admin_update on public.assessment_scores;
create policy assessment_scores_admin_update on public.assessment_scores for update to authenticated
using (private.has_school_role(assessment_scores.school_id, array['school_admin'::public.membership_role]))
with check (
 private.has_school_role(assessment_scores.school_id, array['school_admin'::public.membership_role])
 and exists (select 1 from public.assessments a where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and assessment_scores.score <= a.max_score)
 and exists (select 1 from public.students s join public.assessments a on a.id=assessment_scores.assessment_id where s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id and s.class_name=a.class_name and a.school_id=assessment_scores.school_id)
);
drop policy if exists assessment_scores_teacher_update_assigned on public.assessment_scores;
create policy assessment_scores_teacher_update_assigned on public.assessment_scores for update to authenticated
using (exists (
 select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id
 where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status <> 'closed' and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff'
))
with check (exists (
 select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id
 join public.students s on s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id
 where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status <> 'closed' and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff' and assessment_scores.score <= a.max_score and s.active and s.class_name=a.class_name
));
