# OneToolz Affiliates

## GitHub handoff — OneToolz BrandRep

Repository: `rashedulislamrion/onetoolz-brandrep`. Target domain: `brandrep.onetoolz.com`. Owner has requested resuming launch work. Connected Vercel team is Hobby; eligible commercial hosting access is required before deployment. No upgrade/purchase performed.

The Revenue Engine public experience is implemented. Rebrand validation: 233 unit tests, 26 desktop/mobile browser tests, lint, typecheck, heuristic secret scan and production build passed; GitHub Actions for d1d1fad passed. This is not a live earnings or payout service. See `docs/LAUNCH_PLAN.md` for concrete release gates, remaining builds and required owner decisions; newest delivery status entries supersede historical notes below.

For Vercel, use the repository root, Next.js framework, Node.js 24 and the existing `npm run build` script. Configure environment variables in Vercel, never in Git. `.env.example` documents configuration names, not production-ready values. Do not upload `.env.local` or copy local nonproduction credentials into a public production configuration. Public pages can render without credentials; account access requires a correctly configured authentication environment. Woo ingestion, commissions and payouts are not activated by importing this repository. Configure the domain and exact authentication redirects only after verifying the deployment.

Current shipped/remaining checklist: `F:\My VS Project\OneToolz Affiliates\docs\DELIVERY_STATUS.md`. Woo intake/worker remain disabled; ingestion 20261016080655 and discovery 20261016080727 are installed and accepted on nonproduction only. No live order sync or commissions are running. Do not rerun installed migrations.

Phase 1 foundation of the approved independent affiliate platform. This is **not production-ready** and does not calculate commissions, connect to WooCommerce, or process payouts.

## Local development

Working directory: `F:\My VS Project\OneToolz Affiliates`.

Use Node.js 24 and npm. Install the locked dependencies with `npm ci`, then run `npm run dev`. The public site and setup-state account pages work without any credentials. Open localhost on port 3000 in your browser. Authentication remains disabled by default.

Commands:

```text
npm run dev
npm run check
npm run build
npm run start
npx playwright install chromium
npm run test:e2e
```

The browser suite requires a production build and starts its own server on port 3100. It explicitly disables authentication and does not connect to any provider. It tests public pages, mobile layout, headers, callback safety, and anonymous denial. It does not prove real provider authentication or RLS.

## Authentication setup — dedicated nonproduction project only

1. Copy `.env.example` to `.env.local`; never commit real environment files.
2. Provision a dedicated local/staging Supabase project, with no production data.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and a new-format `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Legacy JWT anon keys are intentionally not accepted by this foundation. No service key is needed or permitted here.
4. Set `APP_ORIGIN` to the exact browser origin, `APP_ENV=local` or `staging`, and `SUPABASE_ENVIRONMENT=nonproduction`.
5. In Supabase, require email confirmation; set password minimum to 12 characters; configure the exact site URL and callback redirect allowlist. Avoid broad production redirect wildcards.
6. Review email delivery and provider rate limits before setting `AUTH_ENABLED=true`. Public deployment also requires application-level durable rate limiting/CAPTCHA; this is not implemented yet.
7. Test registration, email confirmation, password sign-in, sign-out, reset email, and password update against that project. The PKCE callback needs the initiating browser's verifier cookie; cross-device confirmation behavior needs an explicit follow-up design/test.

Authentication uses server-only Supabase clients, HttpOnly cookies, raw-origin checks on server actions, and explicit `getUser()` checks for protected pages. The proxy refreshes sessions but is not the authorization boundary. Browser code has no Supabase privileged credential.

## Roles and application review

`F:\My VS Project\OneToolz Affiliates\src\lib\auth\access.ts` uses the protected schema:

- `user_roles(user_id, role)` readable only under reviewed RLS.
- `affiliates(user_id, status)` with `approved` as the active affiliate status.

Identity/application and administrator-bootstrap migrations are applied to nonproduction. Missing tables, denied access, or absent assignments block dashboard access. User-editable metadata never grants a role. Admin access additionally requires AAL2. MFA UI and application review exist, but no real administrator has been provisioned. Initial grants require a separately authorized database operator workflow.

## Implemented routes

Public: `/`, `/how-it-works`, `/program`.

Account: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/apply`, `/application/status`, `/account/security`.

