export type AttributionPolicy = {
  version: string;
  windowSeconds: number;
  precedence: "first" | "last";
  selfReferral: "deny" | "allow";
};
export type ReferralTouch = {
  id: string; affiliateId: string; campaignId: string; occurredAt: number;
  policyVersion: string; consent: boolean; verified: boolean;
};
export type AttributionResult =
  | { attributed: true; touch: ReferralTouch; policyVersion: string }
  | { attributed: false; reason: "invalid_policy" | "invalid_order" | "identity_required" | "unattributed" };

// Canonical lower-case identities avoid case-dependent duplicate/self matches.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;

// Pure resolver only. The caller MUST obtain verified touches and buyer/affiliate
// identity from trusted storage, never from browser/Woo metadata alone.
// No defaults: unapproved commercial/privacy rules cannot activate attribution.
export function resolveAttribution(input: {
  policy: AttributionPolicy; orderAt: number; buyerAffiliateId: string | null;
  identityVerified: boolean; touches: readonly ReferralTouch[];
}): AttributionResult {
  const { policy, orderAt } = input;
  if (!policy || !/^[a-zA-Z0-9._-]{1,80}(?![\s\S])/.test(policy.version) ||
    !Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1 || policy.windowSeconds > 31536000 ||
    !["first", "last"].includes(policy.precedence) || !["deny", "allow"].includes(policy.selfReferral)) {
    return { attributed: false, reason: "invalid_policy" };
  }
  if (!Number.isSafeInteger(orderAt) || orderAt < 0 || input.touches.length > 1000 ||
    (input.buyerAffiliateId !== null && !uuid.test(input.buyerAffiliateId))) return { attributed: false, reason: "invalid_order" };
  if (policy.selfReferral === "deny" && !input.identityVerified) return { attributed: false, reason: "identity_required" };
  const seen = new Map<string, ReferralTouch>();
  const conflicts = new Set<string>();
  for (const touch of input.touches) {
    // Conflicting duplicate IDs are discarded rather than letting input order
    // select an affiliate. Exact retries are harmless.
    const previous = seen.get(touch.id);
    if (previous && (previous.affiliateId !== touch.affiliateId || previous.campaignId !== touch.campaignId ||
      previous.occurredAt !== touch.occurredAt || previous.policyVersion !== touch.policyVersion ||
      previous.consent !== touch.consent || previous.verified !== touch.verified)) conflicts.add(touch.id);
    seen.set(touch.id, touch);
  }
  const eligible = [...seen.values()].filter(touch => !conflicts.has(touch.id) &&
    uuid.test(touch.id) && uuid.test(touch.affiliateId) && uuid.test(touch.campaignId) &&
    touch.verified === true && touch.consent === true && touch.policyVersion === policy.version &&
    Number.isSafeInteger(touch.occurredAt) && touch.occurredAt >= 0 && touch.occurredAt <= orderAt &&
    orderAt - touch.occurredAt < policy.windowSeconds * 1000);
  eligible.sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  const touch = policy.precedence === "first" ? eligible[0] : eligible.at(-1);
  // Do not promote a later partner when the winning first click is a self
  // referral. The winning identity is resolved before eligibility rejection.
  if (touch && policy.selfReferral === "deny" && touch.affiliateId === input.buyerAffiliateId) {
    return { attributed: false, reason: "unattributed" };
  }
  return touch ? { attributed: true, touch, policyVersion: policy.version } : { attributed: false, reason: "unattributed" };
}