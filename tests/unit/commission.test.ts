import { describe, expect, it } from "vitest";
import { calculateCommission, decimalToMinor, policyForOrder, type CommissionPolicy } from "@/lib/ledger/commission";
const first: CommissionPolicy = { version: 1, effectiveAt: "2026-10-16T10:00:00.000Z", commissionBps: 1250,
  currency: "USD", currencyDecimals: 2, basis: "net_items", refundRule: "proportional", scope: "all_products_one_time" };
const quote = (basisAmount = "10.00", refundedBasisAmount = "0", policy = first) => calculateCommission(policy,
  { currency: "USD", basisAmount, refundedBasisAmount, rounding: "half_up" });

describe("exact commission minor units", () => {
  it("converts exact decimals and allows only zero padding beyond currency precision", () => {
    expect(decimalToMinor("25.50000000", 2)).toBe(2550n); expect(decimalToMinor("3.000", 0)).toBe(3n);
    expect(decimalToMinor("0.000001", 6)).toBe(1n);
  });
  it.each(["-1", "+1", "01", "1e3", "NaN", "Infinity", " 1", "1.", ".1", "0.001", "1.000000001", "9223372036854775808"])("rejects invalid or overflowing amount %s", amount => {
    expect(decimalToMinor(amount, 2)).toBeNull();
  });
  it.each([-1, 7, 1.5, NaN])("rejects invalid precision %s", precision => expect(decimalToMinor("1", precision)).toBeNull());
  it("handles PostgreSQL bigint maximum without floating point", () => {
    expect(decimalToMinor("92233720368547758.07", 2)).toBe(9223372036854775807n);
    expect(quote("92233720368547758.07", "0", { ...first, commissionBps: 10000 })?.grossCommissionMinor).toBe("9223372036854775807");
    expect(decimalToMinor("92233720368547758.08", 2)).toBeNull();
  });
});
describe("effective-dated published policy selection", () => {
  const second = { ...first, version: 2, effectiveAt: "2026-10-17T10:00:00.000Z", commissionBps: 1500 };
  it("uses order creation time and does not retroactively adopt a later rate", () => {
    expect(policyForOrder([second, first], "2026-10-17T09:59:59.999Z")?.version).toBe(1);
    expect(policyForOrder([first, second], second.effectiveAt)?.version).toBe(2);
    expect(policyForOrder([first], "2026-10-16T09:59:59.999Z")).toBeNull();
  });
  it("rejects incomplete, duplicate or chronologically inconsistent histories", () => {
    for (const policies of [[], [second], [first, first], [first, { ...second, effectiveAt: "2026-10-15T10:00:00.000Z" }]]) {
      expect(policyForOrder(policies, "2026-10-18T10:00:00.000Z")).toBeNull();
    }
  });
  it("breaks identical effective timestamps by version and returns an immutable snapshot", () => {
    const selected = policyForOrder([first, { ...second, effectiveAt: first.effectiveAt }], first.effectiveAt);
    expect(selected?.version).toBe(2); expect(Object.isFrozen(selected)).toBe(true); expect(selected).not.toBe(second);
  });
  it.each(["2026-02-30T10:00:00.000Z", "2026-10-16", "2026-10-16T10:00:00Z", "invalid"])("rejects invalid/noncanonical order date %s", date => {
    expect(policyForOrder([first], date)).toBeNull();
  });
});
describe("nonposting commission quotes", () => {
  it("calculates percentage and cumulative proportional reversal", () => {
    expect(quote("10", "2")).toMatchObject({ policyVersion: 1, basisMinor: "1000", refundedBasisMinor: "200",
      grossCommissionMinor: "125", reversalMinor: "25", netCommissionMinor: "100" });
    expect(Object.isFrozen(quote())).toBe(true);
  });
  it("has explicit rounding and no hidden default", () => {
    expect(quote("0.04")?.grossCommissionMinor).toBe("1");
    expect(calculateCommission(first, { currency: "USD", basisAmount: "0.04", refundedBasisAmount: "0", rounding: "down" })?.grossCommissionMinor).toBe("0");
    expect(calculateCommission(first, { currency: "USD", basisAmount: "1", refundedBasisAmount: "0", rounding: undefined! })).toBeNull();
  });
  it("fully reverses on any refund only if selected by policy", () => {
    expect(quote("10", "0.01", { ...first, refundRule: "full_on_any_refund" })).toMatchObject({ reversalMinor: "125", netCommissionMinor: "0" });
    expect(quote("10", "0", { ...first, refundRule: "full_on_any_refund" })?.netCommissionMinor).toBe("125");
  });
  it("rejects excess refunds, currency mismatch and unsupported basis precision", () => {
    expect(quote("1", "1.01")).toBeNull(); expect(quote("0.001")).toBeNull();
    expect(calculateCommission(first, { currency: "EUR", basisAmount: "10", refundedBasisAmount: "0", rounding: "half_up" })).toBeNull();
  });
  it.each([0, 10000])("honors admin-selected boundary rate %s", commissionBps => {
    expect(quote("1", "0", { ...first, commissionBps })?.grossCommissionMinor).toBe(commissionBps === 0 ? "0" : "100");
  });
  it.each([{ commissionBps: 10001 }, { commissionBps: -1 }, { commissionBps: 1.5 }, { version: 0 }, { currencyDecimals: 7 },
    { basis: "unknown" }, { refundRule: "none" }, { scope: "recurring" }, { effectiveAt: "invalid" }])("rejects malformed policy %j", patch => {
    expect(quote("10", "0", { ...first, ...patch } as CommissionPolicy)).toBeNull();
  });
  it("reconciles every cumulative refund to gross without rounding drift", () => {
    const policy = { ...first, commissionBps: 3333 };
    let previousReversal = 0n; let deltas = 0n;
    for (let refunded = 0; refunded <= 100; refunded++) {
      const result = quote("1", `${Math.floor(refunded / 100)}.${String(refunded % 100).padStart(2, "0")}`, policy)!;
      const reversal = BigInt(result.reversalMinor);
      expect(reversal).toBeGreaterThanOrEqual(previousReversal);
      expect(reversal + BigInt(result.netCommissionMinor)).toBe(BigInt(result.grossCommissionMinor));
      deltas += reversal - previousReversal; previousReversal = reversal;
    }
    expect(deltas).toBe(33n); expect(quote("1", "1", policy)?.netCommissionMinor).toBe("0");
  });
});