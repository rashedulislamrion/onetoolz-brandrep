import { formatMinorToDecimal } from "../payouts/overview";

// Pure mapping of affiliate_ledger_balances() rows into dashboard-safe
// per-currency bucket balances. The RPC returns one row per existing
// ledger account (currency, exponent, bucket, balance as exact minor-unit
// TEXT derived from journal lines, credits - debits). Any shape drift —
// unknown bucket, duplicate account row, conflicting exponents for one
// currency, malformed amounts — fails closed (null) so the dashboard
// keeps its unavailable placeholders instead of rendering a guessed
// balance. A bucket with no row for a currency stays null (no account
// exists); a row present with "0" is a real zero and is rendered as one.

export const LEDGER_BUCKETS = ["held", "payable", "reserved", "disputed", "recovery"] as const;
export type LedgerBucket = (typeof LEDGER_BUCKETS)[number];

export type BucketBalance = Readonly<{ minor: string; decimal: string }>;

export type CurrencyLedgerBalances = Readonly<{
  currency: string;
  exponent: number;
  buckets: Readonly<Record<LedgerBucket, BucketBalance | null>>;
}>;

const MINOR = /^-?(0|[1-9]\d{0,18})$/;

function minorValue(value: unknown): string | null {
  if (typeof value === "string" && MINOR.test(value)) return value === "-0" ? "0" : value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function exponentValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) return value;
  if (typeof value === "string" && /^[0-6]$/.test(value)) return Number(value);
  return null;
}

export function mapLedgerBalances(rows: unknown): readonly CurrencyLedgerBalances[] | null {
  if (!Array.isArray(rows)) return null;
  const byCurrency = new Map<string, { exponent: number; buckets: Map<LedgerBucket, BucketBalance> }>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const r = row as Record<string, unknown>;
    const exponent = exponentValue(r.exponent);
    const minor = minorValue(r.balance_minor);
    if (typeof r.currency !== "string" || !/^[A-Z]{3}$/.test(r.currency) || exponent === null ||
      minor === null || !(LEDGER_BUCKETS as readonly string[]).includes(r.bucket as string)) return null;
    const decimal = formatMinorToDecimal(minor, exponent);
    if (decimal === null) return null;
    const bucket = r.bucket as LedgerBucket;
    const entry = byCurrency.get(r.currency) ?? { exponent, buckets: new Map<LedgerBucket, BucketBalance>() };
    if (entry.exponent !== exponent || entry.buckets.has(bucket)) return null;
    entry.buckets.set(bucket, Object.freeze({ minor, decimal }));
    byCurrency.set(r.currency, entry);
  }
  return Object.freeze([...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, entry]) => Object.freeze({
      currency,
      exponent: entry.exponent,
      buckets: Object.freeze(Object.fromEntries(
        LEDGER_BUCKETS.map(bucket => [bucket, entry.buckets.get(bucket) ?? null]),
      ) as Record<LedgerBucket, BucketBalance | null>),
    })));
}
