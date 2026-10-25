# Disposable concurrency rehearsal

**Classification correction (2026-10-16): any reference below to a nonproduction project concerns `nwgdzzpcbqmfqujycpqk`, owner-confirmed PRODUCTION. Do not repeat fixture/concurrency procedures against it; use a separate test database. See `docs/PRODUCTION_HANDOFF.md`.**

Nonproduction only. This procedure clones the **installed migration** into a dedicated schema, not the real ledger. Only postgres may access the clone. Never disable immutable triggers or delete journals to clean up the real ledger.

1. Assert `to_regnamespace('ledger_test_20261015') is null` and that applied migration `20261015135651` exists with nonempty statements.
2. In one transaction, replay that migration's statements with whole-word `ledger` replaced by `ledger_test_20261015`. Create XTS/2 currency and expense/clearing accounts with IDs `20000000-0000-4000-8000-000000000001` and `20000000-0000-4000-8000-000000000002`. No Auth fixtures needed.
3. Start two independent sessions posting the same envelope and effect key. Hold the first transaction open briefly after posting. Both must return the same journal UUID; assert exactly one journal and two lines.
4. Start two sessions with the same new effect key but different amounts. Exactly one must succeed; the other must raise SQLSTATE 22023. Assert exactly one journal for that key.
5. In another two-session pair, post distinct effect keys against the same accounts in opposite line order. Both must succeed without deadlock and all journals must balance.
6. Drop only the dedicated test schema with CASCADE after verifying its exact name and synthetic-only contents. Verify it is absent and actual ledger currency/account/journal/line counts remain zero.

The management query API uses independent sessions; concurrent calls alone do not prove overlapping execution. Inspect lock waits or deliberately hold a transaction and start the second while it remains open. A sequential retry test is not a concurrency pass.

This is a controlled operator runbook, not an unattended CI harness. Complete clean database rebuild and CI automation remain release gates.