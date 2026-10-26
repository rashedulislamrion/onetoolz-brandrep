import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/access", () => ({ requireAccess: access }));
vi.mock("@/components/submit-button", () => ({ SubmitButton: ({ children }: { children: string }) => children }));
vi.mock("@/app/dashboard/payouts/actions", () => ({ requestPayout: vi.fn(), cancelPayout: vi.fn() }));
vi.mock("@/app/admin/payouts/actions", () => ({ reviewPayout: vi.fn(), settlePayout: vi.fn(), failPayout: vi.fn() }));
import AffiliatePayouts from "../../src/app/dashboard/payouts/page";
import AdminPayouts from "../../src/app/admin/payouts/page";

const requestId = "20000000-0000-4000-8000-0000000000bb";
const adminId = "50000000-0000-4000-8000-0000000000ee";

const overview = {
  currencies: [{ currency: "USD", exponent: 2, payableMinor: "1000", reservedMinor: "250",
    minimumPayoutMinor: "2500", payoutCadence: "manual" }],
  requests: [{ id: requestId, requestKey: "10000000-0000-4000-8000-0000000000aa", currency: "USD",
    amountMinor: "2500", status: "requested", externalReference: null, failureReason: null,
    createdAt: "2026-10-26T00:00:00.000Z" }],
};

beforeEach(() => vi.resetAllMocks());

describe("affiliate payouts page", () => {
  it("requires affiliate authorization before rendering", async () => {
    access.mockRejectedValue(new Error("unauthorized"));
    await expect(AffiliatePayouts({ searchParams: Promise.resolve({}) })).rejects.toThrow("unauthorized");
    expect(access).toHaveBeenCalledExactlyOnceWith("affiliate");
  });
  it("renders balances, the request form and own history with honest manual-settlement copy", async () => {
    access.mockResolvedValue({ client: { rpc: async () => ({ data: overview, error: null }) } });
    const html = renderToStaticMarkup(await AffiliatePayouts({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Available for payout");
    expect(html).toContain("10.00 USD");
    expect(html).toContain("25.00 USD");
    expect(html).toContain("Settlement is manual");
    expect(html).toContain("never sends money automatically");
    expect(html).toContain("Your payout requests");
    expect(html).toContain("Cancel request");
    expect(html).not.toContain("$0");
  });
  it("fails closed to the unavailable notice when the RPC errors or drifts", async () => {
    access.mockResolvedValue({ client: { rpc: async () => ({ data: null, error: { code: "42883" } }) } });
    const failed = renderToStaticMarkup(await AffiliatePayouts({ searchParams: Promise.resolve({}) }));
    expect(failed).toContain("Payouts are not connected");
    expect(failed).not.toContain("Available for payout");
    access.mockResolvedValue({ client: { rpc: async () => ({ data: { currencies: [{ currency: "USD" }] }, error: null }) } });
    const malformed = renderToStaticMarkup(await AffiliatePayouts({ searchParams: Promise.resolve({}) }));
    expect(malformed).toContain("Payouts are not connected");
  });
});

describe("admin payouts page", () => {
  const queueRow = { id: requestId, request_key: "10000000-0000-4000-8000-0000000000aa",
    affiliate_id: "30000000-0000-4000-8000-0000000000cc", affiliate_user_id: "40000000-0000-4000-8000-0000000000dd",
    display_name: "Partner One", currency: "USD", amount_minor: "2500", status: "requested",
    external_reference: null, failure_reason: null, created_at: "2026-10-26T00:00:00.000Z" };

  it("requires admin authorization before rendering", async () => {
    access.mockRejectedValue(new Error("unauthorized"));
    await expect(AdminPayouts({ searchParams: Promise.resolve({}) })).rejects.toThrow("unauthorized");
    expect(access).toHaveBeenCalledExactlyOnceWith("admin");
  });
  it("renders the review form for requested payouts and settlement forms for approved ones", async () => {
    access.mockResolvedValue({ user: { id: adminId }, client: { rpc: async () => ({ data: [
      queueRow, { ...queueRow, id: "20000000-0000-4000-8000-0000000000bc", status: "approved" },
    ], error: null }) } });
    const html = renderToStaticMarkup(await AdminPayouts({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Partner One");
    expect(html).toContain("Record review");
    expect(html).toContain("Record settlement");
    expect(html).toContain("Record failure");
    expect(html).toContain("Settlement is manual");
    expect(html).toContain("never review, settle or fail your own payout request");
  });
  it("hides action forms for the administrator's own payout request", async () => {
    access.mockResolvedValue({ user: { id: queueRow.affiliate_user_id }, client: { rpc: async () => ({ data: [queueRow], error: null }) } });
    const html = renderToStaticMarkup(await AdminPayouts({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("You cannot review your own payout request.");
    expect(html).not.toContain("Record review");
  });
  it("fails closed when the queue RPC errors", async () => {
    access.mockResolvedValue({ user: { id: adminId }, client: { rpc: async () => ({ data: null, error: { code: "42501" } }) } });
    const html = renderToStaticMarkup(await AdminPayouts({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("The payout queue could not be loaded");
    expect(html).not.toContain("The payout queue is empty");
  });
});
