# Production classification and next build — October 16, 2026

## Authoritative correction

The owner confirms `nwgdzzpcbqmfqujycpqk` is the **production database**. Earlier records calling it nonproduction were incorrect and are historical, not permission to test there. The previous increment did install policy publication and run rollback-only synthetic identity/policy tests on this project under that mistaken classification. Its postchecks reported no remaining fixtures; this is not a claim that production was untouched. No further synthetic or rollback acceptance tests may run there.

This increment used only read-only database tooling: seven tracked migrations, 17 application tables with RLS, zero drafts/published policies/Woo orders, absent referral campaign/decision tables, anonymous publication denied and authenticated direct policy insert denied. Management access does not establish deployed application credentials, store integration or operational readiness.

## Source delivered

- Central production classification guards: known production hostname cannot be used locally/staging even if mislabeled nonproduction; production in previews is denied.
- Auth, referral bridge, Woo ingestion and worker gates now follow that classification. Woo supports explicit production configuration and requires `WOO_APPROVED_SUPABASE_URL` to exactly match the configured URL. Other environments require a different test project.
- Worker authorization also requires valid ingestion configuration; independent secrets, activation flags, store verification, exact store origin and redacted failure behavior remain enforced.
- Live Auth fixture harness no longer hard-codes production as its approved test target; it rejects this production project even with test opt-in and a nonproduction label.
- No deployed environment, local credentials, production schema/data, activation flag, store setting or hosting setting changed. This is source readiness, not activation.

## What is needed

1. A separate disposable/staging Supabase project for migration, synthetic identity and independent-session SQL tests. Do not copy production customer data into it. No production database replacement is requested.
2. Secure runtime provisioning outside chat: production publishable auth configuration; server-only Woo read-only REST credentials; separate webhook and worker secrets; database server secret; exact approved URL. For runtime use `APP_ENV=production`, `SUPABASE_ENVIRONMENT=production` and the exact production application origin. Preview/local must not receive production credentials. Do not turn flags on merely because configuration parses.
3. Trusted Woo checkout adapter: consent/disclosure, first-party visitor continuity, secure account linking, verified order ownership/creation time and delayed idempotent association retries. Accept referral migrations on the separate test DB before reviewed production installation.
4. Admin dashboard publication of commercial values; the owner need not provide fixed commission rates. Admin-versioned rounding and qualification/hold semantics remain an accounting implementation task.
5. Verified order/refund basis and payment evidence, persisted immutable calculation records and transactional idempotent ledger postings with concurrency/refund reconciliation before earnings. Then use an approved naturally occurring order for production acceptance; no synthetic production checkout.

Phase 3 remains incomplete; the parallel phase-4 arithmetic foundation is not an earning engine. Next implementation follows these dependencies, not an assertion that an unfinished phase is complete. No actual transfers are authorized.

Validation: 411 offline unit tests, 32 anonymous desktop/mobile browser tests, full lint, TypeScript check, heuristic secret-pattern scan and final supervised production build passed. The initial direct builds exceeded the shell timeout; the final supervised build completed with exit 0. No live-auth or database fixture suite was run in this increment.