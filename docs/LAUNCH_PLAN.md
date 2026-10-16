# OneToolz BrandRep — build and live-release plan

Updated October 16, 2026. Current source implementation phase: **3 of 6 (in progress)**, not a percentage complete. Owner reports production setup is complete; prior phase-2 integration/acceptance observations below remain historical, not independently reverified. Phase 3 delivery and gaps are documented in `docs/REFERRAL_ATTRIBUTION.md`.

**Ownership correction:** the user confirms Vercel hosting is already handled. Agent work is implementation, validation, commits and pushes to main. Earlier CLI observations below are historical only, not blockers or proof about the user's deployment. Do not resume hosting/DNS/account work unless specifically asked.

## Verified now

- Revenue Engine release `d1d1fad`: GitHub Actions completed successfully. Local baseline: 233 unit tests, 26 desktop/mobile browser tests, lint/typecheck, build and heuristic secret scan passed.
- Vercel CLI access works. Connected team `rions-projects-5814501e` reports `hobby`; its complete three-project list has no BrandRep project. No project creation, purchase or deployment performed.
- A live HTTPS request to `brandrep.onetoolz.com` failed name resolution from the execution environment. This is not authoritative proof of globally missing DNS; inspect the domain's DNS zone before changing it.
- Existing Supabase project `nwgdzzpcbqmfqujycpqk` is ACTIVE_HEALTHY and remains nonproduction. Do not relabel it production or copy its credentials into public production configuration.
- Six tracked migrations are installed: identity, bootstrap, ledger, settings, Woo ingestion `20261016080655`, Woo discovery `20261016080727`. Do not rerun them on this project.
- Installed ingestion and discovery RPC acceptance passed with rollback-only fixtures. Postcheck: events/jobs/orders/attempts all zero, pristine singleton discovery checkpoint, all five Woo tables RLS-enabled, existing application count unchanged at one. No live store requests or financial postings.
- Local Woo credentials and activation attestations are absent. Connector code currently permits local/staging plus the fixed nonproduction project only; changing an environment switch cannot safely turn it into a production connector.

## Release gates — launch progressively

### A. Public pre-launch website

Engineering: deploy existing Next.js source on an eligible commercial host; retain disabled auth/Woo flags and honest pre-launch copy. Use Node 24 and `npm run build`. Attach the custom domain only after verifying deployment ownership and the provider's exact DNS instructions. Preserve unrelated DNS records. Validate HTTPS, CSP/no-store headers, mobile layout, calculator, store links and disabled endpoint behavior. Retain a rollback deployment.

Owner status: Vercel hosting is already handled, per user confirmation. No hosting access, plan change or alternative host is requested. Agent supplies validated source through Git; hosted checks remain distinct from source delivery.

Exit: public site reachable on HTTPS with live smoke evidence. This gate does not open earning or approve accounts.

### B. Accounts and application review (phase 1 closure)

Engineering: provision a distinct production Supabase project; review/install migrations in dependency order on that new empty project, not blanket-push to the existing database. Configure production-only publishable credentials, exact APP_ORIGIN and callback redirects; isolate preview/staging credentials. Verify email delivery/confirmation, reset/recovery, admin bootstrap, AAL2 review and signed-in settings save/reload. Add durable signup/reset abuse protection and review provider limits. Add structured country/channel/niche fields through tracked RPC/schema changes and policy-version acceptance after policies exist.

Owner inputs: production environment ownership/region/retention approval, verified administrator identity, support address, approved terms/privacy notices and geographic eligibility. Never paste secrets in chat.

Exit: genuine hosted application submission persists pending; MFA admin review persists; account isolation/revocation/recovery checks pass. No automatic application approval.

### C. Woo integration (phase 2 closure)

