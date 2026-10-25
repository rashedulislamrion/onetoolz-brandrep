# Phase 2A — identity and applications

**Classification correction (2026-10-16):** the project described below as "verified nonproduction" is `nwgdzzpcbqmfqujycpqk`, owner-confirmed PRODUCTION. The migration and rollback tests recorded below ran under that mistaken label. Do not rerun them there; future SQL acceptance requires a separate test project. See `PRODUCTION_HANDOFF.md`.

## Status

Applied to the verified nonproduction Supabase project on 2026-10-15 through the authorized management connection. The prepared identity_rls.sql assertions passed in a rollback transaction. All five tables have RLS enabled and no direct authenticated INSERT/UPDATE/DELETE grants. Test users, applications and history were verified absent afterward. These SQL tests do not cover actual browser MFA, concurrency, or the entire planned security matrix.

Migration: `F:\My VS Project\OneToolz Affiliates\supabase\migrations\20261015061714_identity_applications.sql`.

Database tests: `F:\My VS Project\OneToolz Affiliates\supabase\tests\identity_rls.sql`.

## Review and application procedure

1. Confirm the project is the isolated nonproduction project and review its existing schema for naming conflicts. Never run this migration on an unrelated or production project.
2. Review the migration. It creates five tables, RLS policies, two controlled RPCs, and an append-only history trigger. It does not create an administrator or change existing Auth registrations.
3. Apply with a controlled migration workflow, or run the complete migration once through the trusted Supabase SQL editor as an authorized owner. The transaction must fully succeed; do not skip failed statements. If manually applied, record this version in your migration process before adopting CLI push.
4. Run the separate test SQL in a disposable/staging project. It creates two synthetic Auth records inside a rollback transaction, exercises RLS and RPCs, and rolls them back. Never run fixture scripts on production.
5. Sign in to the local app and open `/apply`. Submit a real test application. Refresh `/application/status`; it should remain pending with one submission history event.
6. Verify a second account cannot read the first account's data through direct Data API requests. Extend tests for concurrent submissions, rejected decisions, unverified users, anonymous RPC calls, and self-approval before acceptance.

## Administrator bootstrap is intentionally separate

No email is hard-coded into migrations or used to auto-promote a user. An operator must independently verify the intended Auth user UUID and use a reviewed privileged provisioning process. This release does not provide a bootstrap action. MFA enrollment and session verification are available at `/account/security`; the pending review queue is at `/admin/applications`. Do not bypass AAL2 to make admin screens accessible. Approval RPCs require a protected admin role plus AAL2 and prohibit self-approval.

Local validation for this UI increment: 39 unit tests, 22 auth-disabled desktop/mobile browser tests, lint, typecheck, production build and heuristic secret scan passed. These do not verify actual provider enrollment, authenticated review, recovery, or concurrent requests. Self-service recovery and verified-factor removal are intentionally unavailable. No hosted changes or administrator grants were made in this increment.

## Expanded automated validation — 2026-10-15

- Baseline `identity_rls.sql` rerun against nonproduction: passed.
- `F:\My VS Project\OneToolz Affiliates\supabase\tests\identity_extended.sql`: passed against nonproduction, covering anonymous RPC denial, unconfirmed submission denial, invalid application fields, AAL1 review/read denial, self-approval and self-rejection denial, invalid/missing decisions, rejection idempotency, conflicting review denial, rejected resubmission preservation, and audit deletion denial.
- Initial-administrator migration and its test suite passed in a rollback-only rehearsal; neither new DDL nor a real role grant was committed. See `F:\My VS Project\OneToolz Affiliates\docs\ADMINISTRATOR_BOOTSTRAP.md`.
- Postcheck: zero fixture users, applications, application events, or administrators. Original hosted migration history unchanged.
- Local checks: 55 unit tests (including 16 mocked MFA/review action tests), 22 auth-disabled browser tests, lint, typecheck, build, and heuristic secret scan passed. Mocked action tests are not live provider tests.

## Bootstrap applied — 2026-10-15

The later bootstrap migration is now permanently applied as **20261015102213**, with its local filename aligned. The installed-function test suite passed in a rollback transaction. RLS is enabled; anon/authenticated/service_role have neither bootstrap EXECUTE nor grant-audit table access. Zero real administrators or grant events exist. Earlier rehearsal-only notes above describe the preceding checkpoint. Do not rerun either applied migration.

Latest local validation: 55 unit tests, 22 auth-disabled browser tests, and 18 auth-enabled anonymous browser tests passed, together with lint/typecheck/build/heuristic secret scan. The new suite exercises configured login and anonymous denial, not successful provider sign-in, enrollment, recovery, or concurrency.

## Constraints and boundaries

Later private-ledger checkpoint: **20261015135651** is now applied to nonproduction alongside the two migrations above. Its SQL suite and isolated concurrency checks passed; all actual ledger tables remain empty. The identity-specific scope notes below remain scoped to the earlier increment. See `F:\My VS Project\OneToolz Affiliates\docs\LEDGER_FOUNDATION.md` for the operator-only boundary and remaining acceptance gates.

- One application per user in this increment; rejected applications cannot be silently overwritten or resubmitted.
- Only confirmed-email users can submit. Repeated submissions return the existing ID without rewriting history.
- Direct authenticated table mutations are denied. Submission/review RPCs validate permissions and write transactionally.
- Admin reasons are visible to the applicant: never put private fraud-investigation details in these reasons.
- No referral codes, financial ledger, commission engine, payout records, or WooCommerce integration are introduced here.
- A public launch still requires finalized privacy notices, abuse controls, complete MFA/provisioning, and a full database security test pass.