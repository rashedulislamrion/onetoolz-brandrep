import { describe, expect, it } from "vitest";
import { MAX_MINOR_UNITS, validateJournal } from "../../src/lib/ledger/journal";

function journal(amount = "1000") {
  return {
    effectKey: "fixture:earned:1", currency: "USD", exponent: 2, reason: "Synthetic journal",
    lines: [
      { accountId: "10000000-0000-4000-8000-000000000001", currency: "USD", exponent: 2, debitMinor: amount, creditMinor: "0" },
      { accountId: "10000000-0000-4000-8000-000000000002", currency: "USD", exponent: 2, debitMinor: "0", creditMinor: amount },
    ],
  };
}

describe("journal validation (synthetic, no posting)", () => {
  it("accepts balanced entries and returns an immutable copy", () => {
    const input = journal(); const result = validateJournal(input);
    expect(result).toEqual(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.lines)).toBe(true);
    expect(Object.isFrozen(result?.lines[0])).toBe(true);
    input.lines[0].debitMinor = "5";
    expect(result?.lines[0].debitMinor).toBe("1000");
  });
  it("uses exact amounts above Number.MAX_SAFE_INTEGER", () => {
    expect(validateJournal(journal("9007199254740993"))).not.toBeNull();
    expect(validateJournal(journal(MAX_MINOR_UNITS.toString()))).not.toBeNull();
  });
  it.each(["0", "-1", "1.00", "1e3", "01", "+1", " 1", "", "9223372036854775808"])("rejects invalid amounts %s", amount => {
    expect(validateJournal(journal(amount))).toBeNull();
  });
  it("rejects numeric rather than string amounts", () => {
    const input = journal();
    expect(validateJournal({ ...input, lines: [{ ...input.lines[0], debitMinor: 1000 }, input.lines[1]] })).toBeNull();
  });
  it("rejects unbalanced, dual-sided and empty lines", () => {
    const input = journal(); input.lines[0].debitMinor = "999";
    expect(validateJournal(input)).toBeNull();
    input.lines[0].creditMinor = "1";
    expect(validateJournal(input)).toBeNull();
    input.lines[0].debitMinor = "0"; input.lines[0].creditMinor = "0";
    expect(validateJournal(input)).toBeNull();
  });
  it("rejects mixed currency or precision", () => {
    const input = journal(); input.lines[1].currency = "EUR";
    expect(validateJournal(input)).toBeNull();
    input.lines[1].currency = "USD"; input.lines[1].exponent = 3;
    expect(validateJournal(input)).toBeNull();
  });
  it("rejects self-only entries and invalid account IDs", () => {
    const input = journal(); input.lines[1].accountId = input.lines[0].accountId;
    expect(validateJournal(input)).toBeNull();
    input.lines[1].accountId = "invalid";
    expect(validateJournal(input)).toBeNull();
  });
  it("rejects aggregate overflow even when each line fits", () => {
    const input = journal(MAX_MINOR_UNITS.toString()); input.lines.push(...journal("1").lines);
    expect(validateJournal(input)).toBeNull();
  });
  it("accepts split postings and compensating direction", () => {
    const input = journal(); input.lines[1].creditMinor = "600";
    input.lines.push({ ...input.lines[1], creditMinor: "400" });
    expect(validateJournal(input)).not.toBeNull();
    input.lines = input.lines.map(line => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor }));
    expect(validateJournal(input)).not.toBeNull();
  });
  it.each([null, [], {}, { ...journal(), effectKey: "" }, { ...journal(), currency: "usd" }, { ...journal(), exponent: 1.5 }, { ...journal(), reason: " " }, { ...journal(), lines: [] }, { ...journal(), lines: Array(201).fill(journal().lines[0]) }])("rejects malformed envelopes %#", value => {
    expect(validateJournal(value)).toBeNull();
  });
  it("preserves balance across a deterministic range and detects one-unit drift", () => {
    for (let amount = 1n; amount <= 100n; amount++) {
      const input = journal((amount * 9007199254741n).toString());
      expect(validateJournal(input)).not.toBeNull();
      input.lines[1].creditMinor = (BigInt(input.lines[1].creditMinor) + 1n).toString();
      expect(validateJournal(input)).toBeNull();
    }
  });
});