import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, createClient } = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
import { GET } from "@/app/r/[code]/route";

const code = "a".repeat(32);
const request = (value = code) => GET(new Request(`https://brandrep.onetoolz.com/r/${value}?redirect=https://evil.test`), { params: Promise.resolve({ code: value }) });

describe("public referral routing", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_ENABLED", "true"); vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SUPABASE_ENVIRONMENT", "production"); vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://brandrep.onetoolz.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture");
    createClient.mockReturnValue({ rpc }); rpc.mockResolvedValue({ data: "/shop/", error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("uses only the fixed store path; ignores redirect query and sets no cookies", async () => {
    const response = await request();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://cu.onetoolz.com/shop/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(rpc).toHaveBeenCalledWith("resolve_referral_campaign", { p_code: code });
    expect(createClient.mock.calls[0][1]).toBe("sb_publishable_fixture");
  });
  it("rejects malformed codes before touching storage", async () => {
    expect((await request("invalid")).status).toBe(404); expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed when auth configuration is disabled or preview-isolated", async () => {
    vi.stubEnv("AUTH_ENABLED", "false"); expect((await request()).status).toBe(503);
    vi.stubEnv("AUTH_ENABLED", "true"); vi.stubEnv("VERCEL_ENV", "preview"); expect((await request()).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([null, "//evil.test", "/?redirect=x", "https://evil.test"])("rejects absent or unsafe stored path %s", async data => {
    rpc.mockResolvedValue({ data, error: null }); expect((await request()).status).toBe(404);
  });
  it("returns a redacted unavailable response on database failure", async () => {
    rpc.mockResolvedValue({ error: { message: "private details" } });
    let response = await request(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private");
    rpc.mockRejectedValue(new Error("credential details")); response = await request();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("credential");
  });
});