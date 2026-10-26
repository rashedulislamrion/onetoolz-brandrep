import { isPayoutStatus, type PayoutStatus } from "./transitions";

// Pure mapping of affiliate_payout_overview() / admin_payout_queue()
// results into page-safe shapes. Any shape drift fails closed (null) so
// pages render their unavailable states instead of guessed numbers —
// the same discipline as lib/ledger/totals.ts. Amounts stay exact
// minor-unit strings; the overview carries the currency exponent, so
// formatMinorToDecimal can place the decimal point without inventing it.

export type PayoutCurrency = Readonly<{
  currency: string;
  exponent: number;
  payableMinor: string;
  reservedMinor: string;
  minimumPayoutMinor: string | null;
  payoutCadence: string | null;
}>;

export type OwnPayoutRequest = Readonly<{
  id: string;
  requestKey: string;
  currency: string;
  amountMinor: string;
  status: PayoutStatus;
  externalReference: string | null;
  failureReason: string | null;
  createdAt: string;
}>;

export type PayoutOverview = Readonly<{
  currencies: readonly PayoutCurrency[];
  requests: readonly OwnPayoutRequest[];
}>;

export type AdminPayoutRow = Readonly<{
  id: string;
  requestKey: string;
  affiliateId: string;
  affiliateUserId: string;
  displayName: string;
  currency: string;
  amountMinor: string;
  status: PayoutStatus;
  externalReference: string | null;
  failureReason: string | null;
  createdAt: string;
}>;

const MINOR = /^(0|[1-9]\d{0,18})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minorOrNull(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === "string" && MINOR.test(value) ? value : "INVALID";
}

function nullableText(value: unknown): string | null | "INVALID" {
  if (value === null) return null;
  return typeof value === "string" && value.length > 0 ? value : "INVALID";
}

/** Exact minor → decimal rendering under a known exponent. */
export function formatMinorToDecimal(minor: string, exponent: number): string | null {
  if (typeof minor !== "string" || !/^-?(0|[1-9]\d{0,18})$/.test(minor)
    || !Number.isInteger(exponent) || exponent < 0 || exponent > 6) return null;
  const negative = minor.startsWith("-");
  const digits = negative ? minor.slice(1) : minor;
  if (exponent === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(exponent + 1, "0");
  return `${negative ? "-" : ""}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

export function mapPayoutOverview(data: unknown): PayoutOverview | null {
  if (!record(data) || !Array.isArray(data.currencies) || !Array.isArray(data.requests)) return null;
  const currencies: PayoutCurrency[] = [];
  for (const row of data.currencies) {
    if (!record(row) || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)
      || typeof row.exponent !== "number" || !Number.isInteger(row.exponent)
      || row.exponent < 0 || row.exponent > 6
      || typeof row.payableMinor !== "string" || !MINOR.test(row.payableMinor)
      || typeof row.reservedMinor !== "string" || !MINOR.test(row.reservedMinor)) return null;
    const minimum = minorOrNull(row.minimumPayoutMinor);
    const cadence = nullableText(row.payoutCadence);
    if (minimum === "INVALID" || cadence === "INVALID") return null;
    currencies.push(Object.freeze({
      currency: row.currency, exponent: row.exponent,
      payableMinor: row.payableMinor, reservedMinor: row.reservedMinor,
      minimumPayoutMinor: minimum, payoutCadence: cadence,
    }));
  }
  const requests: OwnPayoutRequest[] = [];
  for (const row of data.requests) {
    if (!record(row) || typeof row.id !== "string" || !UUID.test(row.id)
      || typeof row.requestKey !== "string" || row.requestKey.length === 0
      || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)
      || typeof row.amountMinor !== "string" || !MINOR.test(row.amountMinor)
      || !isPayoutStatus(row.status) || typeof row.createdAt !== "string" || row.createdAt.length === 0) return null;
    const externalReference = nullableText(row.externalReference);
    const failureReason = nullableText(row.failureReason);
    if (externalReference === "INVALID" || failureReason === "INVALID") return null;
    requests.push(Object.freeze({
      id: row.id, requestKey: row.requestKey, currency: row.currency,
      amountMinor: row.amountMinor, status: row.status,
      externalReference, failureReason, createdAt: row.createdAt,
    }));
  }
  return Object.freeze({ currencies: Object.freeze(currencies), requests: Object.freeze(requests) });
}

export function mapAdminPayoutQueue(rows: unknown): readonly AdminPayoutRow[] | null {
  if (!Array.isArray(rows)) return null;
  const queue: AdminPayoutRow[] = [];
  for (const row of rows) {
    if (!record(row) || typeof row.id !== "string" || !UUID.test(row.id)
      || typeof row.request_key !== "string" || row.request_key.length === 0
      || typeof row.affiliate_id !== "string" || !UUID.test(row.affiliate_id)
      || typeof row.affiliate_user_id !== "string" || !UUID.test(row.affiliate_user_id)
      || typeof row.display_name !== "string" || row.display_name.length === 0
      || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)
      || typeof row.amount_minor !== "string" || !MINOR.test(row.amount_minor)
      || !isPayoutStatus(row.status) || (row.status !== "requested" && row.status !== "approved")
      || typeof row.created_at !== "string" || row.created_at.length === 0) return null;
    const externalReference = nullableText(row.external_reference);
    const failureReason = nullableText(row.failure_reason);
    if (externalReference === "INVALID" || failureReason === "INVALID") return null;
    queue.push(Object.freeze({
      id: row.id, requestKey: row.request_key, affiliateId: row.affiliate_id,
      affiliateUserId: row.affiliate_user_id, displayName: row.display_name,
      currency: row.currency, amountMinor: row.amount_minor, status: row.status,
      externalReference, failureReason, createdAt: row.created_at,
    }));
  }
  return Object.freeze(queue);
}
