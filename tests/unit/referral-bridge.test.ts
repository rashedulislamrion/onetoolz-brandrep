import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { bridgeConfiguration, parseBridgeEvent, receiveReferralBridge } from "@/lib/referrals/bridge";
import { REFERRAL_POLICY } from "@/lib/referrals/policy";
import { resolveAttribution } from "@/lib/referrals/attribution";

const secret = "synthetic-bridge-signing-secret-not-a-real-credential";
const now = 1792166400000;
const requestId = "11111111-1111-4111-8111-111111111111";
const buyerId = "22222222-2222-4222-8222-222222222222";
const capture = { kind: "capture", visitorHash: "b".repeat(64), code: "a".repeat(32), consent: true, policyVersion: REFERRAL_POLICY.version };
const order = { kind: "order", visitorHash: capture.visitorHash, orderId: "123", orderAt: new Date(now - 1000).toISOString(), buyerUserId: buyerId };

type SignatureOptions = { timestamp?: string; nonce?: string; body?: string; headers?: Record<string, string> };
function signed(value: unknown = capture, options: SignatureOptions = {}) {
  const timestamp = options.timestamp ?? String(now / 1000);
  const nonce = options.nonce ?? requestId;
  const body = options.body ?? JSON.stringify(value);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
  return new Request("https://brandrep.onetoolz.com/api/referrals/bridge", { method: "POST", body, headers: {
    "content-type": "application/json", "x-brandrep-timestamp": timestamp,
    "x-brandrep-request-id": nonce, "x-brandrep-signature": signature, ...options.headers,
  } });
}
const dependencies = () => ({ secret, now: () => now, buyerIdentity: vi.fn().mockResolvedValue(buyerId), persist: vi.fn().mockResolvedValue(undefined) });

describe("owner-approved attribution policy", () => {
  it("is immutable, first-click, exactly seven days, no self referrals", () => {
    expect(Object.isFrozen(REFERRAL_POLICY)).toBe(true);
    expect(REFERRAL_POLICY).toMatchObject({ windowSeconds: 604800, precedence: "first", selfReferral: "deny" });
  });
  it("does not pass first-click self referrals to a later partner", () => {
    const base = { campaignId: requestId, policyVersion: REFERRAL_POLICY.version, consent: true, verified: true };
    const input = { policy: REFERRAL_POLICY, orderAt: now, identityVerified: true, buyerAffiliateId: buyerId, touches: [
      { ...base, id: requestId, affiliateId: buyerId, occurredAt: now - 2000 },
      { ...base, id: buyerId, affiliateId: requestId, occurredAt: now - 1000 },
    ] };
    expect(resolveAttribution(input)).toEqual({ attributed: false, reason: "unattributed" });
  });
  it("expires exactly seven days after capture", () => {
    const input = { policy: REFERRAL_POLICY, orderAt: now, buyerAffiliateId: null, identityVerified: true, touches: [
      { id: requestId, campaignId: requestId, affiliateId: buyerId, policyVersion: REFERRAL_POLICY.version,
        consent: true, verified: true, occurredAt: now - 604800000 },
    ] };
    expect(resolveAttribution(input)).toMatchObject({ attributed: false });
    expect(resolveAttribution({ ...input, orderAt: now - 1 })).toMatchObject({ attributed: true });
  });
});

