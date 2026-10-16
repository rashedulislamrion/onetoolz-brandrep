import type { Environment } from "../config";

export function ingestionConfiguration(env: Environment) {
  if (env.WOO_INGESTION_ENABLED !== "true" || !["local", "staging"].includes(env.APP_ENV ?? "") ||
    env.SUPABASE_ENVIRONMENT !== "nonproduction" || env.WOO_STORE_VERIFIED !== "true" ||
    env.WOO_PRODUCTION_STORE_ACCESS_APPROVED !== "true") return null;
  const origin = "https://cu.onetoolz.com";
  const secret = env.WOO_WEBHOOK_SECRET ?? "";
  const key = env.WOO_INGESTION_SUPABASE_SECRET_KEY ?? "";
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (env.WOO_STORE_ORIGIN !== origin || secret.length < 32 || !key.startsWith("sb_secret_") ||
    url !== "https://nwgdzzpcbqmfqujycpqk.supabase.co") return null;
  return { origin, secret, key, url };
}