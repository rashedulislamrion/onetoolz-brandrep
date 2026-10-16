// Owner confirmed this project's production classification on October 16, 2026.
// Never allow environment labels to turn this known production target into a test DB.
export const PRODUCTION_DATABASE_URL = "https://nwgdzzpcbqmfqujycpqk.supabase.co";

export function databaseEnvironmentAllowed(env: Record<string, string | undefined>): boolean {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let productionTarget = url === PRODUCTION_DATABASE_URL;
  try { productionTarget = new URL(url).hostname === new URL(PRODUCTION_DATABASE_URL).hostname; } catch { return false; }
  if (env.VERCEL_ENV === "preview" && env.APP_ENV === "production") return false;
  if (env.APP_ENV === "production") return env.SUPABASE_ENVIRONMENT === "production";
  return ["local", "staging"].includes(env.APP_ENV ?? "") && env.SUPABASE_ENVIRONMENT === "nonproduction" &&
    !productionTarget;
}