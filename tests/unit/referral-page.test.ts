import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { access, from, select, order, limit } = vi.hoisted(() => ({
  access: vi.fn(), from: vi.fn(), select: vi.fn(), order: vi.fn(), limit: vi.fn(),
}));
vi.mock("@/lib/auth/access", () => ({ requireAccess: access }));
vi.mock("@/components/submit-button", () => ({ SubmitButton: ({ children }: { children: string }) => children }));
vi.mock("@/app/dashboard/referrals/actions", () => ({ createCampaign: vi.fn(), setCampaignActive: vi.fn() }));
import Referrals from "@/app/dashboard/referrals/page";

describe("referral workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks(); access.mockResolvedValue({ client: { from } }); from.mockReturnValue({ select });
    select.mockReturnValue({ order }); order.mockReturnValue({ limit }); limit.mockResolvedValue({ data: [], error: null });
    vi.stubEnv("AUTH_ENABLED", "true"); vi.stubEnv("APP_ENV", "production"); vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_ENVIRONMENT", "production"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture"); vi.stubEnv("APP_ORIGIN", "https://brandrep.onetoolz.com");
  });
  afterEach(() => vi.unstubAllEnvs());
  const render = async (notice?: string) => renderToStaticMarkup(await Referrals({ searchParams: Promise.resolve({ notice }) }));
  it("denies access before reading campaigns", async () => {
    access.mockRejectedValueOnce(new Error("denied")); await expect(render()).rejects.toThrow("denied");
    expect(from).not.toHaveBeenCalled(); expect(access).toHaveBeenCalledWith("affiliate");
  });
  it("renders a truthful empty state and creation form", async () => {
    const html = await render(); expect(html).toContain("No campaigns created"); expect(html).toContain("Create a campaign");
    expect(html).toContain("No referral cookies, click counts, order credit or commissions are recorded yet");
    expect(from).toHaveBeenCalledWith("referral_campaigns"); expect(limit).toHaveBeenCalledWith(50);
  });
  it("does not offer saving when schema/storage is unavailable", async () => {
    limit.mockResolvedValueOnce({ data: null, error: { message: "private" } });
    const html = await render(); expect(html).toContain("Creation is disabled"); expect(html).not.toContain("Create a campaign"); expect(html).not.toContain("private");
  });
  it("escapes names and renders stored links, paths and pause/resume controls", async () => {
    limit.mockResolvedValueOnce({ data: [
      { id: "one", code: "a".repeat(32), name: "<script>test</script>", destination_path: "/shop/", active: true },
      { id: "two", code: "b".repeat(32), name: "Paused launch", destination_path: "/", active: false },
    ], error: null });
    const html = await render("saved");
    expect(html).toContain(`https://brandrep.onetoolz.com/r/${"a".repeat(32)}`);
    expect(html).toContain("&lt;script&gt;test&lt;/script&gt;"); expect(html).not.toContain("<script>test</script>");
    expect(html).toContain("Pause"); expect(html).toContain("Resume"); expect(html).toContain("does not yet track orders or earn commissions");
  });
});