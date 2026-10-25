# Administrator program settings and policy publication

**Classification correction:** owner confirms `nwgdzzpcbqmfqujycpqk` is PRODUCTION. The installation/test actions below happened under an incorrect nonproduction assumption. Publication migration is already installed there; do not rerun it. No further synthetic fixture acceptance there. See `PRODUCTION_HANDOFF.md`; older classification statements are superseded.

## October 16, 2026: admin-controlled publication (installed on the production-classified project)

Commission values and payout rules are configured by authorized administrators in `/admin/settings`; asking the owner to supply fixed values is not a development prerequisite. No financial defaults are assumed.

The publication editor requires the latest saved draft, an explicit currency precision (0–6), calculation basis (discounted item totals excluding tax/shipping, or full order total including them), refund treatment (proportional against that basis, or full reversal on any refund), explanation and confirmation. Published scope is visibly limited to all products, one-time commission per eligible order; renewal commissions and product overrides are unsupported. Cadence authorizes review, not payment execution.

`F:\My VS Project\OneToolz Affiliates\supabase\migrations\20261016114552_program_policy_publication.sql` adds immutable policy snapshots, admin AAL2 read/publication, immediate server effective timestamps, stale-editor detection, identical-request retries, precision checks and serialized publication. **Installed on production-classified `nwgdzzpcbqmfqujycpqk` under a mistaken nonproduction label; do not rerun it.** The filename matches the version assigned by tracked migration tooling. That installation IS the production installation — there is no separate one pending. Missing publication storage disables publishing while leaving draft editing independent.

`F:\My VS Project\OneToolz Affiliates\supabase\tests\program_policy_publication.sql` supplies rollback-only SQL acceptance, now passed in rehearsal and against the installed RPC. An additional owner-context immutable-update test passed. Fixtures rolled back; actual draft and policy tables remain empty. Genuine independent-session publication races and signed-in admin browser acceptance remain unverified. Unit mocks do not establish SQL correctness.

Publication stores approved rules, but the order worker/ledger do not consume them yet. That integration must select policy by trusted order creation time, retain the immutable policy version on each calculation, implement exact currency rounding/refund behavior, and never silently recalculate historical entries. No commission calculation or money movement is activated by this increment.

Local validation for publication source: 364 unit tests (25 new publication/action/page tests), 32 desktop/mobile anonymous browser tests, full lint, TypeScript check, heuristic secret scan and production build passed. Browser tests verify anonymous fail-closed behavior, not authenticated publication. SQL acceptance remains unexecuted.

Route: `/admin/settings`, linked from administration. Existing admin membership and MFA are required for reads and writes. Server actions also enforce same-origin requests.

## Implemented

- Proposed commission percentage (0–100, two decimal places), stored as integer basis points.
- Proposed three-letter currency code and minimum payout as a decimal string (up to six decimals). This is draft syntax validation, not proof of a supported currency or valid currency precision.
- Proposed hold period (0–365 days) and manual/weekly/monthly review cadence. These are editor bounds, not approved business rules or actual schedules.
- Required change reason and explicit draft-only confirmation; no financial defaults selected.
- Immutable application-level revision history, actor and server timestamp. Latest ten revisions shown; older records retained.
- Stale editor conflict detection and identical-request retry handling in the save RPC.
- Safe unavailable-storage state rather than pretending settings were saved.

## Installation state

`F:\My VS Project\OneToolz Affiliates\supabase\migrations\20261015155702_program_settings_drafts.sql` is **installed on the production-classified** project `nwgdzzpcbqmfqujycpqk` (under a mistaken nonproduction label; see the correction at the top of this document). The local filename was aligned with the version assigned by the migration API. Do not rerun it. Woo ingestion remains unapplied; no blanket migration push was used.

Database acceptance passed on October 15, 2026: rollback-only migration rehearsal covered anonymous/nonadmin/AAL1 denial, admin AAL2 save/read, input constraints, direct app-role write denial, identical retry and stale/conflicting requests. Installed RPC save/read was also tested and rolled back. A disposable schema cloned the installed function for genuine two-session tests: stale writer rejected; identical retry returned the same revision. Both cases observed a waiting database lock before the first writer committed. Clone and synthetic users were removed; actual settings table remains empty. See `F:\My VS Project\OneToolz Affiliates\supabase\tests\program_settings.sql` for repeatable rollback acceptance.

Latest validation: check/build exit 0, 166 unit tests and 20 desktop/mobile anonymous browser tests passed, including `/admin/settings`. Signed-in administrator browser save/reload is still unverified; no test credentials were available to this increment. No frontend deployment, active policy or financial execution is claimed.

## Earlier draft-only delivery limitations (superseded where noted above)

The original draft-only increment lacked publication. Publication is now installed on the production-classified project as described above; signed-in browser acceptance remains pending. Product/affiliate overrides, persisted refund/reversal postings, payout authorization, banking details and payment execution remain unimplemented. Offline arithmetic is documented in `COMMISSION_ACCOUNTING.md`; neither drafts nor published policies are yet consumed by the order worker or ledger. Saving a draft never activates earnings or sends funds.