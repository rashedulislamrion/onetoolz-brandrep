# Initial administrator provisioning

## Implementation status — 2026-10-15

Applied migration: `F:\My VS Project\OneToolz Affiliates\supabase\migrations\20261015102213_administrator_bootstrap.sql`.

Test suite: `F:\My VS Project\OneToolz Affiliates\supabase\tests\administrator_bootstrap.sql`.

After a successful rollback-only rehearsal, the migration was applied through the management migration API on 2026-10-15 as version **20261015102213**. The bootstrap suite passed again against the installed function, with all fixtures rolled back. Verified RLS enabled, security-invoker execution, and no table access or function execution for anon/authenticated/service_role. **No real administrator was granted; the audit table is empty. Do not rerun this migration.**

## Security model

- No email lookup, automatic promotion, browser provisioning action, or service-role provisioning API.
- A trusted `postgres` operator independently verifies the exact Auth UUID and authorization reference before calling the function.
- The target must be confirmed, not deleted, not currently banned, and have a verified TOTP factor. A database fixture factor is not an acceptable real-user enrollment.
- A transaction locks role writes, checks that neither an administrator nor a previous bootstrap event exists, inserts the role and records the grant together.
- The audit stores target UUID, database principal, operator reference, reason, and timestamp. The reference is operator-supplied evidence, not cryptographic operator identity; retain external authorization records.
- Audit rows cannot be updated or deleted through ordinary DML. A privileged database owner can still alter schema/triggers; this is not tamper-proof against the database owner.
- Enrollment does not make an existing session AAL2 automatically for administrative actions; the application and review RPC still enforce the session assurance level.
- Subsequent administrator grants, revocation, and MFA recovery are separate workflows, not provided by this initial-bootstrap function.

## Controlled execution procedure

1. Verify the target project's identity and classification (the installed project, `nwgdzzpcbqmfqujycpqk`, is PRODUCTION — a grant there is a real production grant), migration history and the absence of existing administrators.
2. Confirm the applied bootstrap version is present in history. The local filename is aligned with the provider-assigned version. Do not rerun either applied migration.
3. Have the intended account complete real MFA enrollment. Independently verify its UUID and record explicit authorization to make that account an administrator.
4. As the trusted database operator, call `public.bootstrap_initial_administrator` with that UUID, authorization reference, and a substantive reason. Never embed user-supplied strings directly into SQL; use bound parameters or a reviewed SQL execution tool.
5. Verify exactly one role and matching grant event, then test AAL1 denial and AAL2 administrative access using actual browser sessions.

## Remaining acceptance gaps

Live browser sign-in, enrollment/challenge/recovery, and simultaneous multi-session submission/review/bootstrap tests are not yet executed. Local configuration contains only a publishable key, not a privileged Auth test-provisioning key or test-user credentials. No real account password or authenticator was changed to bypass that limitation.