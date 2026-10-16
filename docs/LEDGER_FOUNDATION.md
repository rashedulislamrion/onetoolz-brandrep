# Ledger foundation — private database posting

The pure validator is now backed by a private operator-only database ledger. Migration 20261015135651 was applied to verified nonproduction on 2026-10-15. Do not rerun it. No application API route, earnings or payouts are enabled; all four actual ledger tables are empty.

Amounts are canonical nonnegative integer strings in minor units, processed with bigint. Each line has exactly one positive side, entries balance in one currency/exponent, and per-line and aggregate amounts are bounded by signed PostgreSQL bigint capacity. At least two distinct account IDs are required. Output is a copied, frozen value, not an immutable persisted ledger.

Currency code syntax does not establish that a currency is supported. Exponent range does not establish the correct exponent for a currency. Trusted configuration and database account metadata must validate both before posting.

## Implemented database boundary

- Account ownership, currency, exponent and bucket come from protected rows, never client assertions.
- Append-only journals and lines, transactional posting, unique effect keys, payload-conflict detection and locked accounts.
- Repeated identical effects return the existing result; the same effect key with different content must fail.
- Reversals append compensating journals. No update/delete of original financial evidence.
- RLS isolation and concurrent posting tests are required before any financial integration.

The private `ledger` schema contains currencies, accounts, journals and lines. All have RLS enabled with no application policies or grants. Anonymous, authenticated (including administrators), and service_role have no schema/table/posting access. `ledger.post_journal(jsonb, uuid)` is security-invoker with an empty search path and requires current_user postgres. This is an operator primitive, not an application-facing RPC or a commission authorization check.

Currency/exponent configuration must be explicitly provisioned. Affiliate account ownership references protected affiliates with restrictive deletion. Account/currency identity is immutable. A compromised database owner can change DDL; these controls do not protect against a hostile database owner.

Journals carry database actor, reason, effect key and a normalized ordered line snapshot. Exact retries return the existing UUID; different amount, reason, currency, exponent, line order or reversal source conflicts. Extra envelope fields are ignored rather than persisted. Transaction-scoped effect locks and stable account lock ordering serialize posting. Callers should use one posting per transaction under READ COMMITTED; higher isolation and multi-post transactions need whole-transaction retry handling for serialization/deadlock errors.

Deferred constraints verify complete balanced journals and reject later appended lines, including balanced additions. Update/delete/truncate are denied by triggers. Optional full reversal links are unique and require an exact opposite-side copy in original line order. Partial refunds and business adjustments remain future policy work.

## Verification — 2026-10-15

- Rollback-only SQL suite passed: role denial, RLS presence, exact large amounts, retries/conflicts, malformed values, unknown accounts, currency/precision mismatch, immutable records, linked full reversals, incomplete journal and late-append rejection.
- Disposable-schema multi-session tests passed: identical retries returned the same UUID; conflicting retries produced one success and one rejection; opposite input account order completed without deadlock. Observed lock waiters confirmed overlap in all three tests.
- Exactly four synthetic journals/eight lines existed in the clone before guarded schema cleanup. Clone removed; actual ledger currencies/accounts/journals/lines all verified zero.
- Local npm run check passed: lint/typecheck, 97 unit tests, heuristic secret scan. Build/browser tests were not rerun (no application runtime changes).
- This does not complete full Phase 2 release acceptance: clean whole-database rebuild, CI database harness, affiliate-facing A/B read policies, and business-policy approval remain outstanding.

No launch currency, commission rate, payout threshold or refund rule is selected by these synthetic tests. These commercial decisions remain unresolved.