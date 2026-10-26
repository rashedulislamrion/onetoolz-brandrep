import { describe, expect, it } from "vitest";
import {
  PAYOUT_TRANSITIONS, isPayoutTerminal, payoutTransitionAllowed,
} from "../../src/lib/payouts/transitions";
import {
  parsePayoutCancel, parsePayoutFail, parsePayoutRequest, parsePayoutReview,
  parsePayoutSettle, payoutAmountMinor, validExternalReference, validUuid,
} from "../../src/lib/payouts/validation";
import {
  formatMinorToDecimal, mapAdminPayoutQueue, mapPayoutOverview,
} from "../../src/lib/payouts/overview";

const key = "10000000-0000-4000-8000-0000000000aa";
const requestId = "20000000-0000-4000-8000-0000000000bb";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

describe("payout transitions", () => {
  it("allows exactly the RPC-enforced forward transitions", () => {
    expect(PAYOUT_TRANSITIONS.requested).toEqual(["approved", "rejected", "cancelled"]);
    expect(PAYOUT_TRANSITIONS.approved).toEqual(["settled", "failed"]);
    expect(payoutTransitionAllowed("requested", "approved")).toBe(true);
    expect(payoutTransitionAllowed("requested", "settled")).toBe(false);
    expect(payoutTransitionAllowed("approved", "cancelled")).toBe(false);
    expect(payoutTransitionAllowed("settled", "requested")).toBe(false);
  });
  it("marks every non-requested/approved end state terminal", () => {
    for (const status of ["rejected", "settled", "cancelled", "failed"] as const) {
      expect(isPayoutTerminal(status)).toBe(true);
      expect(PAYOUT_TRANSITIONS[status]).toEqual([]);
    }
    expect(isPayoutTerminal("requested")).toBe(false);
    expect(isPayoutTerminal("approved")).toBe(false);
  });
});

describe("payout form validation", () => {
  it("parses a payout request and normalizes the key", () => {
    expect(parsePayoutRequest(form({ requestKey: key.toUpperCase(), currency: "USD", amount: "25.50" })))
      .toEqual({ requestKey: key, currency: "USD", amountDecimal: "25.50" });
  });
  it("rejects malformed request fields", () => {
    expect(parsePayoutRequest(form({ requestKey: "nope", currency: "USD", amount: "25" }))).toBeNull();
    expect(parsePayoutRequest(form({ requestKey: key, currency: "usd", amount: "25" }))).toBeNull();
    expect(parsePayoutRequest(form({ requestKey: key, currency: "USD", amount: "25.123456789" }))).toBeNull();
    expect(parsePayoutRequest(form({ requestKey: key, currency: "USD", amount: "-25" }))).toBeNull();
    expect(parsePayoutRequest(form({ requestKey: key, currency: "USD", amount: "" }))).toBeNull();
  });
  it("converts amounts exactly and refuses zero or inexact values", () => {
    expect(payoutAmountMinor("25.50", 2)).toBe("2550");
    expect(payoutAmountMinor("25", 0)).toBe("25");
    expect(payoutAmountMinor("0.01", 2)).toBe("1");
    expect(payoutAmountMinor("0", 2)).toBeNull();
    expect(payoutAmountMinor("0.00", 2)).toBeNull();
    expect(payoutAmountMinor("25.5", 0)).toBeNull();
    expect(payoutAmountMinor("25.505", 2)).toBeNull();
  });
  it("requires confirmation for cancel and parses it", () => {
    expect(parsePayoutCancel(form({ requestId, confirmed: "yes" }))).toEqual({ requestId });
    expect(parsePayoutCancel(form({ requestId }))).toBeNull();
    expect(parsePayoutCancel(form({ requestId: "x", confirmed: "yes" }))).toBeNull();
  });
  it("parses reviews only with a decision, reason and confirmation", () => {
    expect(parsePayoutReview(form({ requestId, decision: "approve", reason: " Documents match ", confirmed: "yes" })))
      .toEqual({ requestId, decision: "approve", reason: "Documents match" });
    expect(parsePayoutReview(form({ requestId, decision: "approved", reason: "ok reason", confirmed: "yes" }))).toBeNull();
    expect(parsePayoutReview(form({ requestId, decision: "reject", reason: "no", confirmed: "yes" }))).toBeNull();
    expect(parsePayoutReview(form({ requestId, decision: "reject", reason: "valid reason" }))).toBeNull();
  });
  it("validates settlement references between 4 and 120 trimmed characters", () => {
    expect(validExternalReference("TXN123")).toBe(true);
    expect(validExternalReference("  ab  ")).toBe(false);
    expect(validExternalReference("x".repeat(121))).toBe(false);
    expect(parsePayoutSettle(form({ requestId, externalReference: " BKASH-99887 ", confirmed: "yes" })))
      .toEqual({ requestId, externalReference: "BKASH-99887" });
    expect(parsePayoutSettle(form({ requestId, externalReference: "abc", confirmed: "yes" }))).toBeNull();
  });
  it("parses failure records with a reason and confirmation", () => {
    expect(parsePayoutFail(form({ requestId, reason: "Bank rejected the transfer", confirmed: "yes" })))
      .toEqual({ requestId, reason: "Bank rejected the transfer" });
    expect(parsePayoutFail(form({ requestId, reason: "Bank rejected the transfer" }))).toBeNull();
  });
  it("validates uuid shape", () => {
    expect(validUuid(key)).toBe(true);
    expect(validUuid("not-a-uuid")).toBe(false);
    expect(validUuid(42)).toBe(false);
  });
});

