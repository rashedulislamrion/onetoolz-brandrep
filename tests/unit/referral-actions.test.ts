import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAccess, requireMutationOrigin, rpc, redirect, revalidatePath } = vi.hoisted(() => ({
  requireAccess: vi.fn(), requireMutationOrigin: vi.fn(), rpc: vi.fn(), redirect: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth/access", () => ({ requireAccess }));
vi.mock("@/lib/auth/mutation", () => ({ requireMutationOrigin }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { createCampaign, setCampaignActive } from "@/app/dashboard/referrals/actions";

const code = "a".repeat(32);
const form = () => {
  const value = new FormData(); value.set("name", " Launch "); value.set("destination", "/shop/");
  value.set("requestId", "11111111-1111-4111-8111-111111111111"); return value;
};

describe("referral server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks(); requireMutationOrigin.mockResolvedValue(undefined);
    requireAccess.mockResolvedValue({ client: { rpc } }); rpc.mockResolvedValue({ error: null });
    redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });
  it("authorizes same-origin approved affiliates before RPC and revalidates", async () => {
    await expect(createCampaign(form())).rejects.toThrow("redirect:/dashboard/referrals?notice=saved");
    expect(requireMutationOrigin).toHaveBeenCalledOnce(); expect(requireAccess).toHaveBeenCalledWith("affiliate");
    expect(requireMutationOrigin.mock.invocationCallOrder[0]).toBeLessThan(requireAccess.mock.invocationCallOrder[0]);
    expect(requireAccess.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
    expect(rpc).toHaveBeenCalledWith("create_referral_campaign", { p_request_id: "11111111-1111-4111-8111-111111111111", p_name: "Launch", p_destination_path: "/shop/" });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/referrals");
  });
  it("does not mutate when origin or access checks fail", async () => {
    requireMutationOrigin.mockRejectedValueOnce(new Error("origin denied"));
    await expect(createCampaign(form())).rejects.toThrow("origin denied"); expect(requireAccess).not.toHaveBeenCalled();
    requireAccess.mockRejectedValueOnce(new Error("access denied"));
    await expect(createCampaign(form())).rejects.toThrow("access denied"); expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed create input without RPC", async () => {
    const value = form(); value.set("destination", "//evil.test");
    await expect(createCampaign(value)).rejects.toThrow("notice=invalid"); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["54000", "limit"], ["40001", "failed"], ["42501", "failed"]])("surfaces safe failure %s", async (code, notice) => {
    rpc.mockResolvedValue({ error: { code } });
    await expect(createCampaign(form())).rejects.toThrow(`notice=${notice}`); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each(["true", "false"])("toggles only the supplied own campaign to %s", async active => {
    const value = new FormData(); value.set("code", code); value.set("active", active);
    await expect(setCampaignActive(value)).rejects.toThrow("notice=updated");
    expect(rpc).toHaveBeenCalledWith("set_referral_campaign_active", { p_code: code, p_active: active === "true" });
    expect(requireAccess).toHaveBeenCalledWith("affiliate"); expect(requireMutationOrigin).toHaveBeenCalledOnce();
  });
  it("rejects forged status and hides storage errors", async () => {
    const value = new FormData(); value.set("code", code); value.set("active", "1");
    await expect(setCampaignActive(value)).rejects.toThrow("notice=invalid"); expect(rpc).not.toHaveBeenCalled();
    value.set("active", "false"); rpc.mockResolvedValue({ error: { message: "private" } });
    await expect(setCampaignActive(value)).rejects.toThrow("notice=failed"); expect(revalidatePath).not.toHaveBeenCalled();
  });
});