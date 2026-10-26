# Commission engine foundation — October 26, 2026

Phase 4 source increment. Everything here is **source-only**: no migration is
installed, no worker runs, no journal is posted, no balance exists. See
`docs/COMMISSION_ACCOUNTING.md` for the arithmetic foundation this builds on
and `docs/PRODUCTION_HANDOFF.md` for database classification rules.

## Built

### Policy completion — `supabase/migrations/20261026020000_policy_rounding_qualification.sql`
- `public.program_policies` gains nullable `rounding` (`half_up`|`down`) and
  `qualification` (`paid_completed` only) columns. Rows published before this
  migration keep NULL for both — they were published without those rules and
  must not be treated as if an administrator had chosen them. The admin
  history UI renders NULL as "not recorded".
- `publish_program_policy` is replaced (old 7-argument signature dropped) with
  a 9-argument version requiring non-null rounding and qualification. Same
  security posture as before: admin role + AAL2, serialized publication,
  latest-draft / expected-version checks, identical-request idempotency
  (now comparing the two new fields too), and the existing table constraint
  still enforces minimum-payout precision against currency decimals.
- Admin UI: the publish form in `/admin/settings` now has Rounding and
  Qualification selects; `parsePolicyPublication` requires both.
  `supabase/tests/program_policy_publication.sql` was updated to the new
  signature.

### Pure engine — `src/lib/ledger/engine.ts`
- `EnginePolicy` wraps `CommissionPolicy` with the policy's own `rounding`,
  `qualification`, `holdDays` and `minimumPayout`. Rounding is NEVER chosen
  by a caller anymore — `calculateCommission` is always invoked with the
  policy's stored rounding.
- `evaluateOrder({order, attribution, policies})` returns a `skip` decision
  (`unattributed` / `no_policy` / `invalid_policy` / `invalid_order` /
  `currency_mismatch` / `zero_basis`) or a `calculation`: the quote from
  `calculateCommission`, the affiliate, the qualification outcome, and
  `holdUntil = order.createdAt + policy.holdDays`, under effect key
  `commission:order:{orderId}:policy:{version}`.
- Qualification (`paid_completed` rule): `qualified` only when the order
  status is `completed` AND a paid timestamp is present. Otherwise the
  calculation is `unqualified` (`not_completed` / `not_paid`). Unqualified
  calculations are pending estimate RECORDS with quote amounts — they are
  not earnings, and the journal-intent builder refuses them.
- `recomputeForRefund(policy, previousQuote, newCumulativeRefundedBasis)`
  reuses `calculateCommission` on the previous quote's own basis/rounding
  and returns the new quote plus the step's reversal delta; sequential
  refund deltas sum exactly to the final total reversal (no drift).
- Journal intents: `journalIntentFor` (earn: Dr platform expense /
  Cr affiliate held, qualified + net > 0 only) and
  `reversalJournalIntentFor` (opposite direction for a refund delta, keyed
  `…:refund:{cumulativeRefundedBasisMinor}`). Both return values that pass
  `validateJournal`, or null. Account IDs are opaque UUIDs owned by a future
  DB layer; the engine validates shape only.

### Persistence — `supabase/migrations/20261026020100_commission_calculations.sql`
- Private `commissions` schema, table `commissions.calculations`: append-only
  (reject trigger), RLS on, no grants to anon/authenticated. Minor amounts
  are TEXT end-to-end. `status` is only `'recorded'` for now — lifecycle
  transitions (held → payable → paid, reversals as new rows) are a later
  increment, deliberately not invented here. Unique on `effect_key` and on
  `(order_id, policy_version)`.
- `public.record_commission_calculation(jsonb)` — service_role only.
  Validates the full engine payload, idempotent on `effect_key` (same
  payload returns the existing id; conflicting payload raises SQLSTATE
  22023, ledger style), and refuses a second calculation for the same
  order+policy under a different effect key. Since the revisions
  increment below, a second STATE for the same order+policy is recorded
  as a superseding revision row instead (see "Calculation revisions").
- `public.affiliate_commission_totals()` — authenticated. Security-definer
  aggregation over ONLY the caller's own affiliate rows (caller's affiliate
  resolved via `public.affiliates.user_id = auth.uid()`; calculations store
  the `affiliates.id` identity used by referral attribution), grouped by
  currency/qualification/status with count and net-minor sum as text. No
  other affiliate's rows can contribute and no identity is caller-supplied.
