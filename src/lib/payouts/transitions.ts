// Pure payout lifecycle data. This mirrors the transition rules the payout
// RPCs enforce in the database (20261026060000_payouts.sql); it exists so
// forms and pages can reason about states without duplicating literals.
// The RPCs remain authoritative — this table never grants a transition.
export const PAYOUT_STATUSES = [
  "requested", "approved", "rejected", "settled", "cancelled", "failed",
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export function isPayoutStatus(value: unknown): value is PayoutStatus {
  return typeof value === "string" && (PAYOUT_STATUSES as readonly string[]).includes(value);
}

/** Allowed forward transitions per status. Terminal statuses map to []. */
const NO_TRANSITIONS: readonly PayoutStatus[] = Object.freeze([]);
export const PAYOUT_TRANSITIONS: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = Object.freeze({
  requested: Object.freeze(["approved", "rejected", "cancelled"] as PayoutStatus[]),
  approved: Object.freeze(["settled", "failed"] as PayoutStatus[]),
  rejected: NO_TRANSITIONS,
  settled: NO_TRANSITIONS,
  cancelled: NO_TRANSITIONS,
  failed: NO_TRANSITIONS,
});

export function payoutTransitionAllowed(from: PayoutStatus, to: PayoutStatus): boolean {
  return PAYOUT_TRANSITIONS[from].includes(to);
}

export const PAYOUT_TERMINAL_STATUSES: readonly PayoutStatus[] = Object.freeze([
  "rejected", "settled", "cancelled", "failed",
]);

export function isPayoutTerminal(status: PayoutStatus): boolean {
  return PAYOUT_TERMINAL_STATUSES.includes(status);
}
