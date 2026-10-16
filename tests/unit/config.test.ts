import { describe, expect, it } from "vitest";
import { getAuthConfiguration } from "../../src/lib/config";

const valid = { AUTH_ENABLED: "true", APP_ENV: "local", APP_ORIGIN: "http://localhost:3000", SUPABASE_ENVIRONMENT: "nonproduction", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only" };
describe("environment isolation", () => {
  it("disables unconfigured authentication", () => expect(getAuthConfiguration({}).ready).toBe(false));
  it("accepts explicitly isolated local configuration", () => expect(getAuthConfiguration(valid).ready).toBe(true));
  it("rejects production project use locally", () => expect(getAuthConfiguration({ ...valid, SUPABASE_ENVIRONMENT: "production" }).ready).toBe(false));
  it("rejects production credentials in previews", () => expect(getAuthConfiguration({ ...valid, APP_ENV: "production", SUPABASE_ENVIRONMENT: "production", VERCEL_ENV: "preview", APP_ORIGIN: "https://app.example" }).ready).toBe(false));
  it.each(["sb_secret_not_a_real_key", "service-role-key", ""])("rejects nonpublishable key %s", (key) => expect(getAuthConfiguration({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }).ready).toBe(false));
  it.each(["https://user:password@app.example", "http://public.example", "https://app.example/path", "javascript:alert(1)", "https://app.example?query=1"])("rejects unsafe origin %s", (origin) => expect(getAuthConfiguration({ ...valid, APP_ORIGIN: origin }).ready).toBe(false));
});