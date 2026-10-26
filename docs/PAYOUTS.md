# Payouts (Phase 5) — design and boundaries

Source: migration `supabase/migrations/20261026060000_payouts.sql`
(SOURCE-ONLY, not installed anywhere), `src/lib/payouts/`,
`/dashboard/payouts`, `/admin/payouts`. Rollback-only SQL acceptance
suite: `supabase/tests/payouts.sql` (not executed anywhere; SQL
acceptance still pending on a separate test database).

## The manual-settlement rule

No automated transfer exists or is authorized anywhere in BrandRep.
Settlement is a **recording** act: an administrator sends the money
outside the system (bKash, bank transfer, …), then records that fact in
`/admin/payouts` together with the external transfer reference (4–120
characters). The system never talks to a payment rail, and no code path
marks a payout settled without an external reference. Only mark paid
after verified settlement evidence — the reference recorded here is the
operator's attestation, not a provider callback.

## Flow and states

```
requested ──review approve──▶ approved ──settle (reference)──▶ settled
    │                            │
    ├──review reject──▶ rejected └──fail (reason)──▶ failed
    └──cancel (affiliate)──▶ cancelled
```

- **Request** (`request_payout`, approved affiliates only): the amount
  must be a positive exact minor-unit value, at or above the *current
  published policy minimum for that currency* (`program_policies`
  latest version for the currency; no policy → denied), and within the
  caller's payable balance. Creating the request atomically posts the
  reservation journal, so funds are held from that moment.
- **Cancel** (`cancel_payout`, owner only, from `requested`): releases
  the reservation. Re-cancelling is an idempotent no-op.
- **Review** (`review_payout`, administrator + AAL2): approve keeps the
  funds reserved; reject releases them. The reviewer can never be the
  requesting affiliate's user (maker-checker, enforced in the RPC, not
  just the page).
- **Settle** (`settle_payout`, administrator + AAL2, from `approved`):
  requires the external reference; posts reserved → clearing. Repeating
  with the same reference is a no-op; a different reference conflicts.
- **Fail** (`fail_payout`, administrator + AAL2, from `approved`):
  records that the external transfer failed, stores the reason, and
  releases the reservation so the affiliate can request again.

Every transition appends an immutable row to `payouts.payout_events`
(actor, kind, detail); `payout_requests` rows are never deleted and
status changes happen only inside the RPCs.

## Journals and balances

Reservation is a journal, not a flag — this is what makes double-spend
impossible: a second request checks a payable balance that already
excludes every open reservation.

| Transition | Journal | Effect key |
| --- | --- | --- |
| request | Dr affiliate `payable` / Cr affiliate `reserved` | `payout:<request_key>:reserve` |
| cancel / reject / fail | Dr `reserved` / Cr `payable` | `payout:<request_key>:release` |
| settle | Dr `reserved` / Cr platform `clearing` | `payout:<request_key>:settle` |

Balances are derived from `ledger.lines` (credits − debits for the
liability-style affiliate buckets; there is no balance view in the
ledger). Journals post through `payouts.post_journal`, a
security-definer delegate restricted to the `payout:` effect-key
namespace — the same postgres-ownership trick as
`post_commission_journal`, because `ledger.post_journal` itself is
operator-only. Exactly one of release/settle can ever execute per
request (status guards + journal idempotency), and all money RPCs
serialize per affiliate with an advisory lock. The request row snapshots
the policy's currency exponent, so later policy changes cannot rewrite
the units of an in-flight request.

## Reads

- `affiliate_payout_overview()` (authenticated): the caller's own
  per-currency payable/reserved balances (exact minor units), the latest
  policy minimum + cadence per currency, and their latest 20 requests.
  No other affiliate's data can contribute.
- `admin_payout_queue()` (administrator + AAL2): `requested`/`approved`
  rows, oldest first, with the affiliate display identity held in-schema.

Both dashboard and admin pages fail closed: any RPC error or shape
drift renders the unavailable notice, never a zero balance or an
assumed-empty queue.

## What remains / interplay

- **Settlement-evidence gate:** payouts spend `payable` balances, which
  only fill when the Phase 4 posting worker releases matured holds —
  and `COMMISSION_POSTING_ENABLED` stays off until an independent
  settlement-evidence gate exists. Until then payable balances stay at
  zero in production and every request is correctly denied as
  insufficient. Payout activation is therefore gated by the same switch
  chain as commission posting, not by this phase's code.
- **Cadence is informational.** The published `payout_cadence`
  (`manual`/`weekly`/`monthly`) is displayed to affiliates as the
  program's review rhythm; nothing schedules or auto-approves by it.
- **Statements & reconciliation** (Phase 6 scope): per-period affiliate
  statements and admin financial reconciliation build on
  `payout_events` + ledger journals; they are not part of this phase.
- **SQL acceptance + tracked installation** of this migration (and the
  pending Phase 3/4 migrations) on a separate test database, then
  production, remains outstanding.