- Rollback-only suite: `supabase/tests/commission_calculations.sql`
  (publish → record/idempotency/conflicts → role denials → totals isolation
  → append-only). SQL acceptance is still pending on a separate test
  database — it has NOT been run anywhere.

## Posting, release and dashboard reads — October 26, 2026 increment

### Posting surface — `supabase/migrations/20261026030000_commission_posting.sql`
Source-only, NOT installed. The private `ledger` and `commissions` schemas
stay closed to every application role; the worker reaches them only through
four security-definer RPCs (owned by the migration role, postgres — which
is also how the nested `ledger.post_journal` call passes that function's
operator-only `current_user = 'postgres'` check; service_role itself still
cannot call it or touch the tables):

- `get_or_create_commission_accounts(affiliate, currency, exponent)` —
  service_role only. Provisions the three commission accounts from the
  foundation model: platform `expense` (affiliate NULL, a per-currency
  singleton shared by all affiliates) plus per-affiliate `held` and
  `payable`. The foundation's `payable` bucket IS the available balance:
  hold release is a held → payable journal. Serialized per currency,
  idempotent, validates the affiliate exists and the currency/exponent
  pair is consistent.
- `post_commission_journal(jsonb)` — service_role only, restricted to the
  `commission:` effect-key namespace, delegates to `ledger.post_journal`
  (whose effect-key idempotency is the retry contract). Delta refund
  reversals are standalone journals under their own effect keys: the
  foundation's `journals.reverses` link requires an EXACT full
  compensation of one source journal, which a partial cumulative delta
  never is, so `p_reverses` is never accepted through this surface.
- `list_commission_calculations(qualification, due_before, limit)` —
  bounded oldest-first worker scan (with new queue/due indexes).
- `commission_posting_state(effect_key)` — earn journal id + amount,
  posted reversal total summed from `:refund:`-prefixed journals, and the
  `:release` journal id, all derived from journal lines.

### Worker — `src/lib/ledger/posting.ts`, runner + route
- `runPostingBatch(client, {limit})` / `releaseDue(client, {limit, now})`
  take a minimal RPC client (mockable; no schema access). Per-item
  isolation: one bad row is an error entry, never a batch abort.
- Earn: only QUALIFIED calculations, only via `journalIntentFor` (net).
  The maintained invariant is credited-to-held == the recorded
  `net_minor`: if an earn journal already credited more than the recorded
  net (a refund state recorded after an earlier posting), the delta is
  reversed via `reversalJournalIntentFor`, keyed by the calculation's
  cumulative refunded basis. A refund already netted into the earn posting
  therefore never reverses twice.
- Release: only when `hold_until` has passed AND an earn journal exists;
  moves the currently credited remainder held → payable under
  `<effectKey>:release`. Existing release journal = skip.
- HTTP surface: `POST /api/internal/commissions/run` with a dedicated
  `COMMISSION_WORKER_SECRET` bearer (distinct from the Woo/webhook/bridge
  secrets), a soft 20s budget (recording first, then posting, release
  with time left — see the recording increment below) and a counts-only
  response. Fail-closed gate `postingConfiguration`:
  `COMMISSION_POSTING_ENABLED=true`, no preview, allowed database
  environment, `sb_secret_` key in `COMMISSION_SUPABASE_SECRET_KEY`, exact
  `COMMISSION_APPROVED_SUPABASE_URL` match.

### Dashboard wiring
`/dashboard` now calls `affiliate_commission_totals()` and, only on
success, renders a "Recorded commission calculations" panel via the pure
mapper `src/lib/ledger/totals.ts`: per currency, qualified recorded net
labelled as the hold / available pipeline, and unqualified totals
labelled "Pending qualification estimates — NOT earnings". Amounts are
shown in exact minor units because the totals RPC carries no currency
exponent and no decimal placement is invented. The eight balance metric
cards remain unavailable placeholders — recorded calculation totals are
not ledger balances. Any RPC error or shape drift fails closed to the
previous placeholders.

## Recording worker — October 26, 2026 increment

