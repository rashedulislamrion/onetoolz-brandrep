import type { Environment } from "../config";
import { databaseEnvironmentAllowed } from "../database-environment.mts";

export function ingestionConfiguration(env: Environment) {
  if (env.WOO_INGESTION_ENABLED !== "true" || !databaseEnvironmentAllowed(env) || env.VERCEL_ENV === "preview" ||
    env.WOO_STORE_VERIFIED !== "true" ||
    env.WOO_PRODUCTION_STORE_ACCESS_APPROVED !== "true") return null;
  const origin = "https://cu.onetoolz.com";
  const secret = env.WOO_WEBHOOK_SECRET ?? "";
  const key = env.WOO_INGESTION_SUPABASE_SECRET_KEY ?? "";
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (env.WOO_STORE_ORIGIN !== origin || secret.length < 32 || secret.length > 256 || secret.trim() !== secret ||
    !key.startsWith("sb_secret_") || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url ?? "") ||
    !url || env.WOO_APPROVED_SUPABASE_URL !== url) return null;
  return { origin, secret, key, url };
}