describe("payout overview mapping", () => {
  it("formats minor units under the recorded exponent", () => {
    expect(formatMinorToDecimal("2550", 2)).toBe("25.50");
    expect(formatMinorToDecimal("5", 2)).toBe("0.05");
    expect(formatMinorToDecimal("25", 0)).toBe("25");
    expect(formatMinorToDecimal("-125", 2)).toBe("-1.25");
    expect(formatMinorToDecimal("1.5", 2)).toBeNull();
    expect(formatMinorToDecimal("100", 7)).toBeNull();
  });
  it("maps a well-formed overview", () => {
    const overview = mapPayoutOverview({
      currencies: [{ currency: "USD", exponent: 2, payableMinor: "1000", reservedMinor: "250",
        minimumPayoutMinor: "2500", payoutCadence: "manual" }],
      requests: [{ id: requestId, requestKey: key, currency: "USD", amountMinor: "2500",
        status: "requested", externalReference: null, failureReason: null,
        createdAt: "2026-10-26T00:00:00.000Z" }],
    });
    expect(overview?.currencies[0]).toMatchObject({ currency: "USD", payableMinor: "1000", minimumPayoutMinor: "2500" });
    expect(overview?.requests[0]).toMatchObject({ id: requestId, status: "requested" });
  });
  it("accepts a missing policy (null minimum/cadence) but fails closed on drift", () => {
    expect(mapPayoutOverview({
      currencies: [{ currency: "USD", exponent: 2, payableMinor: "0", reservedMinor: "0",
        minimumPayoutMinor: null, payoutCadence: null }], requests: [],
    })).not.toBeNull();
    expect(mapPayoutOverview({
      currencies: [{ currency: "USD", exponent: 2, payableMinor: "10.5", reservedMinor: "0",
        minimumPayoutMinor: null, payoutCadence: null }], requests: [],
    })).toBeNull();
    expect(mapPayoutOverview({
      currencies: [], requests: [{ id: requestId, requestKey: key, currency: "USD", amountMinor: "1",
        status: "paid", externalReference: null, failureReason: null, createdAt: "2026-10-26T00:00:00.000Z" }],
    })).toBeNull();
    expect(mapPayoutOverview(null)).toBeNull();
    expect(mapPayoutOverview({ currencies: [] })).toBeNull();
  });
  it("maps the admin queue and rejects non-queue statuses", () => {
    const row = { id: requestId, request_key: key, affiliate_id: "30000000-0000-4000-8000-0000000000cc",
      affiliate_user_id: "40000000-0000-4000-8000-0000000000dd", display_name: "Partner One",
      currency: "USD", amount_minor: "2500", status: "approved", external_reference: null,
      failure_reason: null, created_at: "2026-10-26T00:00:00.000Z" };
    expect(mapAdminPayoutQueue([row])?.[0]).toMatchObject({ displayName: "Partner One", status: "approved" });
    expect(mapAdminPayoutQueue([{ ...row, status: "settled" }])).toBeNull();
    expect(mapAdminPayoutQueue("nope")).toBeNull();
  });
});
