drop policy if exists assessments_admin_manage on public.assessments;
create policy assessments_admin_manage on public.assessments for all to authenticated
using(private.has_school_role(assessments.school_id,array['school_admin'::public.membership_role]))
with check(private.has_school_role(assessments.school_id,array['school_admin'::public.membership_role])
 and (assessments.teacher_membership_id is null or exists(select 1 from public.school_memberships sm where sm.id=assessments.teacher_membership_id and sm.school_id=assessments.school_id and sm.role='staff' and sm.status='active')));
drop policy if exists assessment_scores_admin_insert on public.assessment_scores;
create policy assessment_scores_admin_insert on public.assessment_scores for insert to authenticated
with check(private.has_school_role(assessment_scores.school_id,array['school_admin'::public.membership_role])
 and assessment_scores.entered_by=(select auth.uid())
 and exists(select 1 from public.assessments a where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and assessment_scores.score<=a.max_score)
 and exists(select 1 from public.students s join public.assessments a on a.id=assessment_scores.assessment_id where s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id and s.active and s.class_name=a.class_name and a.school_id=assessment_scores.school_id));
