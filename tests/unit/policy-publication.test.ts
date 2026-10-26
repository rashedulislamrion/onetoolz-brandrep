import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePolicyPublication } from "@/lib/admin/policy-publication";

const mocks = vi.hoisted(() => ({ origin: vi.fn(), access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/access", () => ({ requireAccess: mocks.access }));
vi.mock("@/lib/auth/mutation", () => ({ requireMutationOrigin: mocks.origin }));
import { publishProgramPolicy } from "@/app/admin/settings/actions";

function valid() {
  const form = new FormData();
  Object.entries({ requestId: "10000000-0000-4000-8000-000000000001", draftRevision: "3", expectedVersion: "1",
    currencyDecimals: "2", basis: "net_items", refundRule: "proportional", rounding: "half_up", qualification: "paid_completed",
    reason: "Approved by administrator", publishConfirmed: "yes" })
    .forEach(([key, value]) => form.set(key, value));
  return form;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue({ client: { rpc: mocks.rpc } }); mocks.rpc.mockResolvedValue({ error: null });
});
describe("admin policy publication", () => {
  it("parses explicit choices without financial defaults", () => {
    expect(parsePolicyPublication(valid())).toEqual({ requestId: "10000000-0000-4000-8000-000000000001", draftRevision: 3,
      expectedVersion: 1, currencyDecimals: 2, basis: "net_items", refundRule: "proportional", rounding: "half_up",
      qualification: "paid_completed", reason: "Approved by administrator" });
    expect(parsePolicyPublication(new FormData())).toBeNull();
  });
  it.each([["draftRevision", "0"], ["draftRevision", "1e2"], ["expectedVersion", "-1"], ["expectedVersion", "01"],
    ["currencyDecimals", "7"], ["currencyDecimals", "2.5"], ["basis", "unknown"], ["refundRule", "none"],
    ["rounding", "bankers"], ["qualification", "completed_only"],
    ["requestId", "---------0000-4000-8000-000000000001"], ["reason", "short"], ["publishConfirmed", "no"]])("rejects %s=%s", (key, value) => {
    const form = valid(); form.set(key, value); expect(parsePolicyPublication(form)).toBeNull();
  });
  it("supports both implemented admin-selected basis/refund choices and precision bounds", () => {
    const form = valid(); form.set("basis", "order_total"); form.set("refundRule", "full_on_any_refund"); form.set("currencyDecimals", "0");
    expect(parsePolicyPublication(form)).toMatchObject({ basis: "order_total", refundRule: "full_on_any_refund", currencyDecimals: 0 });
    form.set("currencyDecimals", "6"); expect(parsePolicyPublication(form)).not.toBeNull();
  });
  it("checks origin before administrator authorization", async () => {
    mocks.origin.mockRejectedValue(new Error("origin denied"));
    await expect(publishProgramPolicy(valid())).rejects.toThrow("origin denied"); expect(mocks.access).not.toHaveBeenCalled();
  });
  it("denies unauthorized publication before RPC", async () => {
    mocks.access.mockRejectedValue(new Error("access denied"));
    await expect(publishProgramPolicy(valid())).rejects.toThrow("access denied"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not call RPC for invalid confirmation", async () => {
    const form = valid(); form.delete("publishConfirmed");
    await expect(publishProgramPolicy(form)).rejects.toThrow("notice=publicationInvalid"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not call RPC for an invalid rounding mode", async () => {
    const form = valid(); form.set("rounding", "bankers");
    await expect(publishProgramPolicy(form)).rejects.toThrow("notice=publicationInvalid"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not call RPC when qualification is missing", async () => {
    const form = valid(); form.delete("qualification");
    await expect(publishProgramPolicy(form)).rejects.toThrow("notice=publicationInvalid"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("publishes only through MFA admin access and validated RPC arguments", async () => {
    await expect(publishProgramPolicy(valid())).rejects.toThrow("notice=published"); expect(mocks.access).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("publish_program_policy", {
      p_request_id: "10000000-0000-4000-8000-000000000001", p_draft_revision: 3, p_expected_version: 1,
      p_currency_decimals: 2, p_basis: "net_items", p_refund_rule: "proportional",
      p_rounding: "half_up", p_qualification: "paid_completed", p_reason: "Approved by administrator",
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/settings");
  });
  it.each([["40001", "conflict"], ["42501", "publicationFailed"], ["23514", "publicationFailed"]])("handles storage code %s without leaking details", async (code, notice) => {
    mocks.rpc.mockResolvedValue({ error: { code, message: "private" } });
    await expect(publishProgramPolicy(valid())).rejects.toThrow(`notice=${notice}`); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});