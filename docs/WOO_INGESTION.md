# WooCommerce ingestion — nonproduction installed, disabled

## Latest checkpoint — October 16, 2026

Supersedes all historical unapplied/unexecuted states below: tracked ingestion **20261016080655** and discovery **20261016080727** installed individually on confirmed nonproduction project nwgdzzpcbqmfqujycpqk. Local migration filenames match API-assigned versions. Both installed-function acceptance suites passed in rollback transactions. Postcheck: zero events/jobs/orders/attempts, one pristine discovery checkpoint, five RLS-enabled tables; preexisting application count unchanged at one. No store requests, deployment, production credentials or switch changes. Earlier seven independent-session concurrency pairs already passed; not repeated here.

Next: eligible commercial hosting, dedicated approved production environment and production-specific configuration support, credentials/data handling approval, scheduler/monitoring and approved live read-only acceptance. Current connector intentionally remains local/staging plus fixed nonproduction database only. See `docs/LAUNCH_PLAN.md`; do not bypass gates or relabel the existing database.

## Production-store confirmation and setup boundary

User confirmed cu.onetoolz.com is PRODUCTION. Never use it for synthetic checkout/order mutations. New `WOO_PRODUCTION_STORE_ACCESS_APPROVED=true` gate is required in addition to existing verification and environment checks; it defaults false and was NOT enabled. It acknowledges production data access, not financial processing. The current application still permits only local/staging plus a nonproduction database; production-data retention/access approval is required before routing real orders there.

Run `npm run check:woo` for an offline, redacted configuration report. It makes no network requests and prints no supplied values. Exit 0 means format/configuration checks passed, NOT that credentials work, migrations exist, or launch is approved. External acceptance remains mandatory.

No PHP/theme/Code Snippets change is required for the current order connector. After receiver deployment and acceptance, use WooCommerce Settings > Advanced > REST API for a dedicated **Read** key, and Advanced > Webhooks for order notifications to the affiliate application's `/api/webhooks/woocommerce` endpoint. Do not create active webhooks pointing at localhost or an unready route. Supply credentials only through server secret management. Never put service keys, Woo consumer secrets or worker secrets in browser JavaScript or WordPress page content. A future referral attribution plugin/integration is separate and has not been built; this connector alone cannot identify the referring affiliate.

## Activation ping

The configured POST receiver now recognizes only a form-encoded `webhook_id=<positive integer>` reachability probe, limited to 64 bytes and without any `x-wc-webhook-*` headers. It returns HTTP 200/no-store without database persistence, queue changes or verification-state changes. This matches the standard Woo `WC_Webhook::deliver_ping` body/response contract; custom store filters still need live acceptance. JSON deliveries retain HMAC authentication. The route's existing disabled/unverified configuration gate applies before either path.

Activation audit: all five local Woo/server credential variables are missing and store verification is unset. Hosted ingestion/discovery migrations remain unapplied. No flags were enabled, credentials generated, scheduler deployed or store settings changed. Securely provision credentials through environment/secret management, not chat; verify store environment and checkout/payment behavior before activation. Financial execution remains unimplemented.

## Missed-order discovery increment

Validation: `npm run check` and `npm run build` exited 0; 195 unit tests passed, including 29 additional discovery/runner cases. SQL execution, concurrent discovery acceptance and actual store compatibility remain unverified.

Implemented locally, default OFF via `WOO_DISCOVERY_ENABLED=false`. The authenticated runner admits at most one discovery page before refreshing jobs, subject to its existing soft admission budget. Discovery failure is redacted and produces HTTP 503, but refresh work may continue within the remaining budget.

Discovery fetches up to 50 IDs per invocation from the fixed Woo origin, ascending by ID, with a persisted UTC creation cutoff and pagination metadata checks. Redirects are rejected; requests time out and bodies are size-bounded. No returned customer/order body is stored by discovery. IDs are inserted only when absent from the refresh queue; existing leases, generations and attempt counters are untouched. Checkpoint advancement and queue insertion share a transaction, fenced by a two-minute lease.

`F:\My VS Project\OneToolz Affiliates\supabase\migrations\20261015170000_woo_discovery.sql` is prepared, NOT installed, and requires the still-unapplied ingestion migration. `F:\My VS Project\OneToolz Affiliates\supabase\tests\woo_discovery.sql` contains rollback checks but has not yet been executed.

Offset pagination is not a transactional store snapshot: deletions/backdated insertions can shift pages. Completed scans restart after a one-hour cooldown; expired/failed claims restart from page 1. Repeated full sweeps provide eventual recovery when the dataset stabilizes, not a guarantee that a single sweep discovers every order. Persistent API errors can prevent progress and require monitoring. No scheduler or live store acceptance is claimed. Large-store scaling, detailed refunds and activation ping remain outstanding.

## Store evidence (2026-10-15)

