# OneToolz BrandRep — launch runbook

Operator procedure for taking the source-complete platform live, in
dependency order. Every step names the gate that must hold before the
next one opens. Facts here come from the repo (`.env.example`, the
migrations, `docs/PRODUCTION_HANDOFF.md`, `docs/LAUNCH_PLAN.md` and the
phase docs); where a decision is still open, the runbook says so instead
of inventing one.

**Standing rules**

- The connected Supabase project `nwgdzzpcbqmfqujycpqk` is PRODUCTION.
  Never run SQL suites, fixtures, synthetic identities or rollback tests
  against it. Acceptance happens on a separate disposable test project;
  do not copy production customer data into it.
- No synthetic checkouts or orders on cu.onetoolz.com. Production
  acceptance uses approved existing orders or naturally occurring ones.
- Secrets are provisioned securely outside chat and never committed.
- Nothing in this runbook authorizes an actual money transfer. Payout
  settlement is always a manual external transfer recorded afterwards
  with its external reference.

## 1. Pre-launch checklist (dependency order)

### 1.1 Create the separate TEST Supabase project

Create a disposable Supabase project used only for migration and fixture
acceptance. It is not a production replacement and never receives
production data or production credentials.

### 1.2 Run every SQL suite on the test project

Install the migrations (step 1.3 order) on the TEST project first, then
run each rollback-only suite in `supabase/tests/`:

`administrator_bootstrap.sql`, `identity_rls.sql`,
`identity_extended.sql`, `ledger.sql`, `program_settings.sql`,
`program_policy_publication.sql`, `woo_ingestion.sql`,
`woo_discovery.sql`, `referral_campaigns.sql`, `referral_evidence.sql`,
`referral_store_links.sql`, `commission_calculations.sql`,
`commission_posting.sql`, `commission_recording.sql`,
`calculation_revisions.sql`, `payouts.sql`, `affiliate_balances.sql`,
`admin_reconciliation.sql` — plus the concurrency runbooks
`ledger_concurrency.md`, `program_settings_concurrency.md` and
`woo_concurrency.md`. Every suite must pass there before the matching
migration is installed on production. The live-auth harness
(`docs/LIVE_AUTH_TESTING.md`) also runs only against the test project;
it rejects the production project by design.

### 1.3 Install migrations on production, in filename order

Through the tracked migration process only — never ad-hoc SQL. The
seven migrations through `20261016114552_program_policy_publication.sql`
are already installed on production; do not replay them. Install the
remaining ones in this order:

1. `20261016120000_referral_campaigns.sql`
2. `20261016170000_referral_evidence.sql`
3. `20261026010000_referral_store_links.sql`
4. `20261026020000_policy_rounding_qualification.sql`
5. `20261026020100_commission_calculations.sql`
6. `20261026030000_commission_posting.sql`
7. `20261026040000_commission_recording.sql`
8. `20261026050000_calculation_revisions.sql`
9. `20261026060000_payouts.sql`
10. `20261026070000_affiliate_balances.sql`
11. `20261026070100_admin_reconciliation.sql`

Take a database backup (step 2) before each install batch.

### 1.4 Provision configuration and secrets (names only)

Production runtime: `APP_ENV=production`,
`SUPABASE_ENVIRONMENT=production`, exact `APP_ORIGIN`. Preview/local
environments must never receive production values. Variable names from
`.env.example`:

- Auth/public: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, `APP_ENV`,
  `SUPABASE_ENVIRONMENT`, `AUTH_ENABLED`
- Woo: `WOO_STORE_ORIGIN`, `WOO_APPROVED_SUPABASE_URL`,
  `WOO_READ_CONSUMER_KEY`, `WOO_READ_CONSUMER_SECRET`,
  `WOO_WEBHOOK_SECRET`, `WOO_INGESTION_SUPABASE_SECRET_KEY`,
  `WOO_WORKER_SECRET`, and the flags `WOO_INGESTION_ENABLED`,
  `WOO_STORE_VERIFIED`, `WOO_PRODUCTION_STORE_ACCESS_APPROVED`,
  `WOO_WORKER_ENABLED`, `WOO_DISCOVERY_ENABLED`
- Referral bridge: `REFERRAL_APPROVED_SUPABASE_URL`,
  `REFERRAL_BRIDGE_SECRET`, `REFERRAL_SUPABASE_SECRET_KEY`, and the
  flag `REFERRAL_BRIDGE_ENABLED`. The bridge secret must be independent
  of every other secret.
