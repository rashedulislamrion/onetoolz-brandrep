# Program settings concurrency acceptance

Executed October 15, 2026 on the configured nonproduction project using two independent database query requests in parallel, after settings installation.

## Isolation and setup

- Created disposable schema `settings_acceptance_20261015`, denied public schema access, granted authenticated usage only.
- Cloned the installed settings table with all constraints/indexes, adding the auth user foreign key explicitly.
- Cloned `pg_get_functiondef` of the installed save RPC, replacing only the function and settings-table schema references. Kept admin checks against real `public.user_roles`.
- Created one synthetic, confirmed user and admin role with no login/session provisioning. No real administrator identity or MFA changed.
- Revoked direct application-role access to the cloned table and restricted function execution to authenticated.

## Cases and evidence

1. First writer saved revision 1 and held its transaction until `pg_locks` showed another PID waiting on the clone relation (18-second bound, 25-second statement timeout). Second authenticated writer used a different request ID with expected revision 0. After commit it raised `40001`; no stale overwrite occurred.
2. First writer saved revision 2 and again waited for a lock waiter. Second writer used the identical request ID/payload/expected revision. After commit it returned revision 2 rather than inserting another row.

Both lock waiters were actually observed; these were not sequential simulations. Clone row count was exactly two afterward. The first writers used the privileged connection with synthetic JWT claims for lock inspection; second writers explicitly switched to authenticated. Separate rollback tests exercised both read policy and application-role save permissions.

## Cleanup

Verified synthetic user UUID/email before removal. Dropped only the named disposable schema, deleted its user role then user, and confirmed clone absent and fixture count zero. Real settings draft count remained zero and Woo schema remained absent. All financial execution remained disabled.

This is database concurrency evidence, not signed-in browser or frontend deployment evidence. Repeating requires a fresh isolated schema/identity, bounded lock waits, and verified cleanup; never run race fixtures against real program settings.