# Woo independent-session concurrency acceptance

**Correction (2026-10-16): `nwgdzzpcbqmfqujycpqk` is owner-confirmed PRODUCTION; "nonproduction" below was a mistaken label. Do not repeat this procedure against that project — use a separate test database.** Executed on the project then confirmed as nonproduction, `nwgdzzpcbqmfqujycpqk` during the October 15 local work session (October 16, 2026 UTC). No production WooCommerce requests.

## Isolation

`scripts/woo-concurrency-fixture.mjs` emits a committed disposable schema, `woo_acceptance_20261015`, using the prepared ingestion/discovery migration bodies with schema-qualified object references and advisory-lock namespace renamed. It leaves the shared immutable-event trigger function unchanged. All application roles are denied schema access and fixture function execution. This emitter does not connect or install anything itself.

Two separate management SQL requests ran in parallel for every pair below. Holder requests used a bounded helper that checked `pg_blocking_pids` for an actual independent waiter before committing; absence of overlap raises an error after 18 seconds. Statements were bounded to 25 seconds. Claim and visibility tests used dedicated advisory barriers after the contender's assertions. Assertions, not elapsed sleep alone, determine success.

## Evidence

| Case | Holder PID | Contender PID | Verified result |
| --- | --- | --- | --- |
| Duplicate notification | 93129 | 93130 | One event, generation 1 after both identical deliveries |
| Worker and discovery claims | 93155 | 93154 | Both competing claims skip locked rows and return null |
| Notification during refresh | 93157 | 93158 | Finisher preserves generation 2 as pending, attempts reset |
| Expired/replaced leases | 93170 | 93169 | Old worker and discovery tokens rejected; stale discovery inserts no job |
| Stale snapshot | 93173 | 93172 | Concurrent newer stored timestamp survives; old refresh records STALE_SOURCE_SNAPSHOT |
| Atomic discovery visibility | 93179 | 93178 | Observer sees neither 50 new jobs nor page 2 before commit; both after commit |
| Webhook/discovery collision | 93202 | 93201 | Discovery inserts only the missing job and preserves existing generation |

Separate failure-injection assertion forced the checkpoint beyond its allowed maximum after attempting 50 job inserts. The caught check violation rolled back every insert and preserved the original checkpoint/lease. This is failure atomicity, not an additional two-session race.

The stale-snapshot holder deliberately updated the isolated snapshot table to exercise the UPSERT timestamp fence; it was not a second valid worker for the same lease. The replacement pair proved worker blocking directly and checked discovery-token rejection after replacement committed. Sequential expiry coverage also exists in the rollback suites.

Evidence query returned 16 records, including setup and failure injection. Before cleanup, SQL asserted distinct PIDs for all seven pairs and commissions disabled. Tool execution evidence: `log_aUvzGtG6VXOn` (results), `log_Oubehm4IQGb_` (cleanup).

## Cleanup and limits

Dropped only the named disposable schema with its fixture objects. Postcheck: fixture absent, real Woo schema absent, real worker claim RPC absent, installed migration count still four. No credentials, activation flags, real orders, financial tables, or migration history changed.

These results accept the isolated database algorithm, not installation, HTTP integration, scheduler behavior, browser flows or live store compatibility. Neither connector migration has been installed. Next step: tracked nonproduction installation and installed-function acceptance/postchecks, keeping all activation flags off.