- Commissions: `COMMISSION_APPROVED_SUPABASE_URL`,
  `COMMISSION_SUPABASE_SECRET_KEY` (`sb_secret_`), `COMMISSION_WORKER_SECRET`
  (independent of the Woo and webhook secrets), and the flag
  `COMMISSION_POSTING_ENABLED`.

Woo credentials are least-privilege READ keys. Webhook, worker and
bridge secrets are all distinct values.

### 1.5 Enable flags in order

Do not turn a flag on merely because configuration parses.

1. **Auth** — `AUTH_ENABLED=true` after provider settings, callback
   redirects and rate limits are reviewed for the production origin.
2. **Referral bridge** — `REFERRAL_BRIDGE_ENABLED=true` after both
   referral migrations pass test-project acceptance (step 1.2) and the
   store connector (step 1.6) is ready to send signed captures.
3. **Woo ingestion** — `WOO_INGESTION_ENABLED=true` with
   `WOO_STORE_VERIFIED=true` and
   `WOO_PRODUCTION_STORE_ACCESS_APPROVED=true` after the store/API/
   webhook compatibility checks in gate C of `docs/LAUNCH_PLAN.md`;
   then `WOO_WORKER_ENABLED=true`, and `WOO_DISCOVERY_ENABLED=true`
   once the basic refresh path is verified. A scheduler must POST to
   `/api/internal/woocommerce/run` with the worker secret; a GET cron
   request is not equivalent.
4. **Commission posting — LAST, and gated.** `COMMISSION_POSTING_ENABLED`
   stays `false` until an independent settlement-evidence gate exists.
   Posting acts on Woo-recorded `paidAt`, which is not PipraPay
   settlement evidence (`docs/COMMISSION_ENGINE.md`). Only after that
   gate decision is made and recorded: provision the `COMMISSION_*`
   values, schedule POSTs to `/api/internal/commissions/run` with
   `COMMISSION_WORKER_SECRET`, then set
   `COMMISSION_POSTING_ENABLED=true`.

### 1.6 Install and configure the store connector plugin

Install `woo-connector/brandrep-connector` on cu.onetoolz.com (see
`woo-connector/README.md`): set the hub origin and the bridge secret
(the same `REFERRAL_BRIDGE_SECRET` value, entered in the plugin's
settings — never in chat or in the repo), and enable capture. The
plugin owns automatic referral capture (no consent popup since
connector v1.1.0), the first-party visitor cookie and the signed
capture/association calls; the hub sets no cookies.

### 1.7 Bootstrap the first administrator

Follow `docs/ADMINISTRATOR_BOOTSTRAP.md` exactly: the intended account
completes real MFA (TOTP) enrollment; a trusted database operator
independently verifies the account's Auth UUID and the authorization
reference, then calls `public.bootstrap_initial_administrator` with
bound parameters. Verify exactly one administrator role and its grant
event, then confirm an AAL1 session is denied administrative actions
and an AAL2 session is allowed. No real administrator exists until this
step is done; there is no browser or service-role provisioning path.

### 1.8 Publish the first program policy

An AAL2 administrator saves program settings (commission rate, currency,
minimum payout, hold days, payout cadence) as a draft in
`/admin/settings`, then publishes it, choosing the rounding mode and the
`paid_completed` qualification rule explicitly — publication requires
both and stores them on the immutable policy version. Nothing earns
before a policy exists, and publication alone does not enable posting.

### 1.9 Smoke-accept the full money path

On the test project the SQL suites already cover the synthetic path.
For production, use one approved naturally occurring order:

1. An approved affiliate creates a campaign and opens `/r/<code>`; it
   lands on the store with `?br_ref=<code>` appended.
2. The connector auto-captures on landing (no popup); it sends a signed
   capture and the hub records the referral touch.
3. The buyer links their store account with a store-link token from
   `/dashboard/referrals` (token shown once; only its hash is stored)
   and completes a real paid order.
4. The Woo webhook and worker ingest the order snapshot; the bridge
   association records the order decision as attributed.
5. A commissions run records the calculation; once posting is enabled
   (step 1.5.4) it posts the earn journal to held, and after
   `hold_until` a later run releases held → payable.
6. The affiliate requests a payout at or above the published minimum on
   `/dashboard/payouts`; the amount is reserved. An administrator
   approves it in `/admin/payouts`; the team sends the money outside
   BrandRep; the administrator records settlement with the external
   transfer reference.
7. Check `/admin/reconciliation`: the currency difference is `0`.
8. Refund scenario: refund that order in Woo. Ingestion updates the
   snapshot; the recording worker revises the calculation if its head
   is unposted, or the posting worker delta-reverses the over-credit if
   it is posted. Balances drop accordingly and reconciliation still
   reads `0`.

