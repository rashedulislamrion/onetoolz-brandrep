import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("isolates concurrency fixture functions, tables and advisory locks", () => {
  const child = spawnSync(process.execPath, [resolve("scripts/woo-concurrency-fixture.mjs")], { encoding: "utf8", timeout: 10000 });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  const sql = child.stdout;
  expect(sql).toContain("create schema woo_acceptance_20261015;");
  expect(sql).not.toMatch(/create (?:table|schema) woo[.;\s]/);
  expect(sql).not.toMatch(/public\.(?:ingest_woo|claim_woo|finish_woo|requeue_woo)/);
  expect(sql).toContain("woo_acceptance_20261015.delivery:");
  expect(sql).toContain("public.prevent_application_event_change()");
  expect(sql).toContain("No independent blocked session observed");
  expect(sql).toContain("pg_blocking_pids(a.pid)");
  expect(sql).toContain("revoke all on all functions in schema woo_acceptance_20261015 from public,anon,authenticated,service_role;");
  expect(sql.match(/^begin;/gm)).toHaveLength(1);
  expect(sql.match(/^commit;/gm)).toHaveLength(1);
});