# Store connector protocol — OneToolz store ↔ BrandRep hub

This document is the complete contract for the store-side connector (a slim
WordPress/WooCommerce plugin on `https://cu.onetoolz.com`). It covers
everything the connector must do; the hub side described here is implemented
in this repository. `docs/REFERRAL_BRIDGE.md` remains the normative
reference for the bridge receiver itself — where the two disagree, the
receiver's validation in `src/lib/referrals/bridge.ts` wins.

Status: hub side implemented; store plugin not yet built. Nothing here is
activated by writing the plugin alone: the bridge stays disabled
(`REFERRAL_BRIDGE_ENABLED=false`) until migration acceptance and the gates
in `docs/REFERRAL_BRIDGE.md` are complete.

Program rules the connector implements (approved 2026-10-16, version
`first-click-7d-no-self-v1`, `src/lib/referrals/policy.ts`): first-click
credit, a 7-day (604800 second, exclusive-expiry) window, no self-referrals.
Later clicks never overwrite or extend an unexpired first touch, and a
self-referral winner is rejected — never reassigned to a later click.

## 1. Actors and secrets

- **Hub**: `brandrep.onetoolz.com` (this repository), the only writer of
  attribution evidence. All bridge calls are server-to-server from the
  store. The connector must never call the bridge from browser JavaScript.
- **Connector**: trusted store server code. It holds, server-side only:
  - `REFERRAL_BRIDGE_SECRET` (32–256 chars, shared with the hub;
    independent of the Woo webhook and worker secrets),
  - each buyer's store-link token (per account, see §5), stored as
    protected user meta and never rendered back after saving.
- Never expose the bridge secret or a buyer's link token in public scripts,
  page HTML, query strings, logs, campaign URLs or support messages. The
  HMAC secret authorizes store assertions: anyone holding it is trusted to
  assert visitor continuity, consent and order ownership.

## 2. Referral handoff: `br_ref`

BrandRep campaign links route through the hub:

```
GET https://brandrep.onetoolz.com/r/<code>   (code = 32 lowercase hex)
→ 302 Location: https://cu.onetoolz.com<destination_path>?br_ref=<code>
```

- The hub validates the campaign via RPC, redirects only to paths on the
  fixed store origin, sets **no cookies**, and sends `Cache-Control:
  no-store` and `Referrer-Policy: no-referrer`.
- `<destination_path>` comes from the campaign (safe store paths only; the
  hub never forwards visitor-supplied query strings or external URLs).
- The connector reads `br_ref` on landing. Validation is exactly: 32
  lowercase hex characters (`^[a-f0-9]{32}$`). Anything else is ignored —
  not stored, not forwarded, not an error.
- `br_ref` is a routing hint, not evidence. On its own it grants nothing:
  it may only become a `capture` bridge event through the automatic capture in §3,
  and the hub re-validates the campaign (active, approved partner) at
  capture time.

## 3. Visitor cookie and automatic capture

- On a landing carrying a valid `br_ref`, capture is automatic (owner
  decision, connector v1.1.0): set the referral cookie and send the
  capture immediately. There is no consent banner, popup or flow, and
  the bridge `consent` field stays the literal `true`. A legacy
  `br_consent=no` opt-out cookie left by the retired v1.0.0 banner is
  still honoured: while it stands, send nothing.
- On landing, generate a cryptographically random visitor secret
  (≥ 32 bytes, from a CSPRNG) and store it in a first-party store cookie:
  - name: connector-defined, prefixed `br_` (e.g. `br_visitor`),
  - `HttpOnly; Secure; SameSite=Lax; Path=/`, host-only on
    `cu.onetoolz.com`,
  - lifetime: 7 days from the first capture; later visits never extend it
    (the hub anchors the window at the server capture time anyway).
- Derive `visitorHash = SHA-256 hex (lowercase) of the visitor secret`.
  Only the hash ever leaves the store. Do not derive it from an IP address,
  email, username, fingerprint or any reusable identifier.
- If a valid unexpired visitor cookie already exists, keep the original
  secret/hash — first click wins store-side as well. A different `br_ref`
  arriving during the window changes nothing.
- On a legacy opt-out (`br_consent=no`): stop sending events and do
  not capture for that browser.
- A BrandRep-origin cookie is impossible and irrelevant: all state lives on
  the store origin; continuity across devices is not provided.

## 4. Bridge calls

Endpoint: `POST https://brandrep.onetoolz.com/api/referrals/bridge`

Content type `application/json`; body ≤ 4096 bytes; bodies contain exactly
the keys shown — extra keys are rejected.

Headers on every call:

| Header | Value |
| --- | --- |
| `x-brandrep-timestamp` | Unix seconds, exactly 10 digits; must be within ±300 s of hub time |
| `x-brandrep-request-id` | Canonical lowercase UUID; generated once per event, reused unchanged on retries |
| `x-brandrep-signature` | Lowercase hex HMAC-SHA256, keyed with `REFERRAL_BRIDGE_SECRET`, over the exact bytes `timestamp + "." + requestId + "." + rawBody` |
| `Authorization` | Order events only: `Bearer <buyer proof>` (see §5) |

