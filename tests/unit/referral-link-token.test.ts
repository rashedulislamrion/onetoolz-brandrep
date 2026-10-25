import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { STORE_LINK_TOKEN_PREFIX, generateStoreLinkToken, hashToken, isStoreLinkToken, parseStoreLinkToken } from "@/lib/referrals/link-token";

describe("buyer store-link tokens", () => {
  it("generates prefixed tokens with 64 lower-case hex characters", () => {
    const token = generateStoreLinkToken();
    expect(token.startsWith(STORE_LINK_TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^brlink_[a-f0-9]{64}$/);
    expect(isStoreLinkToken(token)).toBe(true);
    expect(parseStoreLinkToken(token)).toBe(token);
  });
  it("generates distinct tokens", () => {
    expect(generateStoreLinkToken()).not.toBe(generateStoreLinkToken());
  });
  it("hashes a valid token to its SHA-256 hex and nothing else stores plaintext shape", () => {
    const token = `brlink_${"a".repeat(64)}`;
    expect(hashToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toContain("brlink_");
  });
  it.each([
    "", "brlink_", `brlink_${"a".repeat(63)}`, `brlink_${"a".repeat(65)}`,
    `brlink_${"A".repeat(64)}`, `brlink_${"g".repeat(64)}`, "a".repeat(64),
    ` brlink_${"a".repeat(64)}`, `brlink_${"a".repeat(64)} `, null, undefined, 42, {},
  ])("rejects invalid token %j in every helper", value => {
    expect(isStoreLinkToken(value)).toBe(false);
    expect(parseStoreLinkToken(value)).toBeNull();
    expect(hashToken(value)).toBeNull();
  });
});
