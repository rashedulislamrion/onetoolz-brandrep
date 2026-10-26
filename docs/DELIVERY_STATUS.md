# Delivery status — 2026-10-16

# Delivery status — 2026-10-26

## Phase 6 dashboards completion + launch hardening — newest

Built (source only; nothing installed, deployed or activated): the final build phase. Affiliate ledger balances are real: new source-only migration `20261026070000_affiliate_balances.sql` adds `affiliate_ledger_balances()` (authenticated; the caller's own per-currency held/payable/reserved/disputed/recovery balances derived from ledger journal lines, credits − debits, with the account exponent; existing-but-empty accounts report an exact zero, affiliates without accounts get an empty set), a fail-closed pure mapper (`src/lib/ledger/balances.ts`), a dashboard LEDGER BALANCES panel, and exactly one honestly-mapped metric card (Available payout balance ← the payable bucket; the other seven cards stay unavailable rather than forcing bucket mappings that do not mean what the cards say). Admin reconciliation is real: source-only migration `20261026070100_admin_reconciliation.sql` adds `admin_reconciliation_overview()` (admin + AAL2) and `/admin/reconciliation` verifies the per-currency invariant traced from the Phase 4/5 journal flows — expense debits − credits == held + payable + reserved + disputed + recovery + clearing (credits − debits), difference must be 0 — with head-only calculation counts by qualification and payout counts by status; the mapper recomputes the totals from components and fails closed on any inconsistency, and the page flags MISMATCH with a do-not-settle instruction. Launch hardening: new `docs/LAUNCH_RUNBOOK.md` (dependency-ordered pre-launch checklist from test-project creation through the full referral-to-refund smoke path, backup/restore by state location, monitoring checklist, and a disable switch for every enable flag), with `docs/LAUNCH_PLAN.md` gates pointing at it. The e2e foundation suite now also asserts anonymous fail-closed redirects for `/dashboard/payouts`, `/admin/payouts` and `/admin/reconciliation`. Rollback-only SQL suites `supabase/tests/affiliate_balances.sql` and `supabase/tests/admin_reconciliation.sql` added; acceptance still pending on a separate test database. Remaining launch blockers are external only: test-project provisioning + SQL acceptance, tracked installation of the eleven uninstalled migrations, secure secret/flag provisioning, store connector installation, first-administrator bootstrap, first policy publication, the natural-order smoke path, owner-side hosting confirmation, and the settlement-evidence gate decision that unlocks `COMMISSION_POSTING_ENABLED`. Validation: 582 unit tests (was 546), lint, typecheck, secret scan, production build (incl. `/admin/reconciliation`) and the full Playwright suite (38 tests, desktop + mobile) all passed.

## Phase 5 payouts

Built (source only; nothing installed, deployed or activated): Phase 5 disbursements are complete in source. New source-only migration `20261026060000_payouts.sql` adds a private `payouts` schema (`payout_requests` with idempotent request keys and policy exponent snapshots; append-only `payout_events` as the audit trail) and seven security-definer RPCs: request (approved affiliate; amount ≥ current published policy minimum for the currency; atomic payable → reserved reservation journal), cancel (owner, releases), review (admin + AAL2, maker-checker in the RPC; approve keeps funds reserved, reject releases), settle (admin + AAL2, from approved, only with an external transfer reference; reserved → clearing), fail (admin + AAL2; reason recorded, reservation released), plus own-rows `affiliate_payout_overview()` and the admin `admin_payout_queue()`. Settlement is recording only — no automated transfer exists or is authorized; an admin records a transfer already sent outside BrandRep with its external reference. New `src/lib/payouts/` (transition table, form parsers, fail-closed mappers), `/dashboard/payouts` (balances, request form, history, cancel; linked from the dashboard) and `/admin/payouts` (review/settle/fail queue; linked from the admin home). Rollback-only SQL suite `supabase/tests/payouts.sql` covers the full lifecycle; acceptance still pending on a separate test database. Remaining before payout activation: SQL acceptance + tracked installation, and the settlement-evidence gate chain — payable balances only fill when Phase 4 posting releases matured holds, and COMMISSION_POSTING_ENABLED stays off until that gate exists, so production requests will correctly deny as insufficient until then. Cadence is informational only; statements/reconciliation remain Phase 6. Validation: 546 unit tests (was 513), lint, typecheck, secret scan and production build (24 routes, incl. both payout pages) all passed. See `docs/PAYOUTS.md`.

## Phase 4 calculation revisions (supersede support)

Built (source only; nothing installed, deployed or activated): the qualification-drift blocker is closed — a calculation recorded while an order is unqualified can now be revised to qualified when the order completes and pays. New source-only migration `20261026050000_calculation_revisions.sql` adds revision chains to `commissions.calculations` (revision / supersedes_id / superseded_by_id, unique per (order, policy, revision), a partial unique index guaranteeing one HEAD per chain, and a guard trigger permitting only the one-way supersede mark — append-only otherwise preserved). `record_commission_calculation` v2 keeps its signature and payload, gaining an optional `supersedesEffectKey`: revisions must target the current head, match its identity fields and change a material field, and a head with posted journals is refused with SQLSTATE 55000 (money already moved is never rewritten; the posting invariant keeps governing it). Totals and the posting scan now read heads only, and the recording scan returns the head's full recorded state for diffing. The recording worker's result shape is now `{recorded, revised, supersedeRefused, skipped, errors}` and the runner merges the new counts. Rollback-only SQL suite `supabase/tests/calculation_revisions.sql` added; acceptance still pending on a separate test database. Remaining before end-to-end Phase 4 operation: SQL acceptance of the five commission migrations then tracked installation, COMMISSION_* env provisioning and scheduling, the settlement-evidence gate, and verified net-item basis extraction in ingestion. Validation: 513 unit tests (was 511), lint, typecheck, secret scan and production build (22 routes) all passed. See `docs/COMMISSION_ENGINE.md` ("Calculation revisions").

## Phase 4 recording worker

Built (source only; nothing installed, deployed or activated): the recording worker `src/lib/ledger/recording.ts` is now the first caller of `record_commission_calculation`. New source-only migration `20261026040000_commission_recording.sql` adds its entire read surface as two service_role-only security-definer RPCs — a decided-order scan (unrecorded orders plus recorded orders whose snapshot moved, as recheck candidates) and the complete published policy history (never the admin preview) — with a rollback-only SQL suite. Evidence decisions: creation time comes from the validated `referral.order_decisions.order_at` (the stored Woo snapshot carries none); hold days come from the immutable published policy row (versioned at publication, drafts never read); `order_total` policies record with refunded basis as the exact sum of refund magnitudes, while `net_items` policies skip as `basis_unavailable` because snapshots hold no line items and total refunds are never substituted for refunded-item basis. Because calculations are append-only, the worker records first-time calculations only and counts post-record drift (refund growth or qualification flips) as `refundPendingRecheck` — refund money remains covered by the posting invariant, qualification drift remains an explicitly documented gap needing a future supersede-schema decision. The commissions runner now runs recording → posting → release under the same fail-closed gate, with `recorded`/`refundRecheck` added to the counts-only response. Validation: 511 unit tests (was 498), lint, typecheck, secret scan and production build all passed. See `docs/COMMISSION_ENGINE.md`. Remaining before end-to-end Phase 4 operation: SQL acceptance of the four commission migrations on a separate test database then tracked installation, COMMISSION_* env provisioning and scheduling, the settlement-evidence gate, the supersede decision, and verified net-item basis extraction in ingestion.

## Phase 4 completion increment: posting worker, hold release, dashboard totals

Built (source only; nothing installed, deployed or activated): source-only migration `20261026030000_commission_posting.sql` adds the worker's entire database surface as four service_role-only security-definer RPCs over the still-closed private ledger/commissions schemas — account provisioning (platform expense singleton per currency; per-affiliate held + payable, where payable is the foundation's available bucket), a `commission:`-namespaced journal posting delegate to `ledger.post_journal` (definer ownership satisfies its postgres-only check; service_role still cannot post directly), a bounded calculation scan, and a posting-state probe derived from journal lines — plus queue/due indexes and a rollback-only SQL suite. New worker `src/lib/ledger/posting.ts` posts earn journals for qualified recorded calculations (invariant: credited-to-held == recorded net; over-credit is delta-reversed, never double-counted), releases matured holds held → payable, isolates per-item failures, and runs behind `POST /api/internal/commissions/run` with a dedicated worker secret, fail-closed `COMMISSION_*` configuration and counts-only responses. `/dashboard` now renders real recorded-calculation totals (qualified = hold/available pipeline; unqualified labelled NOT earnings; exact minor units) when `affiliate_commission_totals()` succeeds, and fails closed to the previous honest placeholders otherwise. Remaining for Phase 4: the calculation-recording worker and reversal-row persistence, SQL acceptance of the three commission migrations on a separate test database then tracked installation, COMMISSION_* env provisioning and scheduling, and the settlement-evidence gate — posting acts on Woo-recorded paidAt only, so the worker stays disabled until that gate exists. Validation: 498 unit tests (was 459), lint, typecheck, secret scan and production build (22 routes) all passed. See `docs/COMMISSION_ENGINE.md`.

