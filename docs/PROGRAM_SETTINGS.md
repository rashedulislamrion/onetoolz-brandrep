# Administrator program-setting drafts

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

`F:\My VS Project\OneToolz Affiliates\supabase\migrations\20261015155702_program_settings_drafts.sql` is **installed on nonproduction** project `nwgdzzpcbqmfqujycpqk`. The local filename was aligned with the version assigned by the migration API. Do not rerun it. Woo ingestion remains unapplied; no blanket migration push was used.

Database acceptance passed on October 15, 2026: rollback-only migration rehearsal covered anonymous/nonadmin/AAL1 denial, admin AAL2 save/read, input constraints, direct app-role write denial, identical retry and stale/conflicting requests. Installed RPC save/read was also tested and rolled back. A disposable schema cloned the installed function for genuine two-session tests: stale writer rejected; identical retry returned the same revision. Both cases observed a waiting database lock before the first writer committed. Clone and synthetic users were removed; actual settings table remains empty. See `F:\My VS Project\OneToolz Affiliates\supabase\tests\program_settings.sql` for repeatable rollback acceptance.

Latest validation: check/build exit 0, 166 unit tests and 20 desktop/mobile anonymous browser tests passed, including `/admin/settings`. Signed-in administrator browser save/reload is still unverified; no test credentials were available to this increment. No frontend deployment, active policy or financial execution is claimed.

## Explicitly not implemented

Files remain untracked in this workspace, so a clean `git diff --check` alone is not adequate validation; edited files were also inspected directly for trailing whitespace and empty content.

Publishing/approving a policy, effective dates, commission basis, product/affiliate overrides, tax/shipping/discount eligibility, refunds/reversals, payout authorization, banking details or payment execution. Draft records are not consumed by the order worker or ledger. Saving never activates earnings or sends funds. Future published policies must retain immutable versions referenced by calculations; publication must not rewrite historical commissions implicitly.