### Read surface — `supabase/migrations/20261026040000_commission_recording.sql`
Source-only, NOT installed. Two service_role-only security-definer RPCs
are the recording worker's only reach into the private schemas:

- `list_orders_for_commission_recording(limit)` — decided orders (inner
  join of `referral.order_decisions` to `woo.orders`) with no calculation
  yet, plus recorded orders whose snapshot moved after recording as
  recheck candidates. Returns the decision's `order_at` (canonical
  millisecond UTC), outcome, affiliate, the stored snapshot as-is, and
  the recorded HEAD row's comparison fields for recheck (full head
  state since the revisions increment). Oldest decision first,
  limit 1–200.
- `list_program_policies_for_recording()` — the COMPLETE published
  policy history, version order: `policyForOrder` requires sequential,
  gap-free history and fails closed without it, so this is never the
  admin page's ten-row preview.

### Worker — `src/lib/ledger/recording.ts`
- `runRecordingBatch(client, {limit})` fetches policies once, scans
  orders, and isolates each order: a failure is an error entry
  (`invalid_snapshot`, `snapshot_mismatch`, `record_rejected`,
  `revision_rejected`, `rpc_failed`), never a batch abort. It runs
  FIRST in the commissions runner (before posting, then release) under
  the same fail-closed `COMMISSION_*` gate and counts-only response
  (`recorded`, `revised`, `supersedeRefused` merged in). Recording
  deliberately rides `COMMISSION_POSTING_ENABLED`: its rows are the
  posting worker's input, and a separate flag would silently accumulate
  unposted records.
- Attribution gate: only `outcome='attributed'` decisions record.
  `unattributed`, `self_referral` and `partner_unavailable` are counted
  skip reasons mirroring the decision vocabulary. Orders with no decision
  are not scanned at all — they can never produce a calculation.
- The stored snapshot is re-validated against the stored contract
  (ingestion's normalized output shape) before any use; shape drift is
  an error, never a guess.

### Basis-evidence decision (correctness over coverage)
- **Creation time**: from `referral.order_decisions.order_at` — the
  bridge-supplied time the association RPC validated against the stored
  order. The snapshot carries no creation time (only `modifiedAt`), and
  modified time is never substituted for it.
- **`order_total` policies record.** Basis = the snapshot's order total.
  Refunded basis = the exact sum of the stored refunds' magnitudes:
  Woo refunds are negative amounts OF the order total, and the basis
  here is that total itself, so the sum is exact for this basis. A
  positive refund total contradicts the evidence shape and skips the
  order as `basis_unavailable` rather than estimating.
- **`net_items` policies skip as `basis_unavailable`.** The stored
  snapshot has no line items at all: neither the net-items basis nor its
  refunded part is derivable, and the order-total refund sum includes
  shipping/tax refunds that cannot be allocated to items. Substituting
  it (the substitution `docs/COMMISSION_ACCOUNTING.md` prohibits) would
  fabricate amounts. Recording net-items orders requires a future
  snapshot/ingestion increment carrying verified item and refunded-item
  basis; nothing here approximates it.
- **Hold days come from the published policy row.** Publication copies
  `hold_days` (and `minimum_payout`) from the draft into the immutable
  `program_policies` row, so hold semantics are versioned with the very
  policy that prices the order. Workers never read drafts. Pre-rounding
  policies (NULL rounding/qualification) fail engine validation and skip
  as `invalid_policy` — no rule is assumed for them.

### Recheck: drift becomes a revision (see "Calculation revisions")
Recorded orders resurface as recheck candidates when their snapshot
moves. The batch re-evaluates the current evidence with the same engine
path as a first recording and diffs the payload against the recorded
HEAD: identical is `already_recorded`; a material difference (amounts,
qualification, reason, hold) is recorded as a superseding revision
(`revised`). Drift that cannot be expressed as a revision of the head —
the decision or policy identity changed, or the evidence is still
`net_items` — counts as `unresolvable_drift` and is never forced.

## Calculation revisions — October 26, 2026 increment

### Schema — `supabase/migrations/20261026050000_calculation_revisions.sql`
Source-only, NOT installed. `commissions.calculations` gains `revision`
(≥ 1), `supersedes_id` and `superseded_by_id` (deferrable self-FKs).
The `(order_id, policy_version)` unique becomes
`(order_id, policy_version, revision)`, and a partial unique index on
`(order_id, policy_version) WHERE superseded_by_id IS NULL` guarantees
exactly one HEAD per chain. Append-only is preserved and refined: the
old statement-level reject trigger still blocks DELETE/TRUNCATE, and a
new row-level guard trigger (mirroring
`referral.guard_store_link_change`) permits exactly ONE update in the
schema — the one-way supersede mark `superseded_by_id` null → new row
id, with every other column byte-identical. Content is never updated.

### Record RPC v2
Same name, signature and payload contract, plus one optional key,
`supersedesEffectKey`. Without it, v1 behavior is unchanged (idempotent
on effect key; a second row for the same order+policy conflicts 22023).
With it, the payload is a revision of the current head:

- the head's effect key must equal `supersedesEffectKey`;
- identity fields (affiliate, currency, decimals, basis, refund rule,
  rounding) must match the head — a different identity is a conflict,
  not a revision;
- at least one material field (qualification, unqualified reason, basis
  / refunded / gross / reversal / net minors, hold_until) must differ —
  a no-change revision conflicts 22023;
- **posted-head refusal**: if any ledger journal exists under the
  head's effect key (the earn key itself, its `:release`, or any
  `:refund:`-prefixed key), the RPC raises SQLSTATE **55000**
  (`object_not_in_prerequisite_state`). Money already moved is never
  rewritten by a revision; refund over-credit on a posted head remains
  the posting worker's credited == recorded-net invariant job.