Read-only public inspection of cu.onetoolz.com returned HTTP 200. Empty-cart checkout redirected to cart. Public checkout page ID 9 rendered an Elementor shortcode widget wrapping WooCommerce markup; REST namespaces included cartflows/v1. This suggests customized shortcode checkout, not conclusive proof of the active purchasing flow. Cart metadata listed payment option piprapay. Authenticated payment_gateways endpoint returned 401. No plugin identity/version, gateway settlement semantics, configured webhooks or custom topics were verified. No cart mutations or purchases were performed.

User confirms manual renewal orders only, not automatic WooCommerce subscriptions. Do not infer recurrence from product names. User has now confirmed this is a production store.

## Implemented locally

- Disabled Node webhook route with bounded raw-body HMAC authentication and redacted errors. Stores minimal notification metadata/hash, never raw customer bodies.
- Prepared NOT APPLIED migration 20261015150000: private event inbox, atomic enqueue/delivery conflict detection, coalesced per-order jobs, expiring fenced leases, bounded retry/backoff and attempt logs.
- Order refresh worker primitive: fixed-origin HTTPS REST GET, no redirects, timeout, bounded body, exact decimal strings, redacted projection and refund summaries. Woo paid timestamp is observed, not verified gateway settlement.
- Known-order requeue SQL primitive is wired to a disabled, authenticated worker POST entry point. No external schedule is deployed. Commission calculation/reversals/payouts remain disabled; no ledger calls.

## Activation blockers / incomplete scope

Earlier local checks passed: lint, typecheck, 122 unit tests (25 Woo tests), heuristic secret scan. The subsequent SQL rehearsal is described below; see DELIVERY_STATUS.md for the current delivery checklist.

Do not enable ingress yet. The migration and rollback assertions passed a combined nonproduction rehearsal on 2026-10-15; DDL and fixtures were rolled back. Migration remains NOT APPLIED. Tests covered duplicate/conflicting deliveries, generation changes during processing, expired/replaced lease rejection, recovery, retry cap/backoff state, known-order requeue, stale-source preservation, immutable events and role denial. This was a single-session interleaving test, not multi-session concurrency acceptance.

Review fixes: lease comparisons use wall-clock time; stale snapshots record STALE_SOURCE_SNAPSHOT and retry instead of falsely reporting success; job state constraints enforce bounded attempts and valid lease fields. Test file: `F:\My VS Project\OneToolz Affiliates\supabase\tests\woo_ingestion.sql`. For a combined rehearsal, remove the migration's final COMMIT and the test's initial BEGIN; execute as one transaction ending in ROLLBACK. Do not accidentally commit fixtures.

Need authenticated read-only Woo configuration verification: configured checkout page/content and actual flow, active gateway plugin slug/version, Woo version/HPOS, registered topics and configured webhook REST API version. Only v3-shaped order bodies are accepted. Woo initial activation ping is not yet supported and must be tested/implemented before enabling webhooks; do not weaken signature checks to accept order data.

Need secure server credential injection, deployed receiver, worker authorization/scheduling and operational rate limits. Never paste credentials into chat. Dedicated server Supabase secret has broad service privileges; deploy only after reviewing isolation and rotation. Database grants alone do not authenticate Woo bodies: only trusted server intake may call the ingestion function.

Reconciliation currently requeues known orders only. Durable paginated discovery/checkpoints for missed orders, detailed refund pagination/items, deletion/tombstone review, retention and monitoring remain to implement. A 404 or outage preserves prior state and retries; it is not evidence of cancellation or absence of refunds. Same-second changes and delayed source replicas need reconciliation acceptance tests.

Orders marked completed are NOT automatically commission eligible. Final paid evidence adapter, approved eligibility and business policies remain gates. No rule rates, holds or payout settings are inferred.

## Worker invocation contract

`POST /api/internal/woocommerce/run` requires an exact `Authorization: Bearer <WOO_WORKER_SECRET>` header. Inject a separate high-entropy 32–256 character server secret; never reuse the webhook secret. WOO_WORKER_ENABLED defaults false. Only local/staging plus explicitly nonproduction configuration is accepted, and underlying calls retain ingestion/store-verification gates. No browser session grants access. GET is not supported.

After authorization, one bounded known-order requeue call runs, then at most three sequential refresh attempts. A 20-second soft budget stops admission of further jobs; the current job is awaited. This is NOT a hard execution deadline. Database requests have 10-second timeouts and Woo reads 15-second timeouts. Hosting must allow adequate runtime for the current job to finish (including failure persistence). If a process dies, the existing database lease/retry mechanism must recover it; concurrency acceptance is still outstanding.

Responses expose only attempted/requeued counts or generic errors, with no-store caching. A successful HTTP response means the batch ran, not that every order synchronized; job/attempt records are authoritative. Do not enable a scheduler until migration installation, credentials, rate limits and end-to-end recovery are verified. Configure an external authenticated POST scheduler only after those gates; none is created by this change.