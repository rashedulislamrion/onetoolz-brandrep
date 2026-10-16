import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAuthConfiguration } from "@/lib/config";

export async function createAuthClient() {
  const config = getAuthConfiguration(process.env);
  if (!config.ready) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: config.origin.startsWith("https://"), path: "/" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        // Server Components cannot write cookies; the proxy refreshes their session.
        for (const { name, value, options } of values) {
          try { cookieStore.set(name, value, options); } catch { /* Read-only component context. */ }
        }
      },
    },
  });
}