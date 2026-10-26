import type { Environment } from "../config";
import { databaseEnvironmentAllowed } from "../database-environment.mts";

// Fail-closed configuration for the commission posting worker. Mirrors the
// Woo ingestion and referral bridge gates: an explicit enable flag, no
// preview runtime, a database environment that must be allowed for this
// app environment, a server-only sb_secret_ key, and an exact approved
// database URL match. Anything missing or inconsistent disables posting.
export function postingConfiguration(env: Environment) {
  if (env.COMMISSION_POSTING_ENABLED !== "true" || env.VERCEL_ENV === "preview" ||
    !databaseEnvironmentAllowed(env)) return null;
  const key = env.COMMISSION_SUPABASE_SECRET_KEY ?? "";
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key.startsWith("sb_secret_") || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url ?? "") ||
    !url || env.COMMISSION_APPROVED_SUPABASE_URL !== url) return null;
  return { key, url };
}
