import { describe, expect, it } from "vitest";
import { parseCampaign, referralLink, storeDestination, validDestinationPath, validReferralCode } from "@/lib/referrals/campaigns";
import { resolveAttribution, type AttributionPolicy, type ReferralTouch } from "@/lib/referrals/attribution";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const c = "33333333-3333-4333-8333-333333333333";
const policy: AttributionPolicy = { version: "approved-v1", windowSeconds: 3600, precedence: "last", selfReferral: "deny" };
const touch: ReferralTouch = { id: a, affiliateId: b, campaignId: c, occurredAt: 10000, policyVersion: policy.version, consent: true, verified: true };
const resolve = (overrides: Partial<Parameters<typeof resolveAttribution>[0]> = {}) => resolveAttribution({
  policy, orderAt: 20000, buyerAffiliateId: null, identityVerified: true, touches: [touch], ...overrides,
});

describe("campaign inputs", () => {
  it.each(["/", "/shop", "/shop/", "/product/test-1/"])("allows store path %s", path => {
    expect(validDestinationPath(path)).toBe(true);
    expect(storeDestination(path)).toBe(`https://cu.onetoolz.com${path}`);
  });
  it.each(["", "//evil.test", "https://evil.test", "/../admin", "/%2e%2e/", "/shop?redirect=x", "/#x", "/\\evil", "/hello world", "/a\n", `/${"a".repeat(500)}`])("rejects unsafe destination %s", path => {
    expect(validDestinationPath(path)).toBe(false);
    expect(storeDestination(path)).toBeNull();
  });
  it("validates and normalizes a campaign", () => {
    const form = new FormData();
    form.set("name", " Launch "); form.set("destination", "/shop/"); form.set("requestId", a);
    expect(parseCampaign(form)).toEqual({ name: "Launch", destination: "/shop/", requestId: a });
    for (const name of ["x", "x\ny", "x".repeat(81)]) { form.set("name", name); expect(parseCampaign(form)).toBeNull(); }
    form.set("name", "Valid"); form.delete("requestId"); expect(parseCampaign(form)).toBeNull();
  });
  it("requires opaque referral codes", () => {
    expect(validReferralCode("a".repeat(32))).toBe(true);
    for (const code of ["A".repeat(32), "a".repeat(31), "1\n", "../shop", a]) expect(validReferralCode(code)).toBe(false);
  });
  it("builds links only on a valid configured origin", () => {
    expect(referralLink("https://brandrep.onetoolz.com", "a".repeat(32))).toBe(`https://brandrep.onetoolz.com/r/${"a".repeat(32)}`);
    for (const origin of ["javascript:alert(1)", "https://x.test/path", "https://u:p@x.test", "https://x.test?x", "http://x.test", "invalid"]) {
      expect(referralLink(origin, "a".repeat(32))).toBeNull();
    }
    expect(referralLink("http://localhost:3000", "a".repeat(32))).toContain("localhost:3000/r/");
    expect(referralLink("https://x.test", "bad")).toBeNull();
  });
});

describe("explicit-policy attribution resolver (not live order credit)", () => {
  it("returns a verified consented touch and immutable policy reference", () => {
    expect(resolve()).toEqual({ attributed: true, touch, policyVersion: policy.version });
  });
  it("enforces first/last precedence regardless of input order", () => {
    const later = { ...touch, id: c, occurredAt: 15000 };
    expect(resolve({ touches: [later, touch] })).toMatchObject({ touch: later });
    expect(resolve({ policy: { ...policy, precedence: "first" }, touches: [later, touch] })).toMatchObject({ touch });
  });
  it.each([
    { consent: false }, { verified: false }, { policyVersion: "old" }, { occurredAt: 21000 },
    { occurredAt: -1 }, { occurredAt: 1.5 }, { affiliateId: "forged" }, { campaignId: "forged" }, { id: "forged" },
    { id: `${a}\n` }, { affiliateId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
  ])("rejects ineligible touch %j", change => {
    expect(resolve({ touches: [{ ...touch, ...change }] })).toEqual({ attributed: false, reason: "unattributed" });
  });
  it("expires at the exact window boundary", () => {
    expect(resolve({ orderAt: touch.occurredAt + 3600000 })).toMatchObject({ attributed: false });
    expect(resolve({ orderAt: touch.occurredAt + 3599999 })).toMatchObject({ attributed: true });
  });
  it("does not claim self-referral prevention without verified buyer identity", () => {
    expect(resolve({ identityVerified: false })).toEqual({ attributed: false, reason: "identity_required" });
    expect(resolve({ buyerAffiliateId: b })).toEqual({ attributed: false, reason: "unattributed" });
    expect(resolve({ buyerAffiliateId: b, policy: { ...policy, selfReferral: "allow" } })).toMatchObject({ attributed: true });
  });
  it("deduplicates retries and rejects conflicting touch identities", () => {
    expect(resolve({ touches: [touch, { ...touch }] })).toMatchObject({ attributed: true });
    for (const touches of [[touch, { ...touch, affiliateId: c }], [{ ...touch, affiliateId: c }, touch]]) {
      expect(resolve({ touches })).toEqual({ attributed: false, reason: "unattributed" });
    }
  });
  it("breaks timestamp ties deterministically without mutating inputs", () => {
    const touches = [{ ...touch, id: c }, touch];
    expect(resolve({ touches })).toMatchObject({ touch: { id: c } });
    expect(touches[0].id).toBe(c);
  });
  it.each([{ windowSeconds: 0 }, { windowSeconds: 31536001 }, { windowSeconds: 1.5 }, { version: "" }, { precedence: "unknown" }, { selfReferral: "unknown" }])("rejects invalid policy %j", change => {
    expect(resolve({ policy: { ...policy, ...change } as AttributionPolicy })).toEqual({ attributed: false, reason: "invalid_policy" });
  });
  it("rejects invalid order context and bounded input overflow", () => {
    for (const orderAt of [-1, NaN, Infinity, 1.5]) expect(resolve({ orderAt })).toEqual({ attributed: false, reason: "invalid_order" });
    expect(resolve({ buyerAffiliateId: "unknown" })).toMatchObject({ reason: "invalid_order" });
    expect(resolve({ touches: Array(1001).fill(touch) })).toMatchObject({ reason: "invalid_order" });
    expect(resolve({ touches: [] })).toMatchObject({ reason: "unattributed" });
  });
});