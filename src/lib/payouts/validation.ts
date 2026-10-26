import { decimalToMinor } from "@/lib/ledger/commission";

// Pure form validation for payout actions. These checks mirror the payout
// RPCs (20261026060000_payouts.sql) so invalid input never reaches the
// database; the RPCs re-validate everything and remain authoritative.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** The external transfer reference an administrator records at settlement. */
export function validExternalReference(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 4 && value.trim().length <= 120;
}

function validReason(value: string): boolean {
  return value.length >= 3 && value.length <= 1000;
}

export type PayoutRequestInput = Readonly<{
  requestKey: string;
  currency: string;
  amountDecimal: string;
}>;

/**
 * Parses the affiliate payout-request form. The amount stays a decimal
 * string here: converting it to minor units needs the currency exponent,
 * which the action reads from the authoritative payout overview — never
 * from the submitted form.
 */
export function parsePayoutRequest(form: FormData): PayoutRequestInput | null {
  const requestKey = text(form, "requestKey");
  const currency = text(form, "currency");
  const amountDecimal = text(form, "amount");
  if (!validUuid(requestKey) || !/^[A-Z]{3}$/.test(currency)) return null;
  if (!/^(0|[1-9]\d{0,18})(\.\d{1,8})?$/.test(amountDecimal)) return null;
  return Object.freeze({ requestKey: requestKey.toLowerCase(), currency, amountDecimal });
}

/** Exact decimal → minor conversion under a trusted exponent; null when inexact or non-positive. */
export function payoutAmountMinor(amountDecimal: string, exponent: number): string | null {
  const minor = decimalToMinor(amountDecimal, exponent);
  if (minor === null || minor <= 0n) return null;
  return minor.toString();
}

export function parsePayoutCancel(form: FormData): Readonly<{ requestId: string }> | null {
  const requestId = text(form, "requestId");
  if (!validUuid(requestId) || form.get("confirmed") !== "yes") return null;
  return Object.freeze({ requestId: requestId.toLowerCase() });
}

export type PayoutReviewInput = Readonly<{
  requestId: string;
  decision: "approve" | "reject";
  reason: string;
}>;

export function parsePayoutReview(form: FormData): PayoutReviewInput | null {
  const requestId = text(form, "requestId");
  const decision = text(form, "decision");
  const reason = text(form, "reason");
  if (!validUuid(requestId) || (decision !== "approve" && decision !== "reject")
    || !validReason(reason) || form.get("confirmed") !== "yes") return null;
  return Object.freeze({ requestId: requestId.toLowerCase(), decision, reason });
}

export function parsePayoutSettle(form: FormData):
  Readonly<{ requestId: string; externalReference: string }> | null {
  const requestId = text(form, "requestId");
  const externalReference = text(form, "externalReference");
  if (!validUuid(requestId) || !validExternalReference(externalReference)
    || form.get("confirmed") !== "yes") return null;
  return Object.freeze({ requestId: requestId.toLowerCase(), externalReference });
}

export function parsePayoutFail(form: FormData):
  Readonly<{ requestId: string; reason: string }> | null {
  const requestId = text(form, "requestId");
  const reason = text(form, "reason");
  if (!validUuid(requestId) || !validReason(reason) || form.get("confirmed") !== "yes") return null;
  return Object.freeze({ requestId: requestId.toLowerCase(), reason });
}