## Phase 4 commission engine foundation

Built (source only; nothing installed, deployed or activated): admin policy publication now carries the rounding and qualification rules the engine must never guess — source-only migration `20261026020000_policy_rounding_qualification.sql` adds nullable `rounding`/`qualification` to `program_policies` (older rows stay NULL, rendered "not recorded") and replaces `publish_program_policy` with a 9-argument version requiring both; the `/admin/settings` publish form, parser and action all require and pass them, and the publication rollback suite uses the new signature. New pure engine `src/lib/ledger/engine.ts`: policy-pinned commission quotes, `paid_completed` qualification (completed + paid timestamp; anything else is a labelled pending estimate, not an earning), hold-until, cumulative refund recompute without rounding drift, and balanced journal intents (values only — no posting). Source-only migration `20261026020100_commission_calculations.sql` adds private append-only `commissions.calculations`, the idempotent service-role record RPC and the own-rows-only `affiliate_commission_totals()` RPC, with a rollback-only SQL suite. Remaining for Phase 4: posting worker, hold-release job, reversal-row persistence, dashboard wiring of totals, settlement-evidence qualification beyond Woo-recorded `paidAt`, and SQL acceptance of both migrations on a separate test database. One repair note: the tracked-file half of this increment was lost to a parent-session `git reset --hard` after first verification and has been re-applied exactly as designed and re-verified. Validation: 459 unit tests (was 436), lint, typecheck, secret scan and production build all passed. See `docs/COMMISSION_ENGINE.md`.

