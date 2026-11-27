create table if not exists public.assessments (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 class_name text not null, subject_name text not null, assessment_name text not null,
 assessment_type text not null default 'test' check (assessment_type in ('classwork','test','exam','project','other')),
 academic_year text not null, term text not null, max_score numeric(7,2) not null check (max_score > 0 and max_score <= 100000),
 teacher_membership_id uuid references public.school_memberships(id) on delete set null,
 status text not null default 'draft' check (status in ('draft','published','closed')),
 assessment_date date, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint assessments_name_nonempty check (length(trim(assessment_name)) > 0),
 constraint assessments_class_nonempty check (length(trim(class_name)) > 0),
 constraint assessments_subject_nonempty check (length(trim(subject_name)) > 0)
);
create index if not exists assessments_school_class_term_idx on public.assessments(school_id,class_name,academic_year,term);
create index if not exists assessments_teacher_idx on public.assessments(teacher_membership_id) where teacher_membership_id is not null;
create table if not exists public.assessment_scores (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 assessment_id uuid not null references public.assessments(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete cascade,
 score numeric(7,2) not null check (score >= 0), remarks text,
 entered_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint assessment_scores_one_per_student unique(assessment_id,student_id)
);
create index if not exists assessment_scores_student_idx on public.assessment_scores(school_id,student_id,assessment_id);
alter table public.assessments enable row level security;
alter table public.assessment_scores enable row level security;
create policy assessments_admin_manage on public.assessments for all to authenticated
using (private.has_school_role(assessments.school_id, array['school_admin'::public.membership_role]))
with check (private.has_school_role(assessments.school_id, array['school_admin'::public.membership_role]));
create policy assessments_teacher_read_assigned on public.assessments for select to authenticated
using (exists (select 1 from public.school_memberships sm where sm.id=assessments.teacher_membership_id and sm.school_id=assessments.school_id and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff'));
create policy assessments_guardian_read_published on public.assessments for select to authenticated
using (assessments.status='published' and exists (
 select 1 from public.students s join public.student_guardians sg on sg.student_id=s.id and sg.school_id=s.school_id join public.guardians g on g.id=sg.guardian_id and g.school_id=sg.school_id
 where s.school_id=assessments.school_id and s.active and s.class_name=assessments.class_name and g.user_id=(select auth.uid())
));
create policy assessment_scores_admin_read on public.assessment_scores for select to authenticated
using (private.has_school_role(assessment_scores.school_id, array['school_admin'::public.membership_role]));
create policy assessment_scores_teacher_read_assigned on public.assessment_scores for select to authenticated
using (exists (select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff'));
create policy assessment_scores_guardian_read_linked on public.assessment_scores for select to authenticated
using (private.is_guardian_of_student(assessment_scores.student_id,assessment_scores.school_id) and exists (select 1 from public.assessments a where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status='published'));
create policy assessment_scores_admin_insert on public.assessment_scores for insert to authenticated
with check (private.has_school_role(assessment_scores.school_id, array['school_admin'::public.membership_role]) and exists (select 1 from public.assessments a where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and assessment_scores.score<=a.max_score) and exists (select 1 from public.students s where s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id and s.active));
create policy assessment_scores_teacher_insert_assigned on public.assessment_scores for insert to authenticated
with check (exists (select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status<>'closed' and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff' and assessment_scores.score<=a.max_score) and exists (select 1 from public.students s join public.assessments a on a.id=assessment_scores.assessment_id where s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id and s.active and s.class_name=a.class_name and a.school_id=assessment_scores.school_id));
create policy assessment_scores_admin_update on public.assessment_scores for update to authenticated
using (private.has_school_role(assessment_scores.school_id, array['school_admin'::public.membership_role]))
with check (private.has_school_role(assessment_scores.school_id, array['school_admin'::public.membership_role]) and exists (select 1 from public.assessments a where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and assessment_scores.score<=a.max_score) and exists (select 1 from public.students s join public.assessments a on a.id=assessment_scores.assessment_id where s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id and s.class_name=a.class_name and a.school_id=assessment_scores.school_id));
create policy assessment_scores_teacher_update_assigned on public.assessment_scores for update to authenticated
using (exists (select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status<>'closed' and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff'))
with check (exists (select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id join public.students s on s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status<>'closed' and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff' and assessment_scores.score<=a.max_score and s.active and s.class_name=a.class_name));
create policy students_read_assigned_assessment_class on public.students for select to authenticated
using (exists (select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id where a.school_id=students.school_id and a.class_name=students.class_name and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff'));
grant select,insert,update on public.assessments to authenticated;
grant select,insert,update on public.assessment_scores to authenticated;


drop policy if exists assessment_scores_admin_insert on public.assessment_scores;
create policy assessment_scores_admin_insert on public.assessment_scores for insert to authenticated
with check (private.has_school_role(assessment_scores.school_id,array['school_admin'::public.membership_role]) and assessment_scores.entered_by=(select auth.uid()) and exists(select 1 from public.assessments a where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and assessment_scores.score<=a.max_score) and exists(select 1 from public.students s where s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id and s.active));
drop policy if exists assessment_scores_teacher_insert_assigned on public.assessment_scores;
create policy assessment_scores_teacher_insert_assigned on public.assessment_scores for insert to authenticated
with check (assessment_scores.entered_by=(select auth.uid()) and exists(select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status='draft' and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff' and assessment_scores.score<=a.max_score) and exists(select 1 from public.students s join public.assessments a on a.id=assessment_scores.assessment_id where s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id and s.active and s.class_name=a.class_name and a.school_id=assessment_scores.school_id));
drop policy if exists assessment_scores_admin_update on public.assessment_scores;
create policy assessment_scores_admin_update on public.assessment_scores for update to authenticated
using(private.has_school_role(assessment_scores.school_id,array['school_admin'::public.membership_role]))
with check(private.has_school_role(assessment_scores.school_id,array['school_admin'::public.membership_role]) and assessment_scores.entered_by=(select auth.uid()) and exists(select 1 from public.assessments a where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and assessment_scores.score<=a.max_score) and exists(select 1 from public.students s join public.assessments a on a.id=assessment_scores.assessment_id where s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id and s.class_name=a.class_name and a.school_id=assessment_scores.school_id));
drop policy if exists assessment_scores_teacher_update_assigned on public.assessment_scores;
create policy assessment_scores_teacher_update_assigned on public.assessment_scores for update to authenticated
using(exists(select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status='draft' and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff'))
with check(assessment_scores.entered_by=(select auth.uid()) and exists(select 1 from public.assessments a join public.school_memberships sm on sm.id=a.teacher_membership_id and sm.school_id=a.school_id join public.students s on s.id=assessment_scores.student_id and s.school_id=assessment_scores.school_id where a.id=assessment_scores.assessment_id and a.school_id=assessment_scores.school_id and a.status='draft' and sm.user_id=(select auth.uid()) and sm.status='active' and sm.role='staff' and assessment_scores.score<=a.max_score and s.active and s.class_name=a.class_name));
