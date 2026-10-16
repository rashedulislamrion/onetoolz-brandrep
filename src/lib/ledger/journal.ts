// Pure validation only. No posting, authorization, balances or commission policy.
export const MAX_MINOR_UNITS = 9223372036854775807n;

export type JournalLine = Readonly<{
  accountId: string;
  currency: string;
  exponent: number;
  debitMinor: string;
  creditMinor: string;
}>;
export type Journal = Readonly<{
  effectKey: string;
  currency: string;
  exponent: number;
  reason: string;
  lines: readonly JournalLine[];
}>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minorUnits(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,18})$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= MAX_MINOR_UNITS ? amount : null;
}

/** Currency syntax is checked here; supported currencies/exponents require trusted configuration. */
export function validateJournal(value: unknown): Journal | null {
  if (!record(value) || typeof value.effectKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$/.test(value.effectKey)
    || typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)
    || typeof value.exponent !== "number" || !Number.isInteger(value.exponent) || value.exponent < 0 || value.exponent > 6
    || typeof value.reason !== "string" || value.reason.trim().length < 3 || value.reason.trim().length > 1000
    || !Array.isArray(value.lines) || value.lines.length < 2 || value.lines.length > 200) return null;

  let debits = 0n;
  let credits = 0n;
  const accounts = new Set<string>();
  const lines: JournalLine[] = [];
  for (const line of value.lines) {
    if (!record(line) || typeof line.accountId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.accountId)
      || line.currency !== value.currency || line.exponent !== value.exponent) return null;
    const debit = minorUnits(line.debitMinor);
    const credit = minorUnits(line.creditMinor);
    if (debit === null || credit === null || (debit === 0n) === (credit === 0n)) return null;
    debits += debit;
    credits += credit;
    const accountId = line.accountId.toLowerCase();
    accounts.add(accountId);
    lines.push(Object.freeze({ accountId, currency: value.currency, exponent: value.exponent, debitMinor: debit.toString(), creditMinor: credit.toString() }));
  }
  if (accounts.size < 2 || debits !== credits || debits > MAX_MINOR_UNITS) return null;
  return Object.freeze({ effectKey: value.effectKey, currency: value.currency, exponent: value.exponent, reason: value.reason.trim(), lines: Object.freeze(lines) });
}