Engineering: design explicit production environment/project allowlisting without weakening preview isolation; install connector on the approved production database. Verify store Woo/HPOS/API/webhook compatibility and checkout/gateway paid evidence through read-only inspection. Securely provision least-privilege Woo Read credentials, independent webhook/worker secrets and isolated backend credentials. Deploy the signed receiver; verify activation ping/HMAC/replay behavior, authenticated POST worker, authenticated scheduling, timeouts/lease recovery, retries, discovery/reconciliation and redacted monitoring. Resolve detailed refund/deletion coverage, retention and queue-backlog alerts. The existing runner is POST-only; a GET cron request is not equivalent.

Owner inputs: secure credentials, explicit approved production-order data destination/access/retention and scheduler/hosting access. No synthetic checkouts/orders on cu.onetoolz.com. Live acceptance must use approved existing orders or naturally occurring deliveries without test store mutations.

Exit: approved real delivery reconciles idempotently into verified redacted snapshots, with monitoring and recovery evidence. Commissions remain off.

### D. Referral attribution (phase 3)

Build immutable affiliate identities; unique referral links and campaigns; approved redirect allowlist; privacy/consent-aware click/cookie capture; expiry and attribution resolution; order-to-affiliate association; and separate supported Woo checkout integration. Prevent open redirects, self-referrals and forged referral metadata. Current REST/webhook integration needs no WordPress snippet; attribution is additional work. Add applicant/affiliate authorization, rate limits, duplicate handling and cross-account tests.

Owner decisions: cookie duration, first/last-touch precedence, coupon/cross-device policy, self-referral rules, eligible channels and disclosure requirements.

Exit: approved affiliate referral maps to an eligible order under a versioned policy; privacy/expiry/duplicate/unattributed cases are tested.

### E. Commission accounting (phase 4)

Publish immutable effective-dated commercial policies distinct from drafts. Build exact-decimal/minor-unit calculation and transactional idempotent ledger postings; validation holds, releases, rejection reasons, partial/full refunds, chargebacks and reversals. Preserve paid history and record explained adjustments. Add affiliate-safe reads and ledger reconciliation; never compute balances from the public calculator.

Owner decisions: actual rates; flat/percentage model; currency; eligible products/subscriptions; recurring rules; discounts/tax/shipping basis; hold period; refund/chargeback treatment; policy cutover rules.

Exit: order/replay/refund scenarios reconcile exactly with immutable policy references, no floating-point money arithmetic and no unauthorized balance access.

### F. Disbursements (phase 5)

Start with auditable manual disbursement recording if approved, not invented provider automation. Build protected payout settings, requests, reservation/approval, duplicate/concurrency protection, payment reference recording, failure/cancellation recovery, statements and reconciliation. Only mark paid after verified settlement evidence. Automated transfers require a separate authorized provider integration and explicit release authority.

Owner decisions: methods/provider, supported countries/currencies, threshold, schedule, fees, identity/tax requirements, approvers and dispute process. No purchase or actual transfer is authorized by this document.

Exit: one eligible request completes through verified approval/settlement/reconciliation; duplicates and failed payments cannot spend funds twice.

### G. Real dashboards and launch operations (phase 6)

Connect real affiliate-scoped metrics, campaign/time filters, charts, links/resources and payout history. Provide admin queue/financial reconciliation, backlog/failure monitoring, alerts, audit and privacy retention. Complete accessibility review, keyboard/mobile testing, security/dependency review, backup/restore and rollback drills, incident procedures, support readiness and signed-in end-to-end acceptance.

Exit: no placeholder financial data, no cross-account leaks, actual balances reconcile and operational ownership is assigned.

## Immediate execution order

1. Deliver tested changes through commits and pushes to main; the owner manages Vercel. Hosting setup is not a blocker for further development.
2. In parallel, collect policy decisions and prepare production/auth security work for gate B.
3. Move the accepted connector to an explicitly approved production configuration and close gate C.
4. Build D → E → F in dependency order; wire real reporting progressively, then close G.

No reliable calendar completion date exists until production integration credentials and commercial decisions are available. A public page, operational ingestion and a fully earning/paying platform are separate milestones; owner-managed hosting does not block continued implementation.