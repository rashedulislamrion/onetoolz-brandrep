// Pure mapping of affiliate_commission_totals() rows into dashboard-safe
// per-currency totals. The RPC groups by currency/qualification/status and
// returns counts (bigint) and net sums as minor-unit TEXT. Any shape drift
// fails closed (null) so the dashboard keeps its unavailable placeholders
// instead of rendering a guessed number.
//
// The RPC carries no currency exponent, so amounts stay in exact minor
// units — the dashboard labels them as such rather than inventing decimal
// placement.
export type QualificationTotals = Readonly<{ count: string; netMinor: string }>;
export type CurrencyTotals = Readonly<{
  currency: string;
  qualified: QualificationTotals;
  unqualified: QualificationTotals;
}>;

const zero: QualificationTotals = Object.freeze({ count: "0", netMinor: "0" });

function countValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^(0|[1-9]\d{0,15})$/.test(value)) return value;
  return null;
}

export function mapCommissionTotals(rows: unknown): readonly CurrencyTotals[] | null {
  if (!Array.isArray(rows)) return null;
  const byCurrency = new Map<string, { qualified: { count: bigint; net: bigint }; unqualified: { count: bigint; net: bigint } }>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const r = row as Record<string, unknown>;
    const count = countValue(r.calculation_count);
    if (typeof r.currency !== "string" || !/^[A-Z]{3}$/.test(r.currency) ||
      !["qualified", "unqualified"].includes(r.qualification as string) ||
      typeof r.status !== "string" || r.status.length === 0 || count === null ||
      typeof r.net_minor !== "string" || !/^(0|[1-9]\d{0,18})$/.test(r.net_minor)) return null;
    const entry = byCurrency.get(r.currency) ?? {
      qualified: { count: 0n, net: 0n }, unqualified: { count: 0n, net: 0n },
    };
    const bucket = entry[r.qualification as "qualified" | "unqualified"];
    bucket.count += BigInt(count);
    bucket.net += BigInt(r.net_minor);
    byCurrency.set(r.currency, entry);
  }
  const freeze = (value: { count: bigint; net: bigint }): QualificationTotals =>
    Object.freeze({ count: value.count.toString(), netMinor: value.net.toString() });
  return Object.freeze([...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => Object.freeze({
      currency,
      qualified: value.qualified.count === 0n && value.qualified.net === 0n ? zero : freeze(value.qualified),
      unqualified: value.unqualified.count === 0n && value.unqualified.net === 0n ? zero : freeze(value.unqualified),
    })));
}