## 2. Backup and restore

Where state lives:

- **Supabase Postgres (production project) — all durable platform
  state:** identities, roles, applications; the append-only ledger
  (currencies, accounts, journals, lines); commission calculations
  (including revision chains); referral campaigns, evidence and store
  links; Woo snapshots, jobs and discovery checkpoint; payout requests
  and their append-only event trail; program settings drafts and
  published policies. If it is not in this database, BrandRep does not
  treat it as fact.
- **The WooCommerce store** remains the source of truth for orders and
  payments; the hub stores snapshots of it. The connector plugin holds
  its own settings (hub origin, bridge secret, enable flag) and
  per-customer link tokens in WordPress — covered by the store's
  existing backup process, not by this runbook.
- **Vercel (owner-managed)** is stateless application code. Its only
  state is environment configuration — keep an inventory of variable
  NAMES per environment; values live in the hosting/secret settings,
  never in the repo.

Procedure:

- Before every tracked migration install on production, take a fresh
  platform backup of the production project (or confirm point-in-time
  recovery coverage for the window) in the Supabase dashboard.
- Restore drills run against the TEST project, or into a new isolated
  project with no public access that is verified and then destroyed.
  Never restore production data into the shared test project used for
  fixture suites — it must stay free of production customer data.
- After any production restore, re-verify before reopening flags:
  migration history matches the expected list, `/admin/reconciliation`
  reads difference `0` per currency, and worker endpoints answer with
  their disabled/enabled states as intended.

## 3. Monitoring checklist

- **Woo worker** — each scheduled POST to
  `/api/internal/woocommerce/run` returns counts (`attempted`,
  `requeued`, discovery figures). Repeated non-200 responses, or a
  discovery failure flag, mean ingestion is stalled; snapshots and
  therefore commissions stop moving.
- **Commissions worker** — each POST to
  `/api/internal/commissions/run` returns counts only: `recorded`,
  `revised`, `supersedeRefused`, `posted`, `reversed`, `released`,
  `skipped`, `errors`. Watch: `errors` above zero; `supersedeRefused`
  recurring across runs (a posted calculation whose evidence keeps
  drifting — needs operator review, it never resolves itself); a rising
  `skipped` share from `basis_unavailable` on `net_items` policies
  (expected until verified net-item basis exists in ingestion — a
  coverage fact, not an alarm by itself).
- **Referral bridge** — `POST /api/referrals/bridge` returns 503 while
  `REFERRAL_BRIDGE_ENABLED` is off (expected pre-launch). After
  enablement, sustained 503s mean the gate or configuration is broken
  and store captures/associations are being refused.
- **Reconciliation** — open `/admin/reconciliation` after each
  commissions run during launch week, and always before settling any
  payout. Any currency with a non-zero difference stops settlement
  until explained.
- **Payout queue** — `/admin/payouts` shows requests awaiting review or
  settlement, oldest first. No request should age without an operator
  decision; settlement requires the external reference of a transfer
  already sent outside BrandRep.

## 4. Rollback / disable switches

Each switch is an environment change plus redeploy; none deletes data.
Ledger, calculation and payout records are append-only and survive any
disable — disabling stops new movement, it does not rewrite history.

| Switch | Effect when off |
| --- | --- |
| `AUTH_ENABLED=false` | Sign-in and registration are disabled; protected pages redirect to the login setup notice. Public pages stay up. |
| `REFERRAL_BRIDGE_ENABLED=false` | The bridge refuses every capture/association (503). Store visits are simply not recorded. |
| `WOO_INGESTION_ENABLED=false` | The webhook receiver does not persist new order notifications. |
| `WOO_WORKER_ENABLED=false` | The Woo worker route returns 503; queued jobs and discovery pause. Ingested snapshots stop advancing. |
| `WOO_DISCOVERY_ENABLED=false` | The worker keeps refreshing queued jobs but stops scanning for missed orders. |
| `COMMISSION_POSTING_ENABLED=false` | The commissions run route returns 503; recording, posting and hold release all stop (one gate for the whole Phase 4 chain). No new journals. Existing payable balances freeze as they are. |
| Store connector plugin deactivated (or its enable toggle off) | The store stops capturing touches and associating orders. Hub data already recorded is untouched. |

Payouts have no separate enable flag: requests read live payable
balances, so with posting off, balances stop growing and new requests
deny as insufficient once payable is empty. Requests already reserved
still need an operator decision (approve/settle, or reject/fail to
release the reservation) — a disable does not strand them silently, it
leaves them visible in `/admin/payouts`.