## Phase 3 hub-side increment

Built (source only; nothing installed, deployed or activated): `/r/[code]` now hands the campaign to the store as `?br_ref=<code>` on the 302 Location (hub still sets no cookies). Buyer store-link tokens solve bridge buyer identity without a Supabase session at order time — `brlink_` + 64 hex tokens generated on `/dashboard/referrals`, shown once, stored only as SHA-256 hashes; new source-only migration `20261026010000_referral_store_links.sql` adds private `referral.store_links`, a revoke-only guard trigger, and `create_store_link` / `revoke_store_link` / `resolve_store_link` (service-role) / `store_link_status` RPCs, with a rollback-only SQL suite (acceptance still pending on a separate test database). The bridge resolves `brlink_` bearers through that RPC and keeps the Supabase session path otherwise. `docs/STORE_CONNECTOR.md` documents the full store-plugin protocol; `docs/REFERRAL_BRIDGE.md` buyer-proof sections updated. Remaining for Phase 3: build/install the store plugin, accept and install referral migrations (campaigns, evidence, store links) on test DB then production, provision bridge secrets/flags, and accept one approved naturally occurring production order. Validation: 436 unit tests (was 411), lint, typecheck, secret scan and production build all passed.


# Delivery status — 2026-10-25

## Documentation classification fix — newest

Audited every current-guidance document against the authoritative production correction below. `docs/LIVE_AUTH_TESTING.md` still named the production project `nwgdzzpcbqmfqujycpqk` as the live-auth test target; corrected to a separate-test-project placeholder with an explicit prohibition. Present-tense "installed on nonproduction" claims corrected in README, LAUNCH_PLAN, WOO_INGESTION, PROGRAM_SETTINGS, COMMISSION_ACCOUNTING and this file's current-state table; REFERRAL_BRIDGE production-project rule corrected to match the code guard; correction banners added to LEDGER_FOUNDATION, DATABASE_SETUP and the concurrency runbooks. Historical dated entries remain as a log under their banners. No code/schema/data/activation changes. HEAD verification before the fix: 411 unit tests, lint, typecheck, secret scan and production build all passed. Phase 3 remains in progress; next build is the store-side Woo referral adapter.