On success the RPC marks the old head and inserts the new row with
`revision = head.revision + 1` and `supersedes_id = head.id`, serialized
per (order, policy) chain by an advisory lock. The worker derives the
revision's effect key as `<base>:r<revision+1>`; an exact replay of a
revision request returns the revision row's id through the ordinary
effect-key idempotency path.

### Readers see heads only
- `affiliate_commission_totals()` — counts only rows with
  `superseded_by_id IS NULL`, so a chain contributes its head's amounts
  exactly once.
- `list_commission_calculations()` (posting scan) — head-filtered;
  superseded rows are invisible to posting and release.
  `commission_posting_state(effect_key)` needed no change: it reads
  journals by the caller-supplied effect key, and the posting worker
  only ever supplies head keys from the filtered scan.
- `list_orders_for_commission_recording()` — recreated (return shape
  changed) to compare against the HEAD of the highest-policy-version
  chain and to return the head's full recorded state (effect key,
  revision, affiliate, amounts, qualification, hold) for diffing.

### Worker behavior
`runRecordingBatch` replaces the old drift counting
(`refundPendingRecheck`, `updated`) with the result shape
`{recorded, revised, supersedeRefused, skipped, errors}`; the runner
response merges `recorded` / `revised` / `supersedeRefused`. A 55000
refusal counts as `supersedeRefused` — a designed outcome, not an
error entry — and re-surfaces on every batch while the drift persists,
so a posted head whose evidence later moves stays visible rather than
silently stale. Qualification drift is now handled end to end: an order
recorded unqualified while processing is revised to qualified when it
completes and pays, and the revision is what the posting worker posts.

Rollback-only suite: `supabase/tests/calculation_revisions.sql` (first
record → supersede → totals/posting head-only → replay → no-change and
stale-target conflicts → double supersede → posted-head 55000 refusal →
guard-trigger and head-index denials). SQL acceptance is still pending
on a separate test database — it has NOT been run anywhere.

## Not built (Phase 4 remainder)
- No dispute handling or payout linkage (Phase 5).
- SQL acceptance of all five commission migrations on a separate test
  database, then tracked installation; env provisioning
  (`COMMISSION_*`) and a scheduler for the run route.

## Qualification evidence caveat
`paidAt` in the engine input is the **Woo-recorded** paid timestamp from the
order snapshot. It is not independent PipraPay settlement evidence — the
existing ingestion code records the same caveat (`paidAt` is NOT verified
settlement). Before any qualified calculation may be released or paid out, a
separate settlement-verification gate must confirm capture/settlement for
the order. The posting worker posts and releases on Woo-recorded
qualification only, so `COMMISSION_POSTING_ENABLED` must remain off until
that settlement gate exists; enabling it earlier would move real ledger
value on unverified payment evidence. Qualification alone authorizes no
money movement.
