# TagIn Supabase security audit

**Date:** 2026-11-26  
**Project:** School sign-in App (`wlkqsivehfwogdquodxx`)  
**Database:** PostgreSQL 17.12  
**Scope:** Read-only schema, RLS, policy, grants, helper-function, migration-history and Supabase Advisor inspection. One additive security-hardening migration was then applied and verified.

## Current structure

The public schema contains 12 application tables: `schools`, `profiles`, `school_memberships`, `audit_logs`, `students`, `guardians`, `student_guardians`, `authorized_collectors`, `tags`, `scan_events`, `push_subscriptions`, and `notifications`.

All 12 tables have RLS enabled. There are no public views. The current application tables have no student or guardian records yet.

The existing authorization model uses `platform_role` for platform super-admin status and `school_memberships.role` for school-level roles (`school_admin`, `gate_staff`, `bus_staff`, `parent`). School membership and student/guardian policies are scoped by school.

## Findings and actions

1. **Excess table privileges:** Before hardening, `anon` and `authenticated` had unnecessary `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges on public tables. These privileges are not governed by RLS. They have been revoked from both roles.
2. **Future Data API exposure:** Default table, sequence and function grants for objects created by the `postgres` role have been revoked for `anon` and `authenticated`. Future API exposure must be explicitly granted.
3. **Private helper function:** `private.is_guardian_of_student(uuid, uuid)` had an unnecessary `PUBLIC EXECUTE` grant. It has been revoked; authenticated users retain their explicit execute permission.
4. **One-off collector expiry:** Parent policies previously allowed `valid_on >= CURRENT_DATE`, which permitted a future-dated one-off collector. Both insert and update policies now require `valid_on = CURRENT_DATE`.
5. **Server-managed password flag:** Authenticated users can update only their own profile name at the column-privilege level; they cannot change `must_change_password`. The `change-password` Edge Function (JWT verification enabled) clears this flag after the signed-in user changes their password through Supabase Auth.
6. **Security Advisor:** No security lints were returned after the changes.
7. **Performance Advisor:** It reports 10 unindexed foreign keys, 8 multiple-permissive-policy warnings, and 12 unused indexes. Unused-index warnings are expected before real traffic. Index and policy tuning should be done after validating expected query patterns and workflows.

## Remaining items before production

- The `supabase_admin` role has separate default privileges. The integration could not alter those defaults due to PostgreSQL permission restrictions. Existing application tables are owned by `postgres`, and the `postgres` defaults are hardened. Confirm the Dashboard-created-object path before relying on `supabase_admin` defaults.
- The one-off collector policy currently compares against PostgreSQL `CURRENT_DATE`. Before production, add a school timezone setting and enforce expiry against the school's local date so the cutoff is exactly local midnight.
- Gate scans should be performed through a server-side function/RPC that validates the tag, staff membership, authorized collector, and event transition; do not permit arbitrary client inserts to establish attendance state.
- Add explicit state-transition checks for bus events and duplicate scan protection.
- Confirm private Storage buckets and signed-URL policies before uploading guardian/collector photos.
- TagIn uses Supabase email/password Auth internally, with a deterministic SHA-256 alias derived from each normalized E.164 phone number (`u-<hex>@login.tagin.invalid`). The client never receives or stores the alias as a login credential; `phone-password-login` derives it server-side and returns the Supabase session. Phone Auth and SMS providers are not used. The future account-provisioning function must use the exact same normalization and alias algorithm, confirm internal email identities administratively, and enforce unique phone numbers.
- The database migration history includes earlier foundation and student-operations migrations. Their original SQL files still need to be captured in the repository to make a clean, reproducible database bootstrap.

## Applied migrations

- `20261126135114_tagin_security_hardening_v1` — `supabase/migrations/20261126135114_tagin_security_hardening_v1.sql`
- `20261126135345_tagin_profile_column_privileges_v1` — `supabase/migrations/20261126135345_tagin_profile_column_privileges_v1.sql`

The `change-password` Edge Function is deployed and active with JWT verification enabled.
