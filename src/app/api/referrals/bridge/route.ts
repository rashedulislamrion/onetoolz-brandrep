import { createClient } from "@supabase/supabase-js";
import { bridgeConfiguration, receiveReferralBridge } from "@/lib/referrals/bridge";
import { hashToken, isStoreLinkToken } from "@/lib/referrals/link-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = bridgeConfiguration(process.env);
  if (!config) return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(10000) }) },
  });
  return receiveReferralBridge(request, {
    secret: config.secret,
    buyerIdentity: async token => {
      // A brlink_ store-link token resolves through its stored hash. The
      // plaintext is a bearer credential the buyer pasted into the store;
      // resolution is service-role only and revoked links resolve to null.
      // The downstream association RPC still re-checks confirmed email.
      if (isStoreLinkToken(token)) {
        const tokenHash = hashToken(token);
        if (!tokenHash) return null;
        const { data, error } = await client.rpc("resolve_store_link", { p_token_hash: tokenHash });
        return error || typeof data !== "string" ? null : data;
      }
      const { data, error } = await client.auth.getUser(token);
      return error || !data.user?.email_confirmed_at ? null : data.user.id;
    },
    persist: async (event, receipt) => {
      const common = { p_request_id: receipt.requestId, p_body_hash: receipt.bodyHash, p_visitor_hash: event.visitorHash };
      const { error } = event.kind === "capture"
        ? await client.rpc("capture_referral_touch", { ...common, p_code: event.code, p_policy_version: event.policyVersion, p_consent: event.consent })
        : await client.rpc("associate_referral_order", { ...common, p_order_id: event.orderId, p_order_at: event.orderAt, p_buyer_user_id: event.buyerUserId });
      if (error) throw new Error("Referral persistence unavailable");
    },
  });
}