## Production classification correction — authoritative newest

Owner confirms connected project `nwgdzzpcbqmfqujycpqk` is PRODUCTION. Earlier nonproduction labels below are incorrect; prior fixture tests occurred under that mistake. Current work performed only read-only production audit and source changes: production-aware auth/Woo/referral guards, exact Woo database approval, worker prerequisites and live-auth production fixture denial. Seven migrations and 17 RLS-enabled tables verified; drafts/policies/orders zero; referral tables absent. No production writes or activation this increment. See `PRODUCTION_HANDOFF.md` for requirements and next implementation gates. Phase 3 and phase 4 are not complete.

## Database connection and next-phase arithmetic — newest

Verified active Supabase connection and installed only the accepted policy-publication migration on nonproduction as `20261016114552`. Six prior migrations were not rerun. Rollback rehearsal and installed RPC authorization/retry/conflict/precision acceptance passed, including immutability denial. Postchecks: policies/drafts/test users zero; application count unchanged at one; Woo orders zero; least-privilege grants and RLS verified. No actual policy, checkout, earning or transfer created. Referral migrations remain uninstalled and their acceptance is still pending.

Added offline phase-4 commission arithmetic/policy selection foundation: exact bigint minor units, complete effective-dated history, explicit rounding, admin-selected rate/basis/refunds and cumulative reversal reconciliation. It does not post journals or complete phase 3/4. See `COMMISSION_ACCOUNTING.md`. Production connection, signed-in publication and independent-session publication race acceptance remain unverified. Hosting untouched.

Validation: 405 unit tests, 32 desktop/mobile browser tests, full lint/typecheck, heuristic secret-pattern scan and final production build passed. Database acceptance was real rollback SQL against nonproduction, not unit mocks; no production fixtures or store requests.

## Approved attribution rules and evidence source — newest

Owner approved first-click / 7 days / no self-referrals. Implemented canonical policy, self-referral winner rejection without later-click fallback, public rule copy, signed inbound bridge, and additive private evidence/order-decision migration. Neither referral migration is installed by this increment. No store-side cookie/consent/identity adapter or live order acceptance yet; no remote data/hosting/financial changes. Phase 3/6 remains in progress. See `docs/REFERRAL_BRIDGE.md` and latest `docs/REFERRAL_ATTRIBUTION.md` section. Commission rules remain unapproved; no earning/payout activation.

Validation: 339 unit tests, 32 desktop/mobile browser tests, full lint, TypeScript check, heuristic secret scan and production build passed. SQL acceptance/concurrency and trusted store/live order acceptance are not covered by those results and remain pending. A test-only TypeScript inference error was corrected before the final successful build/checks.

## Phase 3 — latest source increment

Owner reports production setup is complete. Implemented campaign/link-management source, fixed-store public routing, explicit-policy attribution resolver and additive referral migration. See `docs/REFERRAL_ATTRIBUTION.md` for scope and acceptance gaps. Phase 3 remains in progress: no cookie/click capture, trusted checkout bridge or order association is live from this increment. Migration is not installed; no remote database/store or hosting changes performed. Existing Woo production source restriction remains.

Local validation passed: lint, typecheck, 296 unit tests, heuristic secret scan, production build and 30 desktop/mobile browser tests. Database/concurrency and signed-in/live referral-order acceptance remain unverified.

## Deployment ownership correction — supersedes hosting blockers below

User confirms Vercel hosting is already handled. Agent delivers tested code through commits and pushes to main; no hosting/DNS/account work is requested. Earlier CLI account observations are not authoritative for the user's deployment and are not development blockers. Hosted functionality is not independently verified here. Current phase remains 2 of 6; remaining backend/integration/policy work is unchanged.

## Live-release request — latest authoritative checkpoint

