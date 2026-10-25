# Commission accounting foundation — October 16, 2026

**Correction:** `nwgdzzpcbqmfqujycpqk` is owner-confirmed PRODUCTION. Earlier nonproduction classification below is incorrect/historical; prior rollback tests did occur there under that mistake. No more fixture acceptance may run there. Management connection is verified, deployed runtime connection is not. See `PRODUCTION_HANDOFF.md` for current requirements.

## Delivered

Admin publication is installed only on the production-classified Supabase project `nwgdzzpcbqmfqujycpqk` (installed under a mistaken nonproduction label; see correction above), tracked as `20261016114552_program_policy_publication.sql`. Six prior migrations were not replayed. Full rollback rehearsal and installed RPC acceptance passed: admin AAL2 publication, identical retry, stale conflict, precision failure, direct-write denial, AAL1/nonadmin denial and immutable-update denial. Postcheck: zero policies/drafts/test users, one unchanged application, zero Woo orders; RLS enabled, anonymous publication and authenticated direct insert denied. No real policy was published.

`F:\My VS Project\OneToolz Affiliates\src\lib\ledger\commission.ts` is an offline, non-posting arithmetic module:

- Converts nonnegative decimal strings to bounded PostgreSQL bigint minor units without floating-point money operations. Excess nonzero precision is rejected, not silently rounded.
- Selects immutable policy snapshots from complete trusted history using verified order creation time. Incomplete/gapped/duplicate histories and invalid dates fail closed. Equal effective timestamps resolve to the higher version.
- Uses the admin-selected percentage, currency, precision, basis, refund treatment and all-products one-time scope.
- Requires an explicit rounding choice (`half_up` or `down`) from the caller; neither is silently treated as an approved commercial rule. Admin publication does not yet store rounding, so automatic use remains disabled.
- Calculates cumulative proportional reversal as gross commission minus the rounded remaining commission; full-on-any-refund reverses the whole award. Gross always reconciles to reversal plus remaining commission.
- Returns immutable quotes with policy version, calculation inputs and rounding for future persistence/audit. It does not access Supabase, consume untrusted checkout input, or change the ledger.

## Remaining before earning activation

Phase 3 referral/checkout acceptance is still incomplete; this is parallel phase 4 foundation, not phase 4 completion. Referral campaign/evidence migrations remain absent remotely. Their SQL/race acceptance, trusted consent and secure Woo/buyer association remain pending.

The existing redacted Woo order snapshot lacks verified creation time and net item/refunded-item basis amounts. Do not substitute total refunds for net-item refunds, treat completed/paid timestamps as independent settlement evidence, or feed the ten-row settings history preview to policy selection.

Next accounting increments: admin-versioned rounding and eligibility/hold semantics; verified order/refund basis extraction and settlement qualification; private persisted calculation snapshots referencing published versions; transactional idempotent journal posting, independent-session races and refund/chargeback/recovery reconciliation; holds/releases and affiliate-safe reads. No live rates are needed from the owner: these are admin dashboard rules. Payout providers/authorization remain separate and no transfers are enabled.

Independent-session publication races and signed-in admin browser publication are not verified by the rollback SQL suite. Deployed runtime connection to the production database is not established; only management access to the production-classified project is available through the connected account. Hosting was not inspected or changed.

## Validation

405 unit tests passed, including 41 new arithmetic/policy/refund tests; 32 desktop/mobile anonymous browser tests passed. Full lint, TypeScript check, heuristic secret-pattern scan and production build passed. Early background build attempts were interrupted and an early browser attempt lacked a completed build; the final direct build and subsequent browser run succeeded. No live store requests or synthetic production purchases were made.