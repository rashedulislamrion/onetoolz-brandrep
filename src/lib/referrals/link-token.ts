import { createHash, randomBytes } from "node:crypto";

// Buyer store-link tokens prove a BrandRep identity to the referral bridge
// without a live Supabase session at order time. Plaintext is issued only to
// a signed-in BrandRep user, shown once, and never stored: storage keeps the
// SHA-256 hash and resolution compares hashes, like a password reset token.
// The prefix lets the bridge (and logs/support) distinguish a link token
// from a Supabase access token without inspecting either credential.
export const STORE_LINK_TOKEN_PREFIX = "brlink_";

const tokenPattern = /^brlink_[a-f0-9]{64}$/;

export function generateStoreLinkToken(): string {
  return `${STORE_LINK_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function isStoreLinkToken(value: unknown): value is string {
  return typeof value === "string" && tokenPattern.test(value);
}

/** Returns the token unchanged when strictly valid; never trims or repairs. */
export function parseStoreLinkToken(value: unknown): string | null {
  return isStoreLinkToken(value) ? value : null;
}

/** SHA-256 hex of a valid token, or null. Storage/resolution use only this. */
export function hashToken(token: unknown): string | null {
  if (!isStoreLinkToken(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}
