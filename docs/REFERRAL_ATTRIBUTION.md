# Phase 3 — referral attribution

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

1. Owner-approved duration, first/last precedence, coupon/cross-device policy, self-referral identity rules, channels and disclosure/consent language. Publish immutable effective versions; do not consume draft commission settings as policy.
2. Consent-aware store-side capture on `cu.onetoolz.com`, with an authenticated, tamper-resistant checkout bridge supporting the actual checkout implementation. A BrandRep-origin cookie cannot establish store checkout attribution by itself.
3. Durable trusted click/touch evidence, retention/deletion and abuse controls. No anonymous click-write endpoint is shipped in this increment; the campaign cap is not a public ingress rate limiter.
4. Authenticated order association with unique order constraints, immutable evidence/policy references, replay/conflict protection, known buyer identity and suspended-affiliate behavior. Do not trust browser or Woo metadata merely because it contains a partner code.
5. Disposable database/concurrency acceptance and signed-in browser checks; approved naturally occurring production referral/order acceptance, with no synthetic production checkout.

The existing Woo configuration still restricts ingestion to local/staging and its original nonproduction project. Production support requires an explicit isolated configuration change; an owner-reported setup does not change this source restriction. Phase 3 is **in progress**, not complete, until trusted checkout/order association is accepted. Commissions remain Phase 4; no payout authority or transfers are implied.