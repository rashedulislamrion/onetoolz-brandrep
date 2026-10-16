import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/supabase/server";
import { getAuthConfiguration } from "@/lib/config";
import { safeReturnPath } from "@/lib/auth/policy";

export async function GET(request: NextRequest) {
  const config = getAuthConfiguration(process.env);
  if (!config.ready) return new NextResponse("Authentication is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const code = request.nextUrl.searchParams.get("code");
  const client = await createAuthClient();
  if (client && code && code.length < 2048) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeReturnPath(request.nextUrl.searchParams.get("next")), config.origin));
  }
  return NextResponse.redirect(new URL("/login?notice=callback", config.origin));
}