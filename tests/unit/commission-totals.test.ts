import { describe, expect, it } from "vitest";
import { mapCommissionTotals } from "../../src/lib/ledger/totals";

describe("commission totals dashboard mapping", () => {
  it("aggregates grouped RPC rows per currency and qualification with exact bigint sums", () => {
    const totals = mapCommissionTotals([
      { currency: "USD", qualification: "qualified", status: "recorded", calculation_count: "2", net_minor: "80" },
      { currency: "USD", qualification: "qualified", status: "recorded", calculation_count: 1, net_minor: "9223372036854775807" },
      { currency: "USD", qualification: "unqualified", status: "recorded", calculation_count: "3", net_minor: "50" },
      { currency: "BDT", qualification: "unqualified", status: "recorded", calculation_count: "1", net_minor: "700" },
    ]);
    expect(totals).toEqual([
      { currency: "BDT", qualified: { count: "0", netMinor: "0" }, unqualified: { count: "1", netMinor: "700" } },
      { currency: "USD", qualified: { count: "3", netMinor: "9223372036854775887" }, unqualified: { count: "3", netMinor: "50" } },
    ]);
  });

  it("accepts an empty result as connected with no calculations", () => {
    expect(mapCommissionTotals([])).toEqual([]);
  });

  it.each([null, undefined, "rows", [{}], [{ currency: "usd", qualification: "qualified", status: "recorded", calculation_count: "1", net_minor: "1" }],
    [{ currency: "USD", qualification: "pending", status: "recorded", calculation_count: "1", net_minor: "1" }],
    [{ currency: "USD", qualification: "qualified", status: "recorded", calculation_count: "1", net_minor: "1.5" }],
    [{ currency: "USD", qualification: "qualified", status: "recorded", calculation_count: -1, net_minor: "1" }],
    [{ currency: "USD", qualification: "qualified", status: "recorded", calculation_count: "1", net_minor: "-5" }]])(
    "fails closed on malformed input %#", input => {
      expect(mapCommissionTotals(input)).toBeNull();
    });
});