**Phase 2 of 6.** Owner requested making the platform live and planning the remaining build. This supersedes owner-only deployment responsibility; deployment work can resume, but purchases, unknown commercial policies and actual fund transfers are not authorized.

Installed this increment: Woo ingestion **20261016080655** and discovery **20261016080727** individually through tracked migration tooling on the existing nonproduction project. Installed RPC acceptance passed for both suites with rollback-only fixtures. Cleanup: zero events/jobs/orders/attempts; one pristine discovery checkpoint; five RLS-enabled Woo tables; existing application count unchanged at one. Local migration filenames aligned to assigned versions. Do not rerun these migrations or repeat completed independent-session races as outstanding.

Post-install source validation passed: lint, typecheck, 233 unit tests and heuristic secret scan, including renamed-migration SQL emitter regressions. No application runtime source changed; production build/browser suites were not repeated this increment (previous rebrand build and 26 browser tests passed).

Live status: **not deployed**. Verified Vercel account access and complete project list; only connected team is Hobby, with no BrandRep project. Eligible commercial hosting is needed; no upgrade or charge performed. Custom-domain HTTPS failed DNS resolution in this environment; inspect authoritative records before editing DNS. Rebrand commit d1d1fad GitHub Actions passed. No Woo requests, production-data ingestion, auth environment relabeling, financial activation or DNS modifications.

Remaining plan and release gates: `docs/LAUNCH_PLAN.md`. Immediate blockers: eligible hosting access, dedicated approved production database/auth security and policies, secure Woo credentials/data-handling approval. Production Woo support is not implemented: current code is deliberately staging/nonproduction-only, not a switch to bypass. Attribution → commissions → disbursements → real reporting remain substantive builds.

## Revenue Engine rebrand — current increment

**Phase 2 of 6 — Woo integration and deployment** remains current. Built: dark financial design system, self-hosted font setup, revenue hero preview, referral flow, scenario calculator, motion/reduced-motion, protected command-center unavailable states, application grouping and policy-readiness checklist. See `docs/REVENUE_ENGINE.md` for explicit integration gaps.

Installed/live: no database, store, activation, DNS or hosting changes. Deployment remains user-managed. Dashboard presentation is not completed reporting or accounting. Application server actions and stored fields are unchanged; structured country/channel/niche and versioned terms/privacy consent remain pending tracked schema changes and published policies.

Validation: production build, lint/typecheck, 233 unit tests, 26 desktop/mobile browser tests and heuristic secret-pattern scan passed. Added projection boundary tests and protected dashboard authorization/unavailable-state tests. Signed-in hosted visual/save acceptance is not covered by these anonymous browser runs. Existing Vite config-format warning remains nonblocking.

Hosted CI baseline verified using GitHub Actions API: prior commit `b793c78` completed successfully in run `38837066180`. This does not establish CI for the new redesign commit.

Remaining/blockers: accepted Woo migrations still need tracked nonproduction installation and installed-RPC acceptance; credentials, production-data authorization and hosted receiver/scheduler/live acceptance remain outstanding. Attribution, commissions, payouts and real reporting remain phases 3–6. Hosted signed-in acceptance and commercial policy approval are required before launch.

## Overall result

## Numbered launch roadmap — current reporting baseline

Current phase: **Phase 2 of 6 — Woo integration and deployment**. Phase numbers describe scope, not equal amounts of work or a percentage complete.

| Phase | Built | Remaining / live status |
| --- | --- | --- |
| 1. Accounts and administration | Accounts, applications, MFA, admin review, settings drafts, private ledger foundation | Database foundation installed on the production-classified project (mislabeled nonproduction at install time); public deployment, signed-in settings acceptance and auth launch controls remain |
| 2. Woo integration and deployment (CURRENT) | Receiver, queue, refresh worker, reconciliation, discovery; connector migrations installed on the production-classified project; installed-RPC and previous independent-session acceptance | Eligible hosting, approved production configuration, secure credentials, receiver/scheduler deployment and real ingestion acceptance |
| 3. Referral attribution | Not implemented | Referral links, click/cookie handling, order-to-affiliate association and attribution rules |
| 4. Commission accounting | Ledger foundation only | Publish approved policies, calculate earnings, holds, refunds/reversals, expose balances |
| 5. Disbursements | Settings drafts only | Payout requests, review, payment recording, reconciliation and audit |
| 6. Dashboards and launch | Premium protected unavailable-state workspace | Real metrics, operational monitoring, recovery controls and full end-to-end launch acceptance |