Protected workspaces: `/dashboard`, `/admin`, `/admin/applications`. These display no fabricated financial metrics and are intentionally inaccessible without verified database authorization.

## Security and deployment limitations

- Pre-launch robots metadata disables indexing; it is not access control. Do not publicly deploy while legal notices and signup controls are incomplete.
- Nonce CSP is set for dynamic pages, with no framing and no shared response cache. Styles permit inline styling; development alone permits script eval for dev tooling.
- Nonproduction/production separation flags are guardrails, not proof that a URL belongs to the intended project. Operators must verify project ownership and isolation.
- No durable app-level rate limiter, CAPTCHA, or MFA recovery is implemented yet. Roles, RLS, audit history and MFA UI exist; live signed-in MFA/review acceptance remains incomplete. Authentication is disabled by default and enabled only in the configured local nonproduction environment.
- No financial fields, Woo API credentials, privileged Supabase keys, or production resources are configured.
- The secret-pattern checker is a heuristic. Add managed repository secret scanning before production.
- GitHub CI is a local workflow definition only until a repository is created and connected; branch protection and hosted CI have not been configured.
- Business decisions in `PROJECT_MEMORY.md` remain required before integration and finance phases.

## Dependency review

Dependencies are exact-pinned and locked. Initial tooling validation found that TypeScript 7 was incompatible with the current typescript-eslint parser; a compatible TypeScript release is used instead. Check the lockfile for the actual resolved version.

The initial npm audit reported five high-severity **development-only** findings in the Next.js ESLint plugin -> fast-glob -> micromatch -> braces chain. The registry reported braces 3.0.3 as latest, with no patched release in the advisory range at that point. Do not force an unrelated Next.js downgrade to suppress this report. Reassess before release and do not process untrusted glob patterns through tooling. See local validation results in the project memory for the final audit state.

## Next gate

Phase 1 is not fully accepted until real isolated Supabase authentication is tested, authorization/RLS is validated against the planned schema, and the remaining security/environment gates are reviewed. See `F:\My VS Project\OneToolz Affiliates\PROJECT_MEMORY.md` for the roadmap and remaining decisions.
## Phase 2A update

Identity/application SQL and `/apply` UI are implemented and database security suites have passed in rollback transactions. See `F:\My VS Project\OneToolz Affiliates\docs\DATABASE_SETUP.md` for the migrations, test procedure and acceptance limits.

### Hosted database checkpoint

Private ledger increment: migration **20261015135651** is applied to nonproduction. Operator-only posting, immutable journal checks, rollback SQL assertions and isolated multi-session concurrency tests passed. No currencies/accounts/balances were seeded in the actual ledger and no application financial access is enabled. See `F:\My VS Project\OneToolz Affiliates\docs\LEDGER_FOUNDATION.md`. Do not rerun this migration.
The identity/application migration is now applied to the verified nonproduction project (version 20261015061714). The prepared SQL security tests passed and fixtures were rolled back. Earlier statements saying the migration is unapplied are historical. Do not rerun it. See the updated DATABASE_SETUP document. No real administrator has been provisioned.

Administrator-bootstrap migration version **20261015102213** is also applied and its rollback-only test suite passed. Neither migration grants a real administrator automatically. See `F:\My VS Project\OneToolz Affiliates\docs\ADMINISTRATOR_BOOTSTRAP.md`.

### Authentication-enabled anonymous browser checks

After building, run `npm run test:e2e:auth`. This separate suite starts port 3200 using the local nonproduction Supabase configuration. It verifies an enabled login UI, protected-route denial without a session, and callback redirect safety. It does not submit credentials, enroll MFA, send email, or mutate accounts, and does not prove successful provider authentication. Missing configuration causes failures rather than silently skipping tests. Browser traces, screenshots and videos are disabled for this suite.
