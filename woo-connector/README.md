# BrandRep Connector for WooCommerce

The store-side half of **OneToolz BrandRep** (the affiliate hub in this repo, target `brandrep.onetoolz.com`).
Install it on the OneToolz store (`cu.onetoolz.com`, WooCommerce + HPOS + CartFlows checkout + PipraPay).

It does exactly three things:

1. **Referral capture** — when a visitor lands with `?br_ref=<campaign code>`, it stores a first-click referral in first-party cookies (automatically — clicking the link is the trigger; there is no consent popup since v1.1.0) and reports the touch to the hub over the signed BrandRep bridge.
2. **Account linking** — a signed-in customer can link their store account to their BrandRep account from My Account → BrandRep.
3. **Order association** — when a linked customer who arrived via a referral link pays for an order, it sends a signed "order" event to the hub so the hub can decide attribution (first-click / 7 days / no self-referrals — the hub decides; this plugin only reports facts).

It does **not** calculate commissions, create coupons, add checkout fields, or change any order status. The hub remains the only place attribution and money decisions are made.

Bridge protocol reference: [`docs/REFERRAL_BRIDGE.md`](../docs/REFERRAL_BRIDGE.md) — this plugin implements that protocol as written.

---

## ⚠️ Before you activate: one hub-side gap

The order event sends the customer's **link token** as `Authorization: Bearer brlink_<token>`, exactly as designed for this connector. However, the hub's current bridge route (`src/app/api/referrals/bridge/route.ts`) resolves the bearer token by passing it to Supabase `auth.getUser(token)` — i.e. today it expects a **Supabase access token**, not an opaque `brlink_` token, so order events would return **401** until the hub learns to resolve `brlink_` tokens to a BrandRep user (and check that the resolved user matches `buyerUserId`).

**Capture events are unaffected** (they need no bearer token). Do not treat a failing order association as a store bug — check this hub-side item first. The fix belongs in the hub repo code, not in this plugin.

---

## Installation

