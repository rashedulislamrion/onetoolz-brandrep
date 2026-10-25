import { calculateCommission, policyForOrder, validCommissionPolicy,
  type CommissionPolicy, type CommissionQuote, type CommissionRounding } from "./commission";
import { validateJournal, type Journal } from "./journal";

// Phase 4 commission engine — pure decision layer only.
//
// This module decides WHAT a commission calculation record should say for one
// attributed order under a published policy. It does NOT post journals,
// persist records, release holds or pay anyone:
// - A "calculation" is a record/estimate, not an earning. Only a calculation
//   with qualification === "qualified" whose holdUntil has passed AND whose
//   payment evidence has been separately verified may become payable, and
//   only through the future posting worker — never through this module.
// - "paidAt" here is the Woo-recorded paid timestamp the caller extracted.
//   It is NOT independent PipraPay settlement evidence; settlement
//   verification stays an external gate before any release or payout.
// - All money stays exact bigint minor-unit strings via commission.ts.
//   Rounding is taken from the policy itself; callers never choose it.

export type EnginePolicy = CommissionPolicy & Readonly<{
  /** Stored on the published policy (migration 20261026020000). */
  rounding: CommissionRounding;
  /** Only rule implemented; publication refuses any other value. */
  qualification: "paid_completed";
  holdDays: number;
  /** Decimal string in the policy currency, as published from the draft. */
  minimumPayout: string;
}>;

export function validEnginePolicy(policy: EnginePolicy): boolean {
  return validCommissionPolicy(policy) &&
    ["half_up", "down"].includes(policy?.rounding) && policy?.qualification === "paid_completed" &&
    Number.isInteger(policy?.holdDays) && policy.holdDays >= 0 && policy.holdDays <= 365 &&
    typeof policy?.minimumPayout === "string" && /^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(policy.minimumPayout);
}

export type EngineOrder = Readonly<{
  id: string;
  status: string;
  currency: string;
  /** Canonical ISO timestamp (same strict shape commission.ts requires). */
  createdAt: string;
  /** Woo-recorded paid timestamp, or null when the order shows no payment. */
  paidAt: string | null;
  /** Verified amount in the policy's basis, as a decimal string. */
  basisAmount: string;
  /** Cumulative refunded amount in that SAME basis, as a decimal string. */
  refundedBasisAmount: string;
}>;

export type SkipReason = "unattributed" | "no_policy" | "invalid_policy" | "invalid_order" | "currency_mismatch" | "zero_basis";

export type CommissionCalculation = Readonly<{
  kind: "calculation";
  orderId: string;
  affiliateId: string;
  policyVersion: number;
  quote: CommissionQuote;
  qualification: "qualified" | "unqualified";
  unqualifiedReason?: "not_completed" | "not_paid";
  /** createdAt + the policy hold period. Payable-at is never before this. */
  holdUntil: string;
  effectKey: string;
}>;

export type Evaluation =
  | Readonly<{ kind: "skip"; reason: SkipReason }>
  | CommissionCalculation;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

const skip = (reason: SkipReason): Evaluation => Object.freeze({ kind: "skip", reason });

export function evaluateOrder(input: {
  order: EngineOrder;
  attribution: { affiliateId: string } | null;
  policies: readonly EnginePolicy[];
}): Evaluation {
  const { order, attribution, policies } = input;
  if (!attribution) return skip("unattributed");
  if (typeof attribution.affiliateId !== "string" || !uuid.test(attribution.affiliateId)) return skip("invalid_order");
  if (!order || typeof order.id !== "string" || !/^[1-9][0-9]{0,15}$/.test(order.id) ||
    typeof order.status !== "string" || order.status.length === 0 ||
    !canonicalTimestamp(order.createdAt) || (order.paidAt !== null && !canonicalTimestamp(order.paidAt))) {
    return skip("invalid_order");
  }
  if (!Array.isArray(policies) || policies.length === 0) return skip("no_policy");
  if (!policies.every(policy => validEnginePolicy(policy))) return skip("invalid_policy");
  // policyForOrder works on the base policy shape and also rejects
  // gapped/duplicate/out-of-order histories; those fail closed as no_policy
  // only when nothing was effective — a malformed history yields null too,
  // and every-engine-policy validity was checked above, so null here means
  // "no usable policy effective at order time".
  const policy = policyForOrder(policies, order.createdAt);
  if (!policy) return skip("no_policy");
  const enginePolicy = policies.find(candidate => candidate.version === policy.version) as EnginePolicy;
  if (order.currency !== enginePolicy.currency) return skip("currency_mismatch");
  const quote = calculateCommission(enginePolicy, {
    currency: order.currency, basisAmount: order.basisAmount,
    refundedBasisAmount: order.refundedBasisAmount, rounding: enginePolicy.rounding,
  });
  if (!quote) return skip("invalid_order");
  if (quote.basisMinor === "0") return skip("zero_basis");
  // Qualification under the published paid_completed rule. An unqualified
  // calculation is still returned: it is a pending estimate record, and the
  // quote amounts describe what WOULD be earned if qualification is later
  // established — they are not earnings and must never be posted as such.
  const qualified = order.status === "completed" && order.paidAt !== null;
  const holdUntil = new Date(Date.parse(order.createdAt) + enginePolicy.holdDays * 86400000).toISOString();
  return Object.freeze({
    kind: "calculation",
    orderId: order.id,
    affiliateId: attribution.affiliateId.toLowerCase(),
    policyVersion: enginePolicy.version,
    quote,
    qualification: qualified ? "qualified" : "unqualified",
    ...(qualified ? {} : { unqualifiedReason: order.status !== "completed" ? "not_completed" as const : "not_paid" as const }),
    holdUntil,
    effectKey: `commission:order:${order.id}:policy:${enginePolicy.version}`,
  });
}

