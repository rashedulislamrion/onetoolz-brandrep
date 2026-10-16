import { MAX_MINOR_UNITS } from "./journal";

// Offline arithmetic foundation only: does not establish order eligibility,
// attribution, settlement, balances or authority to post a journal.
export type CommissionPolicy = Readonly<{
  version: number;
  effectiveAt: string;
  commissionBps: number;
  currency: string;
  currencyDecimals: number;
  basis: "net_items" | "order_total";
  refundRule: "proportional" | "full_on_any_refund";
  scope: "all_products_one_time";
}>;
export type CommissionRounding = "half_up" | "down";

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

export function validCommissionPolicy(policy: CommissionPolicy): boolean {
  return !!policy && Number.isSafeInteger(policy.version) && policy.version > 0 && timestamp(policy.effectiveAt) !== null &&
    Number.isInteger(policy.commissionBps) && policy.commissionBps >= 0 && policy.commissionBps <= 10000 &&
    typeof policy.currency === "string" && /^[A-Z]{3}$/.test(policy.currency) &&
    Number.isInteger(policy.currencyDecimals) && policy.currencyDecimals >= 0 && policy.currencyDecimals <= 6 &&
    ["net_items", "order_total"].includes(policy.basis) &&
    ["proportional", "full_on_any_refund"].includes(policy.refundRule) && policy.scope === "all_products_one_time";
}

/** Exact conversion. Reject excess nonzero precision rather than silently round an order amount. */
export function decimalToMinor(value: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6 || typeof value !== "string" ||
    !/^(0|[1-9]\d{0,18})(\.\d{1,8})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (/[1-9]/.test(fraction.slice(decimals))) return null;
  const minor = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
  return minor <= MAX_MINOR_UNITS ? minor : null;
}

/** Requires complete trusted history, not the admin page's ten-row history preview. */
export function policyForOrder(policies: readonly CommissionPolicy[], orderCreatedAt: string): CommissionPolicy | null {
  const orderTime = timestamp(orderCreatedAt);
  if (orderTime === null || !Array.isArray(policies) || !policies.length) return null;
  const sorted = [...policies].sort((a, b) => a.version - b.version);
  let selected: CommissionPolicy | null = null;
  let previousTime = -Infinity;
  for (let index = 0; index < sorted.length; index++) {
    const policy = sorted[index];
    if (!validCommissionPolicy(policy) || policy.version !== index + 1) return null;
    const effective = timestamp(policy.effectiveAt)!;
    if (effective < previousTime) return null;
    previousTime = effective;
    // For identical publication timestamps the higher version wins.
    if (effective <= orderTime) selected = policy;
  }
  return selected ? Object.freeze({ ...selected }) : null;
}

export type CommissionQuote = Readonly<{
  policyVersion: number;
  currency: string;
  currencyDecimals: number;
  basis: CommissionPolicy["basis"];
  refundRule: CommissionPolicy["refundRule"];
  rounding: CommissionRounding;
  basisMinor: string;
  refundedBasisMinor: string;
  grossCommissionMinor: string;
  reversalMinor: string;
  netCommissionMinor: string;
}>;

/**
 * Caller supplies verified amounts for the policy's chosen basis, and the
 * cumulative refunded amount in that SAME basis, never Woo's aggregate refund
 * total for a net-items policy. Rounding is required, never implicitly approved.
 * Reversal is gross minus rounded remaining commission, avoiding refund drift.
 */
export function calculateCommission(policy: CommissionPolicy, input: {
  currency: string; basisAmount: string; refundedBasisAmount: string; rounding: CommissionRounding;
}): CommissionQuote | null {
  if (!validCommissionPolicy(policy) || input.currency !== policy.currency || !["half_up", "down"].includes(input.rounding)) return null;
  const basis = decimalToMinor(input.basisAmount, policy.currencyDecimals);
  const refunded = decimalToMinor(input.refundedBasisAmount, policy.currencyDecimals);
  if (basis === null || refunded === null || refunded > basis) return null;
  const round = (amount: bigint) => (amount * BigInt(policy.commissionBps) + (input.rounding === "half_up" ? 5000n : 0n)) / 10000n;
  const gross = round(basis);
  const net = refunded > 0n && policy.refundRule === "full_on_any_refund" ? 0n : round(basis - refunded);
  return Object.freeze({ policyVersion: policy.version, currency: policy.currency, currencyDecimals: policy.currencyDecimals,
    basis: policy.basis, refundRule: policy.refundRule, rounding: input.rounding, basisMinor: basis.toString(),
    refundedBasisMinor: refunded.toString(), grossCommissionMinor: gross.toString(), reversalMinor: (gross - net).toString(),
    netCommissionMinor: net.toString() });
}