Deployment inspection: no Git remote, hosting project link/configuration or Vercel executable found in this workspace. Tool discovery did not return a usable Vercel deployment integration. Hosting provider/account and application domain must be resolved before publishing. This is not a request to repeat completed database tests.

User priority: ship visible functionality quickly and move toward live launch. Every completion report must include phase number, built changes, installed/live changes, remaining work and concrete blockers. Do not present testing or local builds as deployment, or broad launch intent as approval of unknown commission rules or payment transfers.

Timing: no reliable calendar estimate until hosting access, secure Woo credentials and commercial/attribution rules are settled. A hosted account/admin release is a smaller milestone than a fully operational affiliate/earnings/payout launch; phases 3–5 are substantial implementation, not activation switches.

Account/application foundation and private ledger exist. Store ingestion is under development and OFF. No live order sync, commission accounting, or payouts are running.

| Component | Code | Hosted/operational state | Remaining acceptance |
| --- | --- | --- | --- |
| Auth/applications/MFA/admin review | Implemented | Identity/bootstrap migrations installed; MFA manually verified by user | Recovery and signed-in review acceptance |
| Private ledger | Implemented | Installed on the production-classified project; empty | Financial policy, affiliate read interfaces, full rebuild/CI |
| Signed webhook receiver | Implemented, including isolated activation-ping handling | Disabled, not deployed | Live webhook acceptance, operational limits |
| Durable ingestion queue | Migration prepared | Combined rollback rehearsal and isolated independent-session races passed; NOT installed | Tracked installation and installed-function postchecks |
| Order refresh/status/refund summaries | Implemented | No live processing | PipraPay evidence verification, detailed refunds, end-to-end acceptance |
| Worker invocation | Authenticated POST route implemented | Disabled; no external schedule deployed | Provider schedule and overlap/recovery acceptance |
| Known-order reconciliation | Requeue wired into worker invocation | Disabled | Hosted acceptance |
| Missed-order discovery | Page fetcher, worker integration and checkpoint migration implemented locally | Combined rollback rehearsal and isolated concurrency passed; disabled; migration NOT installed | Tracked installation, store compatibility and live acceptance |
| Commission calculation/reversals/payouts | Intentionally not implemented | Disabled | Approved commercial rules |
| Admin commission/disbursement settings | Draft editor, validation, revision history and guarded save RPC implemented | Settings migration installed on the production-classified project; database save/read and two-session concurrency passed; no policy seeded | Signed-in browser save/reload and frontend deployment; publication/execution remain separate |

## Latest delivery

GitHub handoff completed: initial application commit pushed to `rashedulislamrion/onetoolz-brandrep`, branch `main`. Source, migrations, tests and CI workflow included; local environment files, credentials and generated artifacts excluded. Secret-pattern scan passed before publishing. User handles Vercel import/deployment. GitHub publication is not a live application deployment or database installation; hosted CI result is not yet verified.

Rebranding validation: 219 unit tests, lint/typecheck, heuristic secret scan, production build and 24 desktop/mobile browser tests passed. Browser coverage includes no horizontal overflow, opportunity CTA navigation, expandable FAQ and reduced-motion behavior. This is a public-experience first pass; protected dashboards and financial functionality were not redesigned or completed.

User changed release workflow to GitHub first, with Vercel deployment handled by the user. Current work is a visible public-experience redesign within Phase 2, not completion of attribution or finance phases. First pass implemented: opportunity-led home, animated journey artwork, main-store promotion, registration CTAs, native FAQs, mobile styling, reduced-motion handling, matching registration introduction and revised how-it-works/metadata. No earnings claims or invented rates. GitHub repository URL/access still needed; no remote or gh executable configured. No push or deployment claimed.

Vercel login verified as rashedulislamrion, team rions-projects-5814501e (Hobby). Hosting choice is confirmed: Vercel, brandrep.onetoolz.com. Commercial launch requires a suitable Vercel plan; no upgrade, deployment or DNS change performed. Login is no longer a blocker. This supersedes earlier lack-of-CLI-access notes.

