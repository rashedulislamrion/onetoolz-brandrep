import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  origin: vi.fn(), access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/access", () => ({ requireAccess: mocks.access }));
vi.mock("@/lib/auth/mutation", () => ({ requireMutationOrigin: mocks.origin }));
import { cancelPayout, requestPayout } from "../../src/app/dashboard/payouts/actions";
import { failPayout, reviewPayout, settlePayout } from "../../src/app/admin/payouts/actions";

const key = "10000000-0000-4000-8000-0000000000aa";
const requestId = "20000000-0000-4000-8000-0000000000bb";
const client = { rpc: mocks.rpc };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

const overview = {
  currencies: [{ currency: "USD", exponent: 2, payableMinor: "100000", reservedMinor: "0",
    minimumPayoutMinor: "2500", payoutCadence: "manual" }],
  requests: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ client });
  mocks.rpc.mockResolvedValue({ data: overview, error: null });
});

describe("affiliate payout actions", () => {
  it("checks origin before access and never reaches the RPC on origin failure", async () => {
    mocks.origin.mockRejectedValue(new Error("invalid origin"));
    await expect(requestPayout(form({ requestKey: key, currency: "USD", amount: "25" }))).rejects.toThrow("invalid origin");
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("converts with the overview exponent and calls request_payout with exact args", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: overview, error: null }).mockResolvedValueOnce({ error: null });
    await expect(requestPayout(form({ requestKey: key, currency: "USD", amount: "25.5" })))
      .rejects.toThrow("REDIRECT:/dashboard/payouts?notice=requested");
    expect(mocks.access).toHaveBeenCalledWith("affiliate");
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "affiliate_payout_overview");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "request_payout", {
      p_request_key: key, p_currency: "USD", p_amount_minor: "2550",
    });
  });
  it("never calls request_payout for invalid input", async () => {
    await expect(requestPayout(form({ requestKey: key, currency: "USD", amount: "0" })))
      .rejects.toThrow("REDIRECT:/dashboard/payouts?notice=invalid");
    expect(mocks.rpc).not.toHaveBeenCalledWith("request_payout", expect.anything());
    await expect(requestPayout(form({ requestKey: "bad", currency: "USD", amount: "25" })))
      .rejects.toThrow("REDIRECT:/dashboard/payouts?notice=invalid");
  });
  it("fails closed when the overview is unavailable or lacks the currency", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    await expect(requestPayout(form({ requestKey: key, currency: "USD", amount: "25" })))
      .rejects.toThrow("REDIRECT:/dashboard/payouts?notice=failed");
    expect(mocks.rpc).not.toHaveBeenCalledWith("request_payout", expect.anything());
  });
  it("redirects to failed when the request RPC errors", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: overview, error: null }).mockResolvedValueOnce({ error: { code: "22023" } });
    await expect(requestPayout(form({ requestKey: key, currency: "USD", amount: "25" })))
      .rejects.toThrow("REDIRECT:/dashboard/payouts?notice=failed");
  });
  it("cancels with exact args and requires confirmation", async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    await expect(cancelPayout(form({ requestId, confirmed: "yes" })))
      .rejects.toThrow("REDIRECT:/dashboard/payouts?notice=cancelled");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("cancel_payout", { p_request_id: requestId });
    await expect(cancelPayout(form({ requestId })))
      .rejects.toThrow("REDIRECT:/dashboard/payouts?notice=invalid");
  });
});

describe("admin payout actions", () => {
  it("reviews with exact args through admin access", async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    await expect(reviewPayout(form({ requestId, decision: "approve", reason: "Documents match", confirmed: "yes" })))
      .rejects.toThrow("REDIRECT:/admin/payouts?notice=reviewed");
    expect(mocks.access).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("review_payout", {
      p_request_id: requestId, p_decision: "approve", p_reason: "Documents match",
    });
  });
  it("never reaches the review RPC for invalid input", async () => {
    await expect(reviewPayout(form({ requestId, decision: "approved", reason: "Documents match", confirmed: "yes" })))
      .rejects.toThrow("REDIRECT:/admin/payouts?notice=invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("settles with the trimmed external reference", async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    await expect(settlePayout(form({ requestId, externalReference: " BKASH-99887 ", confirmed: "yes" })))
      .rejects.toThrow("REDIRECT:/admin/payouts?notice=settled");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("settle_payout", {
      p_request_id: requestId, p_external_reference: "BKASH-99887",
    });
  });
  it("rejects a short settlement reference before any RPC", async () => {
    await expect(settlePayout(form({ requestId, externalReference: "abc", confirmed: "yes" })))
      .rejects.toThrow("REDIRECT:/admin/payouts?notice=invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("records failure with exact args", async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    await expect(failPayout(form({ requestId, reason: "Bank rejected the transfer", confirmed: "yes" })))
      .rejects.toThrow("REDIRECT:/admin/payouts?notice=failed-recorded");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("fail_payout", {
      p_request_id: requestId, p_reason: "Bank rejected the transfer",
    });
  });
  it("redirects to failed on RPC errors without leaking details", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "private" } });
    await expect(reviewPayout(form({ requestId, decision: "reject", reason: "Documents mismatch", confirmed: "yes" })))
      .rejects.toThrow("REDIRECT:/admin/payouts?notice=failed");
  });
});
