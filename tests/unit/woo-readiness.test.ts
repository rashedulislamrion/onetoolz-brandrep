import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { wooReadiness } from "../../src/lib/woocommerce/readiness.mts";

describe("offline production-store readiness", () => {
  it("runs the standalone CLI without module-format warnings", () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("WOO_")) delete env[key];
    const child = spawnSync(process.execPath, [resolve("scripts/woo-readiness.mjs")], { env, encoding: "utf8", timeout: 10000 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stderr).not.toContain("MODULE_TYPELESS_PACKAGE_JSON");
    expect(JSON.parse(child.stdout).configurationChecksPassed).toBe(false);
  });
  it("fails closed on missing configuration", () => {
    const result = wooReadiness({});
    expect(result.configurationChecksPassed).toBe(false);
    expect(result.storeEnvironment).toBe("production");
    expect(result.requestedSwitches).toEqual({ ingestion: false, worker: false, discovery: false });
  });
  it("does not echo secrets or arbitrary environment values", () => {
    const report = JSON.stringify(wooReadiness({ WOO_WEBHOOK_SECRET: "PRIVATE_MARKER", WOO_READ_CONSUMER_KEY: "PRIVATE_MARKER", EXTRA: "PRIVATE_MARKER" }));
    expect(report).not.toContain("PRIVATE_MARKER");
  });
  it("does not mistake configuration for verified launch readiness", () => {
    const env = { APP_ENV: "staging", SUPABASE_ENVIRONMENT: "nonproduction", NEXT_PUBLIC_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co",
      WOO_STORE_ORIGIN: "https://cu.onetoolz.com", WOO_STORE_VERIFIED: "true", WOO_PRODUCTION_STORE_ACCESS_APPROVED: "true",
      WOO_WEBHOOK_SECRET: "synthetic-webhook-key-for-unit-testing", WOO_WORKER_SECRET: "synthetic-worker-key-for-unit-testing",
      WOO_INGESTION_SUPABASE_SECRET_KEY: "sb_secret_fixture", WOO_READ_CONSUMER_KEY: `ck_${"a".repeat(40)}`, WOO_READ_CONSUMER_SECRET: `cs_${"b".repeat(40)}` };
    expect(wooReadiness(env).configurationChecksPassed).toBe(true);
    expect(wooReadiness(env).launchReadiness).toBe("NOT_VERIFIED");
    expect(wooReadiness({ ...env, WOO_PRODUCTION_STORE_ACCESS_APPROVED: "false" }).configurationChecksPassed).toBe(false);
    expect(wooReadiness({ ...env, WOO_WORKER_SECRET: env.WOO_WEBHOOK_SECRET }).configurationChecksPassed).toBe(false);
  });
});