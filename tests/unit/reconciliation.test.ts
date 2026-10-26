import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mapReconciliationOverview } from "../../src/lib/ledger/reconciliation";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/access", () => ({ requireAccess: access }));
import AdminReconciliation from "../../src/app/admin/reconciliation/page";

const balancedCurrency = {
  currency: "USD", exponent: 2,
  expenseDebitsMinor: "95000", heldMinor: "55000", payableMinor: "25000",
  reservedMinor: "0", disputedMinor: "0", recoveryMinor: "0", clearingMinor: "15000",
  destinationTotalMinor: "95000", differenceMinor: "0",
  calculations: [
    { qualification: "qualified", count: "2", netMinor: "300" },
    { qualification: "unqualified", count: "1", netMinor: "50" },
  ],
  payouts: [
    { status: "settled", count: "1", amountMinor: "15000" },
    { status: "requested", count: "1", amountMinor: "7000" },
  ],
};

describe("reconciliation overview mapping", () => {
  it("maps a balanced currency and recomputes its totals", () => {
    const result = mapReconciliationOverview({ currencies: [balancedCurrency] });
    expect(result).toEqual([{ ...balancedCurrency, balanced: true }]);
  });

  it("keeps a genuinely mismatched currency, flagged unbalanced", () => {
    const mismatch = { ...balancedCurrency, heldMinor: "54000", destinationTotalMinor: "94000", differenceMinor: "1000" };
    const result = mapReconciliationOverview({ currencies: [mismatch] });
    expect(result?.[0].balanced).toBe(false);
    expect(result?.[0].differenceMinor).toBe("1000");
  });

  it("accepts an empty currency list as a connected, empty ledger", () => {
    expect(mapReconciliationOverview({ currencies: [] })).toEqual([]);
  });

  it.each([null, undefined, "rows", {}, { currencies: "USD" }, { currencies: [{}] },
    // Stated destination total disagrees with its own components.
    { currencies: [{ ...balancedCurrency, destinationTotalMinor: "94999" }] },
    // Stated difference disagrees with expense minus destination.
    { currencies: [{ ...balancedCurrency, differenceMinor: "1" }] },
    // Unknown qualification / payout status values are shape drift.
    { currencies: [{ ...balancedCurrency, calculations: [{ qualification: "pending", count: "1", netMinor: "1" }] }] },
    { currencies: [{ ...balancedCurrency, payouts: [{ status: "paid", count: "1", amountMinor: "1" }] }] },
    // Duplicate currency rows are shape drift.
    { currencies: [balancedCurrency, balancedCurrency] },
    // Malformed money / exponent values fail closed.
    { currencies: [{ ...balancedCurrency, heldMinor: "55.5" }] },
    { currencies: [{ ...balancedCurrency, exponent: 9 }] }])(
    "fails closed on malformed input %#", input => {
      expect(mapReconciliationOverview(input)).toBeNull();
    });
});

describe("admin reconciliation page", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires admin authorization before rendering", async () => {
    access.mockRejectedValue(new Error("unauthorized"));
    await expect(AdminReconciliation()).rejects.toThrow("unauthorized");
    expect(access).toHaveBeenCalledExactlyOnceWith("admin");
  });

  it("renders a reconciling currency with its buckets, calculations and payouts", async () => {
    access.mockResolvedValue({ client: { rpc: async () => ({ data: { currencies: [balancedCurrency] }, error: null }) } });
    const html = renderToStaticMarkup(await AdminReconciliation());
    expect(html).toContain("Ledger reconciliation");
    expect(html).toContain("USD — reconciles");
    expect(html).toContain("950.00 USD");
    expect(html).toContain("550.00 USD");
    expect(html).toContain("the ledger reconciles for this currency");
    expect(html).toContain("qualified");
    expect(html).toContain("settled");
    expect(html).not.toContain("MISMATCH");
  });

  it("flags a mismatched currency and warns against settling payouts", async () => {
    const mismatch = { ...balancedCurrency, heldMinor: "54000", destinationTotalMinor: "94000", differenceMinor: "1000" };
    access.mockResolvedValue({ client: { rpc: async () => ({ data: { currencies: [mismatch] }, error: null }) } });
    const html = renderToStaticMarkup(await AdminReconciliation());
    expect(html).toContain("MISMATCH");
    expect(html).toContain("does NOT reconcile");
  });

  it("renders the empty state when no currencies exist", async () => {
    access.mockResolvedValue({ client: { rpc: async () => ({ data: { currencies: [] }, error: null }) } });
    const html = renderToStaticMarkup(await AdminReconciliation());
    expect(html).toContain("nothing to reconcile");
  });

  it("fails closed when the RPC errors or drifts, never claiming balance", async () => {
    access.mockResolvedValue({ client: { rpc: async () => ({ data: null, error: { code: "42883" } }) } });
    const failed = renderToStaticMarkup(await AdminReconciliation());
    expect(failed).toContain("Reconciliation data could not be loaded");
    expect(failed).toContain("No balanced state should be assumed");
    expect(failed).not.toContain("reconciles");
    access.mockResolvedValue({ client: { rpc: async () => ({ data: { currencies: [{ currency: "USD" }] }, error: null }) } });
    const malformed = renderToStaticMarkup(await AdminReconciliation());
    expect(malformed).toContain("Reconciliation data could not be loaded");
  });
});
