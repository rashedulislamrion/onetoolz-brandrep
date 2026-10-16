import { databaseEnvironmentAllowed } from "./database-environment.mts";

export type Environment = Record<string, string | undefined>;
export type AuthConfiguration =
  | { ready: false; reason: string }
  | { ready: true; url: string; key: string; origin: string };

export function getAuthConfiguration(env: Environment): AuthConfiguration {
  if (env.AUTH_ENABLED !== "true") return { ready: false, reason: "Account access is not enabled yet." };
  if (!['local', 'staging', 'production'].includes(env.APP_ENV ?? '')) {
    return { ready: false, reason: "Application environment is not configured." };
  }
  if (env.APP_ENV !== "production" && env.SUPABASE_ENVIRONMENT !== "nonproduction") {
    return { ready: false, reason: "A dedicated nonproduction authentication project is required." };
  }
  if (env.APP_ENV === "production" && env.SUPABASE_ENVIRONMENT !== "production") {
    return { ready: false, reason: "Production authentication requires explicit configuration." };
  }
  if (env.VERCEL_ENV === "preview" && env.APP_ENV === "production") {
    return { ready: false, reason: "Production authentication is prohibited in preview deployments." };
  }
  if (!databaseEnvironmentAllowed(env)) return { ready: false, reason: "This production database cannot be used in local, staging or preview environments." };
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!key.startsWith("sb_publishable_")) {
    return { ready: false, reason: "A Supabase publishable key is required. Secret keys are not accepted." };
  }
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const origin = new URL(env.APP_ORIGIN ?? "");
    const local = env.APP_ENV === "local";
    const safeProtocol = (value: URL) => value.protocol === "https:" ||
      (local && value.protocol === "http:" && ["localhost", "127.0.0.1"].includes(value.hostname));
    if (!safeProtocol(url) || !safeProtocol(origin) || url.username || url.password || origin.username || origin.password ||
      url.search || url.hash || origin.search || origin.hash || url.pathname !== "/" || origin.pathname !== "/") {
      return { ready: false, reason: "Authentication URLs are not valid secure origins." };
    }
    return { ready: true, url: url.origin, key, origin: origin.origin };
  } catch {
    return { ready: false, reason: "Authentication URLs are not configured." };
  }
}