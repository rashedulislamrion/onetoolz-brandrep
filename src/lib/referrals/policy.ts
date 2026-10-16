import type { AttributionPolicy } from "./attribution";

// Owner approved October 16, 2026. This is attribution only, not a commission
// policy. Activation/effective time is the database installation, not backdated.
export const REFERRAL_POLICY: Readonly<AttributionPolicy> = Object.freeze({
  version: "first-click-7d-no-self-v1",
  windowSeconds: 7 * 24 * 60 * 60,
  precedence: "first",
  selfReferral: "deny",
});