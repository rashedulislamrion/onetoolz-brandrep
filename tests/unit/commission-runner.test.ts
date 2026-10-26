import { describe, expect, it, vi } from "vitest";
import { handleCommissionRunner } from "../../src/lib/ledger/runner";

const secret = "synthetic-commission-runner-fixture-secret";
const env = { COMMISSION_WORKER_SECRET: secret, COMMISSION_POSTING_ENABLED: "true",
  APP_ENV: "production", SUPABASE_ENVIRONMENT: "production",
  COMMISSION_SUPABASE_SECRET_KEY: "sb_secret_fixture", NEXT_PUBLIC_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co",
  COMMISSION_APPROVED_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co",
  WOO_WORKER_SECRET: "synthetic-separate-woo-worker-secret", WOO_WEBHOOK_SECRET: "synthetic-separate-webhook-secret" };
const request = (authorization = `Bearer ${secret}`, method = "POST") => new Request("https://example.invalid/api/internal/commissions/run", {
  method, headers: { authorization },
});
function dependencies() {
  return {
    recording: vi.fn().mockResolvedValue({ recorded: 4, revised: 2, supersedeRefused: 1,
      skipped: { basis_unavailable: 2 }, errors: [{ orderId: "7009", stage: "recording", reason: "rpc_failed" }] }),
    posting: vi.fn().mockResolvedValue({ posted: 2, reversed: 1, skipped: [{ effectKey: "k", stage: "posting", reason: "zero_amount" }], errors: [] }),
    release: vi.fn().mockResolvedValue({ released: 3, skipped: [], errors: [{ effectKey: "k2", stage: "release", reason: "rpc_failed" }] }),
  };
}

describe("authorized bounded commission runner", () => {
  it("runs recording, then posting, then release and returns counts only", async () => {
    const deps = dependencies();
    const order: string[] = [];
    deps.recording.mockImplementation(async () => { order.push("recording");
      return { recorded: 4, revised: 2, supersedeRefused: 1, skipped: { basis_unavailable: 2 }, errors: [{ orderId: "7009", stage: "recording", reason: "rpc_failed" }] }; });
    deps.posting.mockImplementation(async () => { order.push("posting");
      return { posted: 2, reversed: 1, skipped: [{ effectKey: "k", stage: "posting", reason: "zero_amount" }], errors: [] }; });
    deps.release.mockImplementation(async () => { order.push("release");
      return { released: 3, skipped: [], errors: [{ effectKey: "k2", stage: "release", reason: "rpc_failed" }] }; });
    const result = await handleCommissionRunner(request(), env, deps);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ recorded: 4, revised: 2, supersedeRefused: 1, posted: 2, reversed: 1, released: 3, skipped: 3, errors: 2 });
    expect(order).toEqual(["recording", "posting", "release"]);
    expect(deps.recording).toHaveBeenCalledOnce();
    expect(deps.posting).toHaveBeenCalledOnce();
    expect(deps.release).toHaveBeenCalledOnce();
  });

  it("skips release when the soft budget is already spent", async () => {
    const deps = dependencies();
    const times = [0, 25000];
    const result = await handleCommissionRunner(request(), env, { ...deps, now: () => times.shift() ?? 25000 });
    expect(result.status).toBe(200);
    expect((await result.json()).released).toBe(0);
    expect(deps.recording).toHaveBeenCalledOnce();
    expect(deps.posting).toHaveBeenCalledOnce();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it.each([{}, { ...env, COMMISSION_POSTING_ENABLED: "false" }, { ...env, APP_ENV: "staging" },
    { ...env, SUPABASE_ENVIRONMENT: "nonproduction" }, { ...env, VERCEL_ENV: "preview" },
    { ...env, COMMISSION_APPROVED_SUPABASE_URL: undefined }, { ...env, COMMISSION_WORKER_SECRET: "short" },
    { ...env, WOO_WORKER_SECRET: secret },
    { ...env, COMMISSION_SUPABASE_SECRET_KEY: "sb_publishable_fixture" }])("rejects incomplete configuration %#", async configuration => {
    const deps = dependencies();
    expect((await handleCommissionRunner(request(), configuration, deps)).status).toBe(503);
    expect(deps.recording).not.toHaveBeenCalled();
    expect(deps.posting).not.toHaveBeenCalled(); expect(deps.release).not.toHaveBeenCalled();
  });

  it.each(["", "Bearer <redacted>", secret, "x".repeat(301)])("denies unauthorized invocation %#", async authorization => {
    const deps = dependencies();
    expect((await handleCommissionRunner(request(authorization), env, deps)).status).toBe(401);
    expect(deps.recording).not.toHaveBeenCalled();
    expect(deps.posting).not.toHaveBeenCalled();
  });

  it("rejects GET without doing work", async () => {
    const deps = dependencies();
    expect((await handleCommissionRunner(request(undefined, "GET"), env, deps)).status).toBe(405);
    expect(deps.recording).not.toHaveBeenCalled();
    expect(deps.posting).not.toHaveBeenCalled();
  });

  it("reports worker failure with the counts accumulated so far", async () => {
    const deps = dependencies();
    deps.posting.mockRejectedValue(new Error("private"));
    const result = await handleCommissionRunner(request(), env, deps);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "WORKER_UNAVAILABLE", recorded: 4, revised: 2, supersedeRefused: 1, posted: 0, reversed: 0, released: 0, skipped: 2, errors: 1 });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("reports recording failure before any posting happens", async () => {
    const deps = dependencies();
    deps.recording.mockRejectedValue(new Error("private"));
    const result = await handleCommissionRunner(request(), env, deps);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "WORKER_UNAVAILABLE", recorded: 0, revised: 0, supersedeRefused: 0, posted: 0, reversed: 0, released: 0, skipped: 0, errors: 0 });
    expect(deps.posting).not.toHaveBeenCalled();
  });
});