1. Download `brandrep-connector.zip` from this folder (or zip the `brandrep-connector/` folder yourself — the folder itself must be the zip's top level).
2. In the store's wp-admin: **Plugins → Add New → Upload Plugin**, upload the zip, activate **BrandRep Connector for WooCommerce**.
   - WooCommerce must already be active. HPOS (custom order tables) compatibility is declared.
   - Activation only creates default settings (connector **disabled**) and registers the My Account endpoint. Nothing is tracked until you enable it in settings.
3. Go to **WooCommerce → BrandRep** and configure (below).
4. Paste the referral parameter into a test link, e.g. `https://cu.onetoolz.com/?br_ref=<a real 32-character campaign code from the hub>`, open it in a private window, and confirm:
   - the `br_ref` parameter disappears from the address bar (redirect),
   - no banner or popup appears — the capture is sent automatically at landing (hub side: a touch row; store side: with `WP_DEBUG` on, the error log shows `BrandRep bridge capture event -> HTTP 202` — status codes only, never bodies or the secret).

No code snippets, theme edits or child themes are needed or wanted.

## Settings (WooCommerce → BrandRep)

| Setting | Notes |
| --- | --- |
| Enable connector | Master switch. While off: no cookies, no linking effect, no bridge calls. Silent no-op. |
| Hub URL | Default `https://brandrep.onetoolz.com`. Base URL only, no trailing path. |
| Bridge secret | Must exactly match the hub's `REFERRAL_BRIDGE_SECRET` (32–256 characters). Stored in a WP option on this site only. Shown never; leave blank when saving to keep the saved value. It is only ever used locally to compute HMAC signatures — the secret itself is never transmitted. |

**Test connection** button: checks only that the hub site responds at `<hub URL>/program`. It deliberately never sends a bridge event, so a test can never create referral evidence.

The hub must also be configured before anything is accepted: `REFERRAL_BRIDGE_ENABLED=true`, the matching `REFERRAL_BRIDGE_SECRET`, and both referral migrations installed (see `docs/REFERRAL_BRIDGE.md`). If the hub is not ready, captures/associations simply fail and retry later — checkout is never blocked or slowed by more than one 5-second-timeout background-style call, and failures never change an order.

## How referral capture works

Landing URL format: any store URL + `?br_ref=<code>`, where `<code>` is the 32-character lowercase hex campaign code from a BrandRep campaign link (the hub's `/r/<code>` redirect should append this parameter when it sends visitors to the store — if it does not yet, links can be shared in this format directly).

Flow:

1. On landing, the plugin sets a random visitor-id cookie and (first-click only) the referral cookie, then **redirects to the same URL without `br_ref`** so the code is not bookmarked or reshared onward.
2. **First-click wins:** while a `br_ref` cookie is unexpired (7 days), a different `br_ref` never overwrites it, and the 7-day clock is never extended by later visits.
3. Capture is automatic (v1.1.0): landing via a referral link records `br_consent = yes` and sends the capture event immediately — no banner, no popup, no extra click. A legacy `br_consent = no` left by the retired v1.0.0 banner is still honoured as an opt-out: no capture is sent while it stands.
4. Capture is sent once per (visitor, code) from a given browser; a small flag cookie suppresses duplicates. If a capture fails (hub offline etc.), it is retried automatically on a later page view — no data is invented and nothing is backdated (the hub timestamps captures itself).

## How account linking works

For attribution safety (especially self-referral checks), the hub needs to know which BrandRep user a store customer is. Linking is manual and explicit:

1. The customer signs in to **BrandRep** and opens their dashboard linking section, which shows **two** values side by side:
   - the **link token** (starts with `brlink_`), and
   - their **BrandRep User ID** (a UUID).
2. On the store, the customer goes to **My Account → BrandRep** and pastes **both values** into the form. (Pasting just the bare 64-character hex part of the token also works — the `brlink_` prefix is added automatically.)
3. The plugin validates the formats and stores both in the customer's user meta (`_brandrep_link_token`, `_brandrep_user_id`).
4. The linked state is shown without exposing the credential: only the token's last 4 characters are ever displayed. **Unlink** on the same screen deletes both values immediately.

The token is a credential: it is only ever sent to the hub, as the `Authorization` header on that customer's order events. It is never put in a URL, a cookie, a log, or an order note.

## Cookies

All cookies are host-only (this store's domain only), `SameSite=Lax`, and `Secure` when the site is on HTTPS.

| Cookie | Lifetime | HttpOnly | Purpose |
| --- | --- | --- | --- |
| `br_vid` | 30 days | Yes | Random 32-byte visitor id (64 hex chars). Never leaves the device except as its SHA-256 hash. |
| `br_ref` | 7 days | Yes | The first-click campaign code. This *is* the 7-day attribution window. |
| `br_consent` | 1 year | Yes | `yes` — recorded automatically on a referral landing (v1.1.0+). A legacy `no` from the retired v1.0.0 banner is honoured as an opt-out. |
| `br_captured_<hash>` | 30 days | Yes | Set to `1` after a successful capture so the same (visitor, code) is not re-sent from this browser. |

## Data sent to the hub

Two event types, both `POST <hub URL>/api/referrals/bridge`, JSON, signed with
`x-brandrep-signature = HMAC-SHA256(secret, "<timestamp>.<request-id>.<raw body>")`.

**Capture** (exactly these keys):

```json
{ "kind": "capture", "visitorHash": "<sha256 of visitor id>", "code": "<campaign code>", "consent": true, "policyVersion": "first-click-7d-no-self-v1" }
```

**Order** (exactly these keys, plus the `Authorization: Bearer <link token>` header):

```json
{ "kind": "order", "visitorHash": "<same hash>", "orderId": "<order id as string>", "orderAt": "<order creation time, GMT, e.g. 2026-10-25T12:34:56.000Z>", "buyerUserId": "<BrandRep User ID from linking>" }
```

Order events fire when an order is paid (`woocommerce_payment_complete`) or reaches processing/completed. Sending requires **all** of: connector configured, `_brandrep_consent = yes` snapshotted on the order, a visitor hash snapshotted on the order, and a linked buyer. On `202` the order is marked `_brandrep_assoc_sent = 1`. On failure the same event (same request ID, same body — the hub deduplicates on it) is retried via WP-Cron after 15 minutes, 1 hour, then 6 hours, and then left for manual investigation.

Order meta written by this plugin: `_brandrep_visitor_hash`, `_brandrep_consent`, `_brandrep_buyer_user_id`, `_brandrep_assoc_reqid`, `_brandrep_assoc_attempts`, `_brandrep_assoc_sent`, `_brandrep_assoc_sent_at`. No order notes, no status changes.

## Privacy notes

- No fingerprinting, no IP/email-based identity, no cross-site tracking: the visitor id is a random value stored only in a first-party cookie, and only its SHA-256 ever leaves the store.
- Capture happens automatically when a referral link is clicked (v1.1.0) — there is no banner or popup. A legacy decline cookie from v1.0.0 still blocks capture for that browser until it expires or is cleared.
- The bridge secret and full event bodies are never written to any log. With `WP_DEBUG` enabled, only event kind + HTTP status code are logged.
- Evidence already accepted by the hub is retained/deleted under the hub's own policy — see the open item in `docs/REFERRAL_BRIDGE.md`.

## Limitations

- **Guest checkout = no association.** Order events require a linked, signed-in buyer. A guest order is never associated, even if it arrived via a referral (its capture may still exist hub-side, unattributed). This matches the hub protocol: guest/unlinked buyers are denied.
- **Same-browser only.** The referral lives in this browser's cookies. Click on a phone, buy on a laptop = no association. Clearing cookies and private windows break the chain by design.
- **The hub must have the order first.** The hub only associates orders it has already ingested through its Woo refresh path; an order event that arrives earlier gets a 503 and this plugin's retries (up to ~7 hours) are what eventually land it — if the order is still missing hub-side after that, the association is lost and must be handled hub-side.
- **`/r/<code>` handoff:** the hub's public redirect currently sends visitors straight to the store destination. For landings to carry the campaign code, that redirect (or the shared link) must include `?br_ref=<code>`; this plugin treats any landing with a valid `br_ref` as a referral landing.
- **Page caching:** full-page caches (LiteSpeed etc.) must not cache the landing response in a way that drops `Set-Cookie` headers or the strip-redirect. If landings misbehave behind the cache, exclude URLs containing `br_ref` from cache.
- **First-click is enforced per browser here, and again hub-side.** The hub preserves the first unexpired touch for a visitor hash; this plugin additionally never overwrites the local first click.

## Uninstall cleanup

Deactivating the plugin only disables it (settings and data remain). **Deleting** it runs `uninstall.php`, which removes:

- the `brandrep_connector_settings` option (including the bridge secret),
- all `_brandrep_link_token` / `_brandrep_user_id` user meta,
- any pending `brandrep_retry_assoc` cron events.

**Order meta is deliberately kept** (see the list above): it is the store-side evidence of what was reported for each order. To purge it too, delete the `_brandrep_%` keys from the order meta tables (`wp_postmeta` / `wp_wc_orders_meta` under HPOS) manually. Browser cookies expire on their own (max 1 year for consent) and cannot be cleared server-side after removal.
