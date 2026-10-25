# Live authentication acceptance harness

Status: the user reports that MFA worked in earlier live manual testing and has directed development to continue. This is user-reported verification, not a successful run of this automated harness. Automated live execution still requires explicit test-process configuration. Recovery and concurrency acceptance remain open; rerunning MFA is not a prerequisite for isolated ledger development.

## Scope

`npm run test:e2e:live-auth` starts the built app on port 3300 and creates one disposable confirmed Auth account using the server-side admin API. It tests password sign-in, non-admin denial, TOTP enrollment, sign-out, a fresh-session TOTP challenge, and anonymous denial after sign-out. No application, affiliate, administrator or financial records are created.

The suite uses one desktop worker, no retries, and disables browser traces/screenshots/video. It keeps the password and TOTP key in memory. The application subprocess receives an empty test admin-key variable.

## Required test-process environment

- `RUN_LIVE_AUTH_TESTS=true`
- `APP_ENV=local`
- `SUPABASE_ENVIRONMENT=nonproduction`
- `E2E_SUPABASE_PROJECT_REF=<ref of a SEPARATE disposable test project>` — **never `nwgdzzpcbqmfqujycpqk`: that project is PRODUCTION (owner-confirmed 2026-10-16) and the harness code rejects it. An earlier version of this document named the production project here in error.**
- `NEXT_PUBLIC_SUPABASE_URL` matching that project's HTTPS origin exactly
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for that project (available to the application through its existing local configuration)
- `E2E_SUPABASE_SECRET_KEY` containing a privileged `sb_secret_` key for that separate test project only

Inject the privileged key securely into the test runner's environment. Do not paste it into chat, commit it, use a `NEXT_PUBLIC` name, or put it in production app configuration. The Playwright configuration does not load `.env.local` into the runner; its explicit opt-in variables must be injected. Build first with `npm run build`.

## Cleanup and limits

Before account creation, an ignored `.local/live-auth-<run UUID>.json` manifest records the synthetic email and project, then the created UUID. It contains no password or TOTP key. Finally, cleanup checks both UUID metadata and synthetic email before deleting the account and verifies a 404 lookup. Cleanup failure or interrupted creation retains the manifest for operator investigation; never blindly delete accounts by a broad email pattern. Process termination can prevent automatic cleanup.

Confirmed accounts are synthetic test fixtures. This bypasses email delivery for that fixture only and does not test signup confirmation or recovery email delivery. No provider settings are changed. Application/review concurrency and immutable-history fixture cleanup require a separate disposable-database strategy; this suite intentionally does not modify application audit history.

Missing opt-in or configuration must fail before account creation, not skip with a green result. Unit tests cover the configuration guards and six RFC 6238 SHA-1 test vectors reduced to six digits. Those tests do not prove a live MFA flow.