describe("referral bridge protocol", () => {
  it("accepts authenticated consented captures, without setting a browser cookie", async () => {
    const deps = dependencies(); const response = await receiveReferralBridge(signed(), deps);
    expect(response.status).toBe(202); expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.persist).toHaveBeenCalledWith(capture, { requestId, bodyHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(deps.buyerIdentity).not.toHaveBeenCalled();
  });
  it("requires signed store evidence and independently verified buyer token", async () => {
    const deps = dependencies();
    expect((await receiveReferralBridge(signed(order), deps)).status).toBe(401); expect(deps.persist).not.toHaveBeenCalled();
    expect((await receiveReferralBridge(signed(order, { headers: { authorization: "Bearer fixture-access-token" } }), deps)).status).toBe(202);
    expect(deps.buyerIdentity).toHaveBeenCalledWith("fixture-access-token");
    expect(deps.persist).toHaveBeenCalledWith(order, expect.any(Object));
  });
  it.each([null, requestId])("denies unlinked or mismatched buyer %s", async id => {
    const deps = dependencies(); deps.buyerIdentity.mockResolvedValue(id);
    expect((await receiveReferralBridge(signed(order, { headers: { authorization: "Bearer token" } }), deps)).status).toBe(401);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it.each<SignatureOptions>([
    { headers: { "x-brandrep-signature": "0".repeat(64) } },
    { headers: { "x-brandrep-signature": "invalid" } },
    { timestamp: String(now / 1000 - 301) }, { timestamp: String(now / 1000 + 301) },
    { nonce: "invalid" }, { headers: { "x-brandrep-request-id": buyerId } },
  ])("denies altered, stale and malformed signature envelopes %j", async options => {
    const deps = dependencies(); expect((await receiveReferralBridge(signed(capture, options), deps)).status).toBe(401);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it.each([
    { ...capture, consent: false }, { ...capture, policyVersion: "old" }, { ...capture, code: "../evil" },
    { ...capture, visitorHash: "b".repeat(63) }, { ...capture, extra: "untrusted" },
    { ...order, buyerUserId: "guest" }, { ...order, orderId: "9007199254740992" },
    { ...order, orderId: "0" }, { ...order, orderAt: "2026-02-30T00:00:00.000Z" },
    { ...order, orderAt: new Date(now + 1000).toISOString() },
  ])("rejects invalid event %j", async event => {
    const deps = dependencies(); expect((await receiveReferralBridge(signed(event), deps)).status).toBe(400);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it("bounds input, requires JSON, rejects malformed JSON and non-POST", async () => {
    const deps = dependencies();
    expect((await receiveReferralBridge(signed(null, { body: "x".repeat(4097) }), deps)).status).toBe(413);
    expect((await receiveReferralBridge(signed(null, { body: "{" }), deps)).status).toBe(400);
    expect((await receiveReferralBridge(signed(capture, { headers: { "content-type": "text/plain" } }), deps)).status).toBe(415);
    expect((await receiveReferralBridge(new Request("https://example.invalid"), deps)).status).toBe(405);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it("fails closed with no provider/credential details", async () => {
    const deps = dependencies(); deps.persist.mockRejectedValue(new Error("private credential"));
    const response = await receiveReferralBridge(signed(), deps); expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
  it("rejects runtime nonobject payloads", () => {
    for (const value of [null, [], "string", 1, {}]) expect(parseBridgeEvent(value)).toBeNull();
  });
});

describe("bridge environment isolation", () => {
  const env = { REFERRAL_BRIDGE_ENABLED: "true", APP_ENV: "production", SUPABASE_ENVIRONMENT: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", REFERRAL_APPROVED_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    REFERRAL_BRIDGE_SECRET: secret, REFERRAL_SUPABASE_SECRET_KEY: "sb_secret_fixture" };
  it("requires an explicit independently allowlisted database and server-only secrets", () => {
    expect(bridgeConfiguration(env)).toMatchObject({ secret, url: env.NEXT_PUBLIC_SUPABASE_URL });
  });
  it.each([
    { REFERRAL_BRIDGE_ENABLED: "false" }, { VERCEL_ENV: "preview" }, { SUPABASE_ENVIRONMENT: "nonproduction" },
    { APP_ENV: "unknown" }, { REFERRAL_APPROVED_SUPABASE_URL: "https://other.supabase.co" },
    { REFERRAL_BRIDGE_SECRET: "short" }, { WOO_WEBHOOK_SECRET: secret }, { WOO_WORKER_SECRET: secret },
    { REFERRAL_SUPABASE_SECRET_KEY: "sb_publishable_fixture" }, { NEXT_PUBLIC_SUPABASE_URL: "https://evil.test" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co", REFERRAL_APPROVED_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co" },
  ])("fails closed for unsafe configuration %j", change => expect(bridgeConfiguration({ ...env, ...change })).toBeNull());
  it("permits explicitly isolated nonproduction validation", () => {
    expect(bridgeConfiguration({ ...env, APP_ENV: "staging", SUPABASE_ENVIRONMENT: "nonproduction" })).not.toBeNull();
  });
});