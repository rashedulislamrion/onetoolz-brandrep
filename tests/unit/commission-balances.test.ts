import { describe, expect, it } from "vitest";
import { mapLedgerBalances } from "../../src/lib/ledger/balances";

describe("ledger balances dashboard mapping", () => {
  it("maps per-currency bucket rows with decimal formatting from the row exponent", () => {
    const balances = mapLedgerBalances([
      { currency: "USD", exponent: 2, bucket: "held", balance_minor: "57000" },
      { currency: "USD", exponent: 2, bucket: "payable", balance_minor: "30000" },
      { currency: "USD", exponent: 2, bucket: "recovery", balance_minor: "0" },
      { currency: "BDT", exponent: 0, bucket: "payable", balance_minor: "1500" },
      { currency: "JPY", exponent: "0", bucket: "held", balance_minor: -250 },
    ]);
    expect(balances).toEqual([
      { currency: "BDT", exponent: 0, buckets: { held: null, payable: { minor: "1500", decimal: "1500" }, reserved: null, disputed: null, recovery: null } },
      { currency: "JPY", exponent: 0, buckets: { held: { minor: "-250", decimal: "-250" }, payable: null, reserved: null, disputed: null, recovery: null } },
      { currency: "USD", exponent: 2, buckets: { held: { minor: "57000", decimal: "570.00" }, payable: { minor: "30000", decimal: "300.00" }, reserved: null, disputed: null, recovery: { minor: "0", decimal: "0.00" } } },
    ]);
  });

  it("accepts an empty result as connected with no ledger accounts", () => {
    expect(mapLedgerBalances([])).toEqual([]);
  });

  it.each([null, undefined, "rows", [{}],
    [{ currency: "usd", exponent: 2, bucket: "held", balance_minor: "1" }],
    [{ currency: "USD", exponent: 2, bucket: "expense", balance_minor: "1" }],
    [{ currency: "USD", exponent: 2, bucket: "clearing", balance_minor: "1" }],
    [{ currency: "USD", exponent: 7, bucket: "held", balance_minor: "1" }],
    [{ currency: "USD", exponent: 2, bucket: "held", balance_minor: "1.5" }],
    [{ currency: "USD", exponent: 2, bucket: "held", balance_minor: "01" }],
    [{ currency: "USD", exponent: 2, bucket: "held", balance_minor: "1" },
     { currency: "USD", exponent: 2, bucket: "held", balance_minor: "2" }],
    [{ currency: "USD", exponent: 2, bucket: "held", balance_minor: "1" },
     { currency: "USD", exponent: 3, bucket: "payable", balance_minor: "2" }]])(
    "fails closed on malformed input %#", input => {
      expect(mapLedgerBalances(input)).toBeNull();
    });
});
