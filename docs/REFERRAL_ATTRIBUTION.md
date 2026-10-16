# Phase 3 — referral attribution

## Latest increment: approved policy and trusted evidence source

Owner approved **first-click credit, 7 days, no self-referrals** on October 16, 2026. Canonical version: `first-click-7d-no-self-v1` in `src/lib/referrals/policy.ts`. The seven-day period is exactly 604800 seconds from server capture; expiry is exclusive. Later clicks do not overwrite or extend an unexpired first touch. A self-referral winner is rejected, not reassigned to a later click. Effective time is installation of the policy migration, not a backdated program start.

Added `20261016170000_referral_evidence.sql` after the campaign migration. It prepares private RLS-enabled, app-role-inaccessible policy, receipt, touch and order-decision tables. Policies/evidence/decisions are append-only. RPCs are service-role-only, serialize receipt/visitor/order handling, keep first touch, enforce expiry and suspension/role checks, reject conflicting replays and require an existing independently ingested Woo order. Association records evidence, **not** qualified conversions, payment settlement or money. Failed/missing-order attempts roll back and can retry; finalized unattributed decisions cannot be silently reassigned.

`POST /api/referrals/bridge` implements the signed inbound protocol described in `docs/REFERRAL_BRIDGE.md`. It is disabled by default, rejects previews, requires a separately approved database origin and independent signing secret, bounds JSON bodies, verifies timestamp/nonce/HMAC, and persists only through privileged RPCs. Order assertions additionally require a verified buyer's Supabase access token and confirmed email; an arbitrary buyer UUID from Woo/browser metadata is insufficient. Guest/unlinked buyers are denied rather than assuming they are not affiliates. This prevents a same-account self-referral; alternate accounts or a dishonest trusted store remain abuse risks requiring identity/fraud controls.

**Source-only:** neither referral migration has been installed by this agent. No store-side cookie/consent/identity adapter has been added to Woo, no anonymous click ingestion is exposed, and the existing public routing links still do not deliver evidence to the store. No live tracking or commissions are claimed. The owner-approved rules are shown on `/program` and the partner referral page, without an activation claim.

`supabase/tests/referral_evidence.sql` provides rollback-only fixtures for first-touch preservation, retries/conflicts, no-consent rejection, verified-order gating, self-referrals, unknown visitors, suspension and role restrictions. PostgreSQL/database acceptance, true multi-session races, signed-in checkout and production order acceptance remain unexecuted. Existing validation numbers below describe the **previous** campaign increment; see delivery status for latest results.

Latest local source validation passed: **339 unit tests, 32 desktop/mobile browser tests**, full lint, TypeScript check, heuristic secret scan and production build. Database behavior is not proven by mocked unit tests; do not install/activate without the separate SQL and integration acceptance above.

## Delivered source

- `/dashboard/referrals`: approved-partner campaign creation, own-account list and pause/resume. Server actions require identity, approved affiliate role/status and same-origin mutation checks.
- `20261016120000_referral_campaigns.sql`: additive migration, opaque unique campaign codes tied to immutable affiliate IDs, RLS reads, RPC-only writes, serialized creation/retry handling and 50-campaign account cap. Destination paths are restricted to safe path segments on the fixed OneToolz store. Application roles cannot alter codes/ownership or delete campaigns.
- `/r/[code]`: no-cache fixed-store redirect. Public-key RPC lookup reveals only a destination for an active campaign owned by an approved, role-bearing affiliate. Invalid/paused/missing campaigns fail closed. Unavailable storage returns 503, not an invented successful lookup. No service-role key is used.
- Pure attribution resolver: explicit version, first/last touch, expiry, consent, verified evidence, buyer identity/self-referral handling, bounded input and deterministic duplicate/tie handling. This is tested business logic, not a live order-association worker. Policy values in tests are synthetic, not published commercial terms.

## Production/install status

Local validation passed: lint, typecheck, **296 unit tests**, heuristic secret scan, production build and **30 desktop/mobile browser tests**. Browser tests cover anonymous access and disabled referral routing, not a signed-in production campaign or a real attributed order. Existing Vite configuration-format warning is nonblocking.

Owner reports production setup is complete and owns Vercel. No hosting changes are needed from the agent. This increment does not independently verify production settings or change any remote database, store, credentials, activation flags or financial records.

The new migration is **source-only, not installed by this increment**. Install it once through the approved production migration process after disposable-database acceptance; do not rerun the six earlier migrations. Missing storage produces a clear unavailable UI. Do not point local development at production just to run fixtures.

`supabase/tests/referral_campaigns.sql` is a rollback-only acceptance suite for an isolated nonproduction database. It covers create/retry/conflict, path restrictions, direct-write denial, own-account reads, cross-account denial, anonymous lookup/read restrictions, pause and suspension. No local PostgreSQL runtime is available in this workspace, so SQL acceptance and independent-session campaign-limit/race tests have not been executed here. Do not represent unit mocks as database acceptance.

## Deliberately not activated

Campaign links currently provide routing only. They do **not** set referral cookies, append referral evidence to store URLs, record clicks, claim conversions or earn commissions. The UI says so. No false zero-valued reporting is introduced.

Remaining Phase 3 requirements:

1. Duration/precedence/self-referral rules are now approved and encoded as above. Coupon/cross-device policy, channels and disclosure/consent language remain undecided. Do not consume draft commission settings as attribution or earning policy.
2. Consent-aware store-side capture on `cu.onetoolz.com`, with an authenticated, tamper-resistant checkout bridge supporting the actual checkout implementation. A BrandRep-origin cookie cannot establish store checkout attribution by itself.
3. Durable trusted click/touch evidence, retention/deletion and abuse controls. No anonymous click-write endpoint is shipped in this increment; the campaign cap is not a public ingress rate limiter.
4. Execute acceptance/install for the new authenticated order-association source, including unique-order concurrency, replay/conflict protection, known buyer identity and suspended-affiliate behavior. Connect the trusted store-side caller; do not trust browser or Woo metadata merely because it contains a partner code.
5. Disposable database/concurrency acceptance and signed-in browser checks; approved naturally occurring production referral/order acceptance, with no synthetic production checkout.

The existing Woo configuration still restricts ingestion to local/staging and its original nonproduction project. Production support requires an explicit isolated configuration change; an owner-reported setup does not change this source restriction. Phase 3 is **in progress**, not complete, until trusted checkout/order association is accepted. Commissions remain Phase 4; no payout authority or transfers are implied.