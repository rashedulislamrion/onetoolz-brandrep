import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getAuthConfiguration } from "@/lib/config";
import { storeDestination, validReferralCode } from "@/lib/referrals/campaigns";

export const dynamic = "force-dynamic";

function unavailable(status: number) {
  return new Response("Referral link unavailable.", { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!validReferralCode(code)) return unavailable(404);
  const config = getAuthConfiguration(process.env);
  if (!config.ready) return unavailable(503);
  try {
    // Public publishable key only. Lookup is intentionally independent of the
    // visitor session and never needs a service-role credential.
    const client = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) }) },
    });
    const { data, error } = await client.rpc("resolve_referral_campaign", { p_code: code });
    if (error) return unavailable(503);
    const destination = typeof data === "string" ? storeDestination(data) : null;
    if (!destination) return unavailable(404);
    const response = NextResponse.redirect(destination, 302);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    // Deliberately no cookies, tracking query parameters or click writes until
    // policy approval and an authenticated Woo checkout bridge exist.
    return response;
  } catch { return unavailable(503); }
}