/**
 * Recompute a previous quote against a NEW cumulative refunded-basis amount.
 * Goes through calculateCommission with the previous quote's own basis and
 * rounding, so sequential refunds reconcile exactly: the sum of the per-step
 * reversal deltas always equals the final quote's total reversalMinor —
 * no recomputation drift.
 */
export function recomputeForRefund(policy: EnginePolicy, previousQuote: CommissionQuote, newRefundedBasisAmount: string):
  Readonly<{ quote: CommissionQuote; deltaReversalMinor: string }> | null {
  if (!validEnginePolicy(policy) || !previousQuote || previousQuote.policyVersion !== policy.version) return null;
  const basisAmount = minorToDecimal(previousQuote.basisMinor, previousQuote.currencyDecimals);
  if (basisAmount === null) return null;
  const quote = calculateCommission(policy, {
    currency: previousQuote.currency, basisAmount, refundedBasisAmount: newRefundedBasisAmount,
    rounding: previousQuote.rounding,
  });
  if (!quote) return null;
  const delta = BigInt(quote.reversalMinor) - BigInt(previousQuote.reversalMinor);
  return Object.freeze({ quote, deltaReversalMinor: delta.toString() });
}

function minorToDecimal(minor: string, decimals: number): string | null {
  if (!/^(0|[1-9]\d{0,18})$/.test(minor) || !Number.isInteger(decimals) || decimals < 0 || decimals > 6) return null;
  if (decimals === 0) return minor;
  const padded = minor.padStart(decimals + 1, "0");
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

export type LedgerAccounts = Readonly<{
  /** Platform commission expense account. Opaque UUID owned by the future DB layer. */
  platformExpenseAccountId: string;
  /** The affiliate's held account. Opaque UUID owned by the future DB layer. */
  affiliateHeldAccountId: string;
}>;

function buildIntent(effectKey: string, reason: string, calculation: CommissionCalculation,
  accounts: LedgerAccounts, amountMinor: string, direction: "earn" | "reversal"): Journal | null {
  if (!/^(0|[1-9]\d{0,18})$/.test(amountMinor) || amountMinor === "0") return null;
  const debitAccount = direction === "earn" ? accounts.platformExpenseAccountId : accounts.affiliateHeldAccountId;
  const creditAccount = direction === "earn" ? accounts.affiliateHeldAccountId : accounts.platformExpenseAccountId;
  // validateJournal is the single gate: it rejects malformed/duplicate
  // account IDs, mismatched currency/exponent and unbalanced lines, so an
  // intent that fails validation is null (fail closed), never approximate.
  return validateJournal({
    effectKey, currency: calculation.quote.currency, exponent: calculation.quote.currencyDecimals, reason,
    lines: [
      { accountId: debitAccount, currency: calculation.quote.currency, exponent: calculation.quote.currencyDecimals, debitMinor: amountMinor, creditMinor: "0" },
      { accountId: creditAccount, currency: calculation.quote.currency, exponent: calculation.quote.currencyDecimals, debitMinor: "0", creditMinor: amountMinor },
    ],
  });
}

/**
 * Earn intent: Dr platform expense / Cr affiliate held for the quote's net
 * commission. Only for QUALIFIED calculations with net > 0. Posting itself
 * is a future DB-layer step (ledger.post_journal is operator-only); this
 * builder merely produces a value that passes validateJournal.
 */
export function journalIntentFor(calculation: CommissionCalculation, accounts: LedgerAccounts): Journal | null {
  if (!calculation || calculation.kind !== "calculation" || calculation.qualification !== "qualified") return null;
  return buildIntent(calculation.effectKey,
    `Commission earned for order ${calculation.orderId} under policy ${calculation.policyVersion}`,
    calculation, accounts, calculation.quote.netCommissionMinor, "earn");
}

/**
 * Reversal intent for one refund step: Dr affiliate held / Cr platform
 * expense for the step's reversal delta (> 0). Keyed by the calculation's
 * cumulative refunded basis so retries of the same refund state reuse one
 * effect key, and distinct refund states never collide.
 */
export function reversalJournalIntentFor(calculation: CommissionCalculation, deltaReversalMinor: string,
  accounts: LedgerAccounts): Journal | null {
  if (!calculation || calculation.kind !== "calculation") return null;
  return buildIntent(`${calculation.effectKey}:refund:${calculation.quote.refundedBasisMinor}`,
    `Commission reversal for order ${calculation.orderId} under policy ${calculation.policyVersion}`,
    calculation, accounts, deltaReversalMinor, "reversal");
}