Independent-session acceptance passed in a disposable schema: seven paired races with distinct backend PIDs and observed blocking, plus checkpoint-failure atomicity. Covered duplicates, exclusive claims, generation changes, replacement tokens, stale snapshots, atomic visibility and webhook/discovery collisions. See `supabase/tests/woo_concurrency.md` for evidence and limits. Fixture removed; real Woo schema/RPC absent; migration history remains four entries. Installation is now the next database milestone, not yet performed.

Current validation: 219 tests, lint, typecheck and heuristic secret scan passed. No application/runtime code changed; production build was not rerun in this fixture/documentation increment (previous build passed).

Combined ingestion/discovery database rehearsal passed on the confirmed nonproduction project. Both migration bodies and both SQL acceptance suites ran in one rollback-only transaction, with embedded transaction wrappers removed. Final result: `rollback_verified=true`. No connector schema, fixtures or migration-history entries persisted. This is sequential database acceptance, not independent-session concurrency acceptance; installation remains gated on those races.

Added `scripts/woo-rehearsal.mjs`, an offline SQL composer that checks source wrappers and emits one rollback-only transaction with prerequisite/absent-schema guards and timeouts. It does not connect to a database. Added a source-body/transaction-boundary regression test. Expanded the heuristic secret scanner to cover `.mts` and `.sql` files as well.

Validation: 218 unit tests, lint, typecheck, expanded heuristic secret scan and production build passed. Independent postcheck confirmed Woo schema and ingestion/discovery RPCs absent; installed migration count remains four. Existing nonfatal Vite configuration warning remains.

Earlier production confirmation increment: added explicit production-store access gate and offline `npm run check:woo` report. No secrets echoed or store requests made. Its 216-test validation and production build passed. Configuration remains blocked; database rehearsal and isolated concurrency acceptance have since passed as recorded above.

Ping increment validation: check/build exit 0; 213 unit tests (18 new ping cases), lint/typecheck and heuristic secret scan passed. Live ping and browser acceptance were not run.

Activation request audit: local Woo credentials are all absent (webhook secret, worker secret, read key/secret and ingestion database key); store verification is unset. Hosted migration history contains identity, bootstrap, ledger and settings only. No activation switches were changed. Added strict unsigned form-ping acknowledgement (64-byte limit, no delivery headers, no persistence); signed order deliveries still require HMAC. This does not verify store identity or create jobs.

- Added separate worker authorization, fail-closed environment gates, three-job batch cap, soft admission deadline, no-store/redacted responses and bounded database requests.
- Known-order requeue runs before each authorized batch. Reports attempted jobs, not successful synchronizations (SQL records the actual outcome).
- No migrations applied, store settings changed, credentials read, or schedules activated.
- Validation: lint/typecheck, 139 unit tests (17 new runner cases), heuristic secret scan and production build passed. Browser and live scheduled execution were not tested in this increment.

## Next build order

User requested visible admin configuration progress. Added `/admin/settings` for versioned drafts (rate, currency, minimum payout, hold days and review cadence). No commercial values are preselected. This increment does not complete missed-order discovery.

Settings installation increment validated: 166 unit tests, lint/typecheck, heuristic secret scan, production build and 20 anonymous desktop/mobile browser tests passed. Database migration installed as `20261015155702`; authorization, save/read, constraints, retries and genuine concurrent sessions tested. Fixtures cleaned, settings empty, Woo schema absent. Signed-in settings browser acceptance remains outstanding (not another general MFA retest).

1. Combined discovery/ingestion rollback rehearsal and isolated independent-session races complete.
2. Tracked nonproduction installation and installed-function acceptance/postchecks.
3. Activation ping and worker/live ingestion acceptance.
4. Enable only after deployment controls and store inspection are verified.

## Required external verification (not a blocker for isolated coding)

- Confirmed by user: cu.onetoolz.com is PRODUCTION. Production-data handling and activation approval remain separate from this classification.
- Authenticated checkout implementation and PipraPay plugin slug/version/payment semantics.
- Secure read-only Woo credentials and server secrets, supplied outside chat.
- Commission policies remain undecided; completed status alone never awards earnings.