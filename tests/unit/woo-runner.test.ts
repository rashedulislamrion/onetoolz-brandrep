import { describe, expect, it, vi } from "vitest";
import { handleWooRunner } from "../../src/lib/woocommerce/runner";

const secret = "synthetic-runner-fixture-never-a-real-credential";
const env = { WOO_WORKER_ENABLED: "true", WOO_WORKER_SECRET: secret, APP_ENV: "production", SUPABASE_ENVIRONMENT: "production",
  WOO_INGESTION_ENABLED: "true", WOO_STORE_VERIFIED: "true", WOO_PRODUCTION_STORE_ACCESS_APPROVED: "true",
  WOO_STORE_ORIGIN: "https://cu.onetoolz.com", WOO_WEBHOOK_SECRET: "synthetic-separate-webhook-secret-for-testing",
  WOO_INGESTION_SUPABASE_SECRET_KEY: "sb_secret_fixture", NEXT_PUBLIC_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co",
  WOO_APPROVED_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co" };
const request = (authorization = `Bearer ${secret}`, method = "POST") => new Request("https://example.invalid/api/internal/woocommerce/run", {
  method, headers: { authorization },
});
function dependencies() { return { requeue: vi.fn().mockResolvedValue(2), refresh: vi.fn().mockResolvedValue(false) }; }

describe("authorized bounded Woo worker runner", () => {
  it("only discovers when explicitly enabled", async () => {
    const discover = vi.fn().mockResolvedValue({ scanned: 50, queued: 4 });
    await handleWooRunner(request(), env, { ...dependencies(), discover });
    expect(discover).not.toHaveBeenCalled();
    const result = await handleWooRunner(request(), { ...env, WOO_DISCOVERY_ENABLED: "true" }, { ...dependencies(), discover });
    expect((await result.json()).discovery).toEqual({ scanned: 50, queued: 4 });
    expect(discover).toHaveBeenCalledOnce();
  });
  it("continues refreshing after discovery failure without leaking provider errors", async () => {
    const deps = dependencies();
    const result = await handleWooRunner(request(), { ...env, WOO_DISCOVERY_ENABLED: "true" }, {
      ...deps, discover: vi.fn().mockRejectedValue(new Error("private")),
    });
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ attempted: 0, requeued: 2, error: "DISCOVERY_UNAVAILABLE" });
    expect(deps.refresh).toHaveBeenCalledOnce();
  });
  it.each([{}, { ...env, WOO_WORKER_ENABLED: "false" }, { ...env, APP_ENV: "staging" },
    { ...env, SUPABASE_ENVIRONMENT: "nonproduction" }, { ...env, VERCEL_ENV: "preview" },
    { ...env, WOO_APPROVED_SUPABASE_URL: undefined }, { ...env, WOO_INGESTION_ENABLED: "false" }, { ...env, WOO_WORKER_SECRET: "short" },
    { ...env, WOO_WEBHOOK_SECRET: secret }])("fails closed for disabled/unsafe configuration %#", async configuration => {
    const deps = dependencies();
    expect((await handleWooRunner(request(), configuration, deps)).status).toBe(503);
    expect(deps.requeue).not.toHaveBeenCalled(); expect(deps.refresh).not.toHaveBeenCalled();
  });
  it.each(["", "Bearer incorrect", secret, "x".repeat(301)])("denies unauthorized invocation %#", async authorization => {
    const deps = dependencies();
    expect((await handleWooRunner(request(authorization), env, deps)).status).toBe(401);
    expect(deps.requeue).not.toHaveBeenCalled();
  });
  it("rejects GET without doing work", async () => {
    const deps = dependencies();
    expect((await handleWooRunner(request(undefined, "GET"), env, deps)).status).toBe(405);
    expect(deps.requeue).not.toHaveBeenCalled();
  });
  it("requeues known orders once and stops on empty queue", async () => {
    const deps = dependencies();
    const response = await handleWooRunner(request(), env, deps);
    expect(await response.json()).toEqual({ attempted: 0, requeued: 2 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.refresh).toHaveBeenCalledOnce(); expect(deps.requeue).toHaveBeenCalledOnce();
  });
  it("caps each batch at three attempted jobs", async () => {
    const deps = dependencies(); deps.refresh.mockResolvedValue(true);
    const response = await handleWooRunner(request(), env, deps);
    expect(await response.json()).toEqual({ attempted: 3, requeued: 2 });
    expect(deps.refresh).toHaveBeenCalledTimes(3);
  });
  it("stops admitting jobs after soft time budget", async () => {
    const deps = dependencies(); deps.refresh.mockResolvedValue(true);
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(20000);
    const response = await handleWooRunner(request(), env, { ...deps, now });
    expect(await response.json()).toEqual({ attempted: 1, requeued: 2 });
  });
  it("does not start refresh if reconciliation consumed the budget", async () => {
    const deps = dependencies(); const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(20000);
    await handleWooRunner(request(), env, { ...deps, now });
    expect(deps.refresh).not.toHaveBeenCalled();
  });
  it("redacts infrastructure failures and reports only attempted jobs", async () => {
    const deps = dependencies(); deps.refresh.mockResolvedValueOnce(true).mockRejectedValue(new Error("private credential"));
    const response = await handleWooRunner(request(), env, deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "WORKER_UNAVAILABLE", attempted: 1 });
  });
  it("does not drain if reconciliation fails", async () => {
    const deps = dependencies(); deps.requeue.mockRejectedValue(new Error("private"));
    expect((await handleWooRunner(request(), env, deps)).status).toBe(503);
    expect(deps.refresh).not.toHaveBeenCalled();
  });
});