### 4.1 Capture event (automatic, on referral landing)

```json
{
  "kind": "capture",
  "visitorHash": "<64 lowercase hex>",
  "code": "<the br_ref value, 32 lowercase hex>",
  "consent": true,
  "policyVersion": "first-click-7d-no-self-v1"
}
```

- Send once per newly captured visitor secret. `consent` must be the
  literal `true`; there is no timestamp field — the hub stamps server time.
- A `202` means the event was accepted (or was an exact retry). It does
  not mean the campaign was eligible or credit exists: paused/suspended
  campaigns simply acquire no touch, and acceptance leaks no partner data.

### 4.2 Order event (at order creation)

```json
{
  "kind": "order",
  "visitorHash": "<same visitorHash as the capture>",
  "orderId": "<Woo order ID, positive safe integer as a decimal string>",
  "orderAt": "<order creation time, canonical UTC ISO with milliseconds, e.g. 2026-10-26T01:00:00.000Z>",
  "buyerUserId": "<BrandRep auth user UUID the buyer proof resolves to>"
}
```

- Trigger on order creation from the verified checkout path (support the
  store's actual checkout — CartFlows/classic — as installed; do not
  approximate from thank-you-page views).
- `orderAt` is creation time, never payment or modification time, never in
  the future, and the hub rejects orders predating the policy.
- Preconditions the hub enforces:
  - the order must already exist in `woo.orders` via the independent Woo
    webhook/refresh ingestion path — if it does not yet, the hub returns
    `503` and the connector retries (§6) until ingestion lands;
  - the buyer proof must resolve to `buyerUserId`, whose BrandRep account
    has a confirmed email (re-checked server-side by the association RPC).
- Guest checkout and buyers without a link token cannot produce a valid
  order event. Do not invent an identity for them; their orders simply
  receive no association attempt.
- The order event records an attribution *decision* (attributed /
  unattributed / self-referral / partner unavailable). It is not a
  qualified conversion, settlement proof or commission.

### 4.3 Responses

| Status | Meaning | Connector behavior |
| --- | --- | --- |
| `202` | Accepted, or exact idempotent retry | Done; record nothing else |
| `400` | Invalid event/policy/consent/timestamp data | Do not retry unchanged; log for operator review |
| `401` | Signature, freshness or buyer-identity failure | Do not retry unchanged; check clock, secret and buyer proof |
| `413` / `415` | Oversized body / non-JSON | Programming error; fix, never retry as-is |
| `503` | Bridge disabled, unsafe config, persistence or identity failure, order not yet ingested | Retry with backoff (§6) |

Response bodies are empty by design; nothing about affiliates, credit or
amounts is ever returned.

## 5. Buyer identity: store-link tokens

A buyer has no live BrandRep session during store checkout, so the link
token is the buyer proof (see `src/lib/referrals/link-token.ts` and
migration `20261026010000_referral_store_links.sql`):

- Format: `brlink_` followed by 64 lowercase hex characters.
- The buyer generates it on BrandRep (`/dashboard/referrals`, "Link your
  OneToolz store account") while signed in; the hub stores only the
  SHA-256 hash and shows the plaintext exactly once.
- The buyer pastes it in the store under **My Account → BrandRep**. The
  connector saves it as protected per-account data, never displays it
  again (show only a "linked" state), and uses it as
  `Authorization: Bearer brlink_…` on that buyer's order events.
- The hub hashes the presented token and resolves it via the
  service-role-only `resolve_store_link` RPC. Revoked or replaced tokens
  resolve to nothing; the buyer can revoke or regenerate at any time on
  BrandRep (generating a new one revokes the old), after which the store
  must be given the new token.
- The connector must verify, before sending an order event, that the
  account holding the token actually owns the Woo order. A token pasted
  into the wrong store account, or an order placed by a different account,
  must not be asserted.
- One active link per BrandRep user. A store account holds at most one
  token; saving a new one replaces it.

## 6. Retry and idempotency

- The request ID is the event's identity. Generate one UUID per logical
  event, persist it with the pending event store-side, and reuse it —
  with byte-identical body — on every retry. Reusing an ID for a different
  body or kind is a hard rejection (`40001` conflict hub-side).
- On retry you may regenerate `x-brandrep-timestamp` and the signature
  (freshness window), never the body or `orderAt`.
- Backoff: exponential with jitter (suggested start 1 minute, cap 1 hour),
  for at least 48 hours for order events, because order ingestion into
  `woo.orders` is asynchronous. A `503` may mean "not ingested yet", not
  failure.
- Transport errors are ambiguous: the first attempt may have committed.
  Retry idempotently with the same request ID instead of minting a new
  event.
- Never replay captures for a visitor carrying a legacy opt-out
  (`br_consent=no`).

## 7. What the connector must not do

- Attribution cookies are set only on a referral landing; no cross-device identity tricks;
  no fingerprinting.
- No commission math, rates or balances — the hub owns policy and ledger.
- No trusting browser- or order-meta-supplied partner codes, UUIDs or
  timestamps beyond the validated `br_ref` handoff and the stored token.
- No synthetic/test orders against the production store for acceptance;
  production acceptance uses an approved naturally occurring order only.
