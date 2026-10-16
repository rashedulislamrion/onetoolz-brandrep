import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProgramSettings, percentageFromBasisPoints } from "../../src/lib/admin/program-settings";

const mocks = vi.hoisted(() => ({ origin: vi.fn(), access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/access", () => ({ requireAccess: mocks.access }));
vi.mock("@/lib/auth/mutation", () => ({ requireMutationOrigin: mocks.origin }));
import { saveProgramSettings } from "../../src/app/admin/settings/actions";

function valid() {
  const form = new FormData();
  Object.entries({ commissionPercent: "12.35", currency: "USD", minimumPayout: "25.500000", holdDays: "30",
    payoutCadence: "monthly", reason: "Proposed program policy", revision: "0",
    requestId: "10000000-0000-4000-8000-000000000001", confirmed: "yes" }).forEach(([key, value]) => form.set(key, value));
  return form;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue({ client: { rpc: mocks.rpc } }); mocks.rpc.mockResolvedValue({ error: null });
});
describe("program draft validation", () => {
  it("uses exact basis points and canonical decimal strings", () => {
    expect(parseProgramSettings(valid())).toMatchObject({ basisPoints: 1235, minimumPayout: "25.5", revision: 0 });
    expect(percentageFromBasisPoints(1235)).toBe("12.35");
  });
  it.each([["commissionPercent", "100.01"], ["commissionPercent", "1e1"], ["commissionPercent", "0.001"],
    ["commissionPercent", "-1"], ["currency", "usd"], ["minimumPayout", "NaN"], ["minimumPayout", "1e5"],
    ["minimumPayout", "0.0000001"], ["holdDays", "366"], ["holdDays", "1.5"], ["payoutCadence", "automatic"],
    ["reason", "short"], ["revision", "-1"], ["requestId", "bad"], ["confirmed", "no"]])("rejects %s=%s", (field, value) => {
    const form = valid(); form.set(field, value); expect(parseProgramSettings(form)).toBeNull();
  });
  it.each(["0", "100", "0.01", "99.99"])("accepts percentage boundary %s", value => {
    const form = valid(); form.set("commissionPercent", value); expect(parseProgramSettings(form)).not.toBeNull();
  });
  it("rejects missing fields", () => { expect(parseProgramSettings(new FormData())).toBeNull(); });
});
describe("program draft action", () => {
  it("checks origin before authorization", async () => {
    mocks.origin.mockRejectedValue(new Error("origin"));
    await expect(saveProgramSettings(valid())).rejects.toThrow("origin"); expect(mocks.access).not.toHaveBeenCalled();
  });
  it("denies unauthorized writes", async () => {
    mocks.access.mockRejectedValue(new Error("denied"));
    await expect(saveProgramSettings(valid())).rejects.toThrow("denied"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not call storage for invalid input", async () => {
    await expect(saveProgramSettings(new FormData())).rejects.toThrow("notice=invalid"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("saves validated draft only", async () => {
    await expect(saveProgramSettings(valid())).rejects.toThrow("notice=saved");
    expect(mocks.access).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_program_settings_draft", {
      p_request_id: "10000000-0000-4000-8000-000000000001", p_expected_revision: 0,
      p_commission_bps: 1235, p_currency: "USD", p_minimum_payout: "25.5", p_hold_days: 30,
      p_payout_cadence: "monthly", p_reason: "Proposed program policy",
    });
  });
  it.each([["40001", "conflict"], ["42501", "failed"]])("handles database code %s", async (code, notice) => {
    mocks.rpc.mockResolvedValue({ error: { code, message: "private" } });
    await expect(saveProgramSettings(valid())).rejects.toThrow(`notice=${notice}`); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});