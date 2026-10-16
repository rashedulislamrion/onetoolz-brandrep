import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, getUser, createClient } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
import { createHmac } from "node:crypto";
import { POST } from "@/app/api/referrals/bridge/route";
import { REFERRAL_POLICY } from "@/lib/referrals/policy";

const secret = "synthetic-bridge-route-secret-not-a-real-credential";
const buyerId = "11111111-1111-4111-8111-111111111111";
const capture = { kind: "capture", visitorHash: "b".repeat(64), code: "a".repeat(32), consent: true, policyVersion: REFERRAL_POLICY.version };
function request(value = capture as Record<string, unknown>) {
  const timestamp = String(Math.floor(Date.now() / 1000)); const body = JSON.stringify(value);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${buyerId}.${body}`).digest("hex");
  return new Request("https://brandrep.onetoolz.com/api/referrals/bridge", { method: "POST", body,
    headers: { "content-type": "application/json", "x-brandrep-timestamp": timestamp, "x-brandrep-request-id": buyerId,
      "x-brandrep-signature": signature, authorization: "Bearer synthetic-buyer-session" } });
}
describe("referral bridge route storage wiring", () => {
  beforeEach(() => {
    vi.stubEnv("REFERRAL_BRIDGE_ENABLED", "true"); vi.stubEnv("APP_ENV", "production"); vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SUPABASE_ENVIRONMENT", "production"); vi.stubEnv("REFERRAL_BRIDGE_SECRET", secret);
    vi.stubEnv("REFERRAL_SUPABASE_SECRET_KEY", "sb_secret_fixture"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("REFERRAL_APPROVED_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    createClient.mockReturnValue({ rpc, auth: { getUser } }); rpc.mockResolvedValue({ error: null });
    getUser.mockResolvedValue({ data: { user: { id: buyerId, email_confirmed_at: "2026-10-16" } }, error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("does not call storage when disabled", async () => {
    vi.stubEnv("REFERRAL_BRIDGE_ENABLED", "false"); expect((await POST(request())).status).toBe(503); expect(createClient).not.toHaveBeenCalled();
  });
  it("persists capture through the privileged RPC without returning data", async () => {
    expect((await POST(request())).status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("capture_referral_touch", expect.objectContaining({ p_request_id: buyerId, p_visitor_hash: capture.visitorHash, p_code: capture.code, p_consent: true, p_policy_version: REFERRAL_POLICY.version }));
    expect(getUser).not.toHaveBeenCalled();
  });
  it("verifies buyer session before order association and fails closed for unverified email", async () => {
    const order = { kind: "order", visitorHash: capture.visitorHash, orderId: "12", orderAt: new Date(Date.now() - 1000).toISOString(), buyerUserId: buyerId };
    expect((await POST(request(order))).status).toBe(202); expect(getUser).toHaveBeenCalledWith("synthetic-buyer-session");
    expect(rpc).toHaveBeenCalledWith("associate_referral_order", expect.objectContaining({ p_order_id: "12", p_buyer_user_id: buyerId, p_order_at: order.orderAt }));
    rpc.mockClear(); getUser.mockResolvedValue({ data: { user: { id: buyerId, email_confirmed_at: null } }, error: null });
    expect((await POST(request(order))).status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it("redacts database failure", async () => {
    rpc.mockResolvedValue({ error: { message: "private" } }); const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.text()).toBe("");
  });
});