import { formatMinorToDecimal } from "../payouts/overview";

// Pure mapping of admin_reconciliation_overview() into page-safe shapes.
// The RPC states, per currency, the commission value that left the
// platform expense source (debits - credits) and where it currently sits
// (credits - debits across held, payable, reserved, disputed, recovery
// and clearing); differenceMinor is expenseDebits - destinationTotal and
// must be exactly "0" for the Phase 4/5 journal flows to reconcile.
// The mapper RECOMPUTES both the destination total and the difference
// from the component buckets with exact bigint arithmetic: any drift
// between the RPC's stated totals and its own components fails closed
// (null) rather than displaying a total the components do not support.

export type CalculationCounts = Readonly<{ qualification: string; count: string; netMinor: string }>;
export type PayoutCounts = Readonly<{ status: string; count: string; amountMinor: string }>;

export type ReconciliationCurrency = Readonly<{
  currency: string;
  exponent: number;
  expenseDebitsMinor: string;
  heldMinor: string;
  payableMinor: string;
  reservedMinor: string;
  disputedMinor: string;
  recoveryMinor: string;
  clearingMinor: string;
  destinationTotalMinor: string;
  differenceMinor: string;
  balanced: boolean;
  calculations: readonly CalculationCounts[];
  payouts: readonly PayoutCounts[];
}>;

const MINOR = /^-?(0|[1-9]\d{0,18})$/;
const COUNT = /^(0|[1-9]\d{0,15})$/;
const QUALIFICATIONS = ["qualified", "unqualified"];
const PAYOUT_STATUSES = ["requested", "approved", "rejected", "settled", "cancelled", "failed"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minorField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (typeof value === "string" && MINOR.test(value)) return value === "-0" ? "0" : value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function countField(value: unknown): string | null {
  if (typeof value === "string" && COUNT.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function exponentField(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) return value;
  if (typeof value === "string" && /^[0-6]$/.test(value)) return Number(value);
  return null;
}

/** Formatted decimal for a validated minor string under a known exponent. */
export function formatReconciliationMinor(minor: string, exponent: number): string {
  return formatMinorToDecimal(minor, exponent) ?? minor;
}

export function mapReconciliationOverview(data: unknown): readonly ReconciliationCurrency[] | null {
  if (!record(data) || !Array.isArray(data.currencies)) return null;
  const currencies: ReconciliationCurrency[] = [];
  const seen = new Set<string>();
  for (const row of data.currencies) {
    if (!record(row) || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency) ||
      seen.has(row.currency)) return null;
    seen.add(row.currency);
    const exponent = exponentField(row.exponent);
    const expenseDebitsMinor = minorField(row, "expenseDebitsMinor");
    const heldMinor = minorField(row, "heldMinor");
    const payableMinor = minorField(row, "payableMinor");
    const reservedMinor = minorField(row, "reservedMinor");
    const disputedMinor = minorField(row, "disputedMinor");
    const recoveryMinor = minorField(row, "recoveryMinor");
    const clearingMinor = minorField(row, "clearingMinor");
    const destinationTotalMinor = minorField(row, "destinationTotalMinor");
    const differenceMinor = minorField(row, "differenceMinor");
    if (exponent === null || expenseDebitsMinor === null || heldMinor === null || payableMinor === null ||
      reservedMinor === null || disputedMinor === null || recoveryMinor === null || clearingMinor === null ||
      destinationTotalMinor === null || differenceMinor === null) return null;
    const destination = BigInt(heldMinor) + BigInt(payableMinor) + BigInt(reservedMinor) +
      BigInt(disputedMinor) + BigInt(recoveryMinor) + BigInt(clearingMinor);
    if (destination.toString() !== destinationTotalMinor ||
      (BigInt(expenseDebitsMinor) - destination).toString() !== differenceMinor) return null;
    if (!Array.isArray(row.calculations) || !Array.isArray(row.payouts)) return null;
    const calculations: CalculationCounts[] = [];
    for (const entry of row.calculations) {
      if (!record(entry) || !QUALIFICATIONS.includes(entry.qualification as string)) return null;
      const count = countField(entry.count);
      const netMinor = minorField(entry, "netMinor");
      if (count === null || netMinor === null) return null;
      calculations.push(Object.freeze({ qualification: entry.qualification as string, count, netMinor }));
    }
    const payouts: PayoutCounts[] = [];
    for (const entry of row.payouts) {
      if (!record(entry) || !PAYOUT_STATUSES.includes(entry.status as string)) return null;
      const count = countField(entry.count);
      const amountMinor = minorField(entry, "amountMinor");
      if (count === null || amountMinor === null) return null;
      payouts.push(Object.freeze({ status: entry.status as string, count, amountMinor }));
    }
    currencies.push(Object.freeze({
      currency: row.currency, exponent, expenseDebitsMinor, heldMinor, payableMinor, reservedMinor,
      disputedMinor, recoveryMinor, clearingMinor, destinationTotalMinor, differenceMinor,
      balanced: differenceMinor === "0",
      calculations: Object.freeze(calculations), payouts: Object.freeze(payouts),
    }));
  }
  currencies.sort((a, b) => a.currency.localeCompare(b.currency));
  return Object.freeze(currencies);
}
