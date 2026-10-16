export function liveAuthConfiguration(env: Record<string, string | undefined>) {
  const ref = "nwgdzzpcbqmfqujycpqk";
  if (env.RUN_LIVE_AUTH_TESTS !== "true" || env.E2E_SUPABASE_PROJECT_REF !== ref || env.APP_ENV !== "local" || env.SUPABASE_ENVIRONMENT !== "nonproduction") {
    throw new Error("Live Auth tests require explicit opt-in and the approved local/nonproduction project.");
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`) throw new Error("Live Auth project URL mismatch.");
  const key = env.E2E_SUPABASE_SECRET_KEY;
  if (!key?.startsWith("sb_secret_")) throw new Error("Missing test-only E2E_SUPABASE_SECRET_KEY. Never use a NEXT_PUBLIC variable.");
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, key };
}