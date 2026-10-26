# Trusted referral bridge — inbound protocol v1

**Production classification update:** owner confirms `nwgdzzpcbqmfqujycpqk` is production. Current source permits it only in explicitly configured production runtime and rejects it in local/staging/previews. Old statements below requiring a different production project are superseded. Use a separate test database for SQL acceptance; do not run fixture suites on production. Referral migrations are still uninstalled, bridge disabled, and store adapter incomplete. See `PRODUCTION_HANDOFF.md`.

## Status and trust boundary

Implemented receiver: `POST /api/referrals/bridge`. This is **not a completed Woo plugin** or a public click collector. The approved policy is first-click / 7 days / no self-referrals. Neither new migration is installed by this increment. Keep `REFERRAL_BRIDGE_ENABLED=false` until database acceptance and a trusted store adapter are complete.

The trusted store server must perform capture and checkout association. Never expose the signing secret, database secret or buyer bearer token in public scripts, query strings, logs or campaign URLs. The HMAC secret authorizes store assertions: anyone holding it is trusted to assert visitor continuity, consent and order ownership. A buyer token independently proves the supplied BrandRep user, but does not prove that user owns a Woo order. The adapter must verify that association. Do not treat an arbitrary signed claim as independent order/payment verification.

Buyer proof accepts two bearer credentials. A Supabase access token is verified against the identity provider and must identify a confirmed-email user. A **store-link token** (`brlink_` + 64 hex, see `20261026010000_referral_store_links.sql` and `docs/STORE_CONNECTOR.md`) is the linking mechanism for buyers who have no live BrandRep session at order time: the user generates it while signed in to BrandRep, pastes it into the store, and only its SHA-256 hash is stored hub-side. The bridge resolves the hash through the service-role-only `resolve_store_link` RPC; unknown, malformed or revoked tokens resolve to no identity and the order event is rejected. A link token proves the same BrandRep user a session token would — and nothing more: the adapter must still verify that the linked account owns the Woo order, and the association RPC still re-checks confirmed email server-side.

The API has no permissive CORS support; it is not meant for cross-site browser calls. Body/HMAC limits do not replace deployment ingress rate limits, queue bounds and monitoring. Configure those before activation. No IP, user agent, email or full checkout payload is stored by the receiver.

## Environment and migration order

- Install `20261016120000_referral_campaigns.sql`, then `20261016170000_referral_evidence.sql`, then `20261026010000_referral_store_links.sql` exactly once through the approved migration process. Woo and identity migrations are prerequisites. Do not replay previously installed migrations.
- Supply a dedicated `REFERRAL_BRIDGE_SECRET` of 32–256 characters, independent of Woo webhook/worker secrets, and a server-only `REFERRAL_SUPABASE_SECRET_KEY`.
- `REFERRAL_APPROVED_SUPABASE_URL` must exactly equal `NEXT_PUBLIC_SUPABASE_URL`. Production requires `APP_ENV=production`, `SUPABASE_ENVIRONMENT=production`, the owner-confirmed production project (`nwgdzzpcbqmfqujycpqk`), and a non-preview deployment. That same project is explicitly rejected in local, staging and preview modes.
- Only then set `REFERRAL_BRIDGE_ENABLED=true`. This does not enable the Woo worker, establish checkout consent or activate commissions. Existing Woo production configuration support remains separate.

## Envelope

Content type is `application/json`; exact UTF-8 body bytes must be signed. Maximum body: 4096 bytes.

Headers:

- `x-brandrep-timestamp`: Unix seconds, 10 decimal digits; maximum clock difference 300 seconds.
- `x-brandrep-request-id`: canonical lower-case UUID, generated once per event and reused on retries.
- `x-brandrep-signature`: lower-case hex HMAC-SHA256 over `timestamp + "." + requestId + "." + rawBody`.
- For order events only: `Authorization: Bearer <buyer proof>` — either a buyer Supabase access token, or the buyer's `brlink_` store-link token. This is independently verified by the receiver (session lookup, or hash resolution via `resolve_store_link`), must identify `buyerUserId`, and the underlying account must have confirmed email. Never use a service-role token as buyer proof.

On retry retain identical body and request ID; regenerate timestamp/signature if necessary. Reusing an ID for a different body/kind is rejected by storage. Transport errors may mean the first request committed: retry idempotently, not with a new random event identity. Do not rewrite `orderAt` to retry time.

## Capture body

Exactly these keys, no extras:

```json
{
  "kind": "capture",
  "visitorHash": "<64 lowercase hex characters>",
  "code": "<32 lowercase hex campaign code>",
  "consent": true,
  "policyVersion": "first-click-7d-no-self-v1"
}
```

The store adapter must use a cryptographically random, unguessable visitor secret, derive a stable hash and capture automatically when a referral link is clicked (owner decision, connector v1.1.0 — there is no consent popup; the bridge `consent` field remains the literal `true`, and a legacy `br_consent=no` opt-out from the retired banner still blocks capture). Do not derive identity from IP, email or fingerprinting. Store a protected first-party store cookie on that landing; never extend the seven-day first-touch expiry on later visits. The database uses server time and preserves the first unexpired capture even if another valid campaign is supplied. Operational evidence retention/deletion still needs approved implementation before launch.

No browser-supplied capture timestamp is accepted. A paused/suspended/role-revoked campaign cannot acquire new touches. Pausing a campaign stops acquisition but does not retroactively erase a valid touch; suspension/role loss prevents order credit.

## Order body

Exactly these keys:

```json
{
  "kind": "order",
  "visitorHash": "<same trusted visitor hash>",
  "orderId": "<positive safe-integer order ID as decimal string>",
  "orderAt": "2026-10-16T12:00:00.000Z",
  "buyerUserId": "<verified lower-case BrandRep auth user UUID>"
}
```

`orderAt` is the store-verified creation time, canonical UTC ISO with milliseconds, not payment/modification time. It cannot be future or pre-policy. The current redacted Woo snapshot does not carry creation/buyer identity; the trusted adapter must establish those facts independently. The order must already exist in `woo.orders` from its verified refresh path. Attribution does not prove eligibility or settlement.

Guest/unlinked purchases cannot use this endpoint successfully. BrandRep/store account linking is implemented hub-side as store-link tokens (generation/revocation on `/dashboard/referrals`, hash-only storage, resolution in the bridge — see `docs/STORE_CONNECTOR.md`); the store-side paste/storage step is the connector's part of adoption. Never substitute a client-supplied UUID or invent an unknown-buyer identity. Same-account self-referrals are rejected, including suspended former affiliates. Different-account abuse needs separate identity/fraud controls.

## Responses and acceptance

- `202`: authenticated event accepted or exact retry; no affiliate identity/credit amount is returned. This is not evidence of an attributed sale.
- `400`: invalid event, policy, consent or timestamp data.
- `401`: signature/freshness/buyer identity failure.
- `413`/`415`: oversized body/unsupported media type.
- `503`: disabled/unsafe configuration or persistence/identity-provider failure. Missing ingested order also retries through this path. Provider error details are not exposed.

Before activation: run both SQL suites on disposable nonproduction storage; verify independent-session first-click/nonce/order races, rollback and least-privilege grants. Test the actual store checkout's consent/identity adapter and delayed Woo refresh retries. Only then accept an approved naturally occurring production order without synthetic checkout. Publish retention, consent/privacy and abuse controls; add monitoring without recording secrets or bodies. Commission accounting/rates and disbursements remain separate phases.