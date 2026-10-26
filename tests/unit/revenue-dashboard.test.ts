import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/access", () => ({ requireAccess: access }));
import Dashboard from "../../src/app/dashboard/page";

beforeEach(() => vi.resetAllMocks());

describe("revenue workspace integration boundary", () => {
  it("requires affiliate authorization before rendering", async () => {
    access.mockRejectedValue(new Error("unauthorized"));
    await expect(Dashboard()).rejects.toThrow("unauthorized");
    expect(access).toHaveBeenCalledExactlyOnceWith("affiliate");
  });
  it("renders unavailable states instead of fake balances or payment records", async () => {
    access.mockResolvedValue({});
    const html = renderToStaticMarkup(await Dashboard());
    expect(html).toContain("Reporting is not connected");
    expect(html).toContain("not a zero balance");
    expect(html.match(/aria-label="Not connected"/g)).toHaveLength(8);
    expect(html).toContain("Referral tracking and order credit are not activated yet");
    expect(html).toContain('href="/dashboard/referrals"');
    expect(html).toContain("No payment records or available balances are shown");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("href=\"/r/");
  });

  it("shows recorded commission totals when the totals RPC is connected", async () => {
    access.mockResolvedValue({ client: { rpc: async () => ({ data: [
      { currency: "USD", qualification: "qualified", status: "recorded", calculation_count: "2", net_minor: "80" },
      { currency: "USD", qualification: "unqualified", status: "recorded", calculation_count: "1", net_minor: "50" },
    ], error: null }) } });
    const html = renderToStaticMarkup(await Dashboard());
    expect(html).toContain("Commission records connected");
    expect(html).toContain("RECORDED COMMISSION CALCULATIONS");
    expect(html).toContain("hold / available pipeline");
    expect(html).toContain("NOT earnings");
    expect(html).toContain("80 (2 calculations)");
    expect(html).toContain("50 (1 calculations)");
    // Balance metrics stay unavailable: recorded totals are not balances.
    expect(html.match(/aria-label="Not connected"/g)).toHaveLength(8);
  });

  it("shows ledger balances and wires only the payable card when the balances RPC is connected", async () => {
    access.mockResolvedValue({ client: { rpc: async (name: string) => name === "affiliate_ledger_balances"
      ? { data: [
          { currency: "USD", exponent: 2, bucket: "held", balance_minor: "57000" },
          { currency: "USD", exponent: 2, bucket: "payable", balance_minor: "30000" },
        ], error: null }
      : { data: [], error: null } } });
    const html = renderToStaticMarkup(await Dashboard());
    expect(html).toContain("LEDGER BALANCES");
    expect(html).toContain("570.00 USD (57000 minor units)");
    expect(html).toContain("300.00 USD (30000 minor units)");
    expect(html).toContain("Available payout balance");
    expect(html).toContain("<strong>300.00 USD</strong>");
    // Only the payable card is honestly wired; the other seven stay unavailable.
    expect(html.match(/aria-label="Not connected"/g)).toHaveLength(7);
  });

  it("keeps placeholders when the totals RPC fails or returns malformed rows", async () => {
    access.mockResolvedValue({ client: { rpc: async () => ({ data: null, error: { code: "42883" } }) } });
    const failed = renderToStaticMarkup(await Dashboard());
    expect(failed).toContain("Reporting is not connected");
    expect(failed).not.toContain("RECORDED COMMISSION CALCULATIONS");
    access.mockResolvedValue({ client: { rpc: async () => ({ data: [{ currency: "USD" }], error: null }) } });
    const malformed = renderToStaticMarkup(await Dashboard());
    expect(malformed).toContain("Reporting is not connected");
    expect(malformed).not.toContain("RECORDED COMMISSION CALCULATIONS");
  });
});