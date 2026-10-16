import { describe, expect, it } from "vitest";
import { liveAuthConfiguration } from "../support/live-auth-config";
import { totp } from "../support/totp";

describe("live Auth test isolation", () => {
  const environment = { RUN_LIVE_AUTH_TESTS: "true", E2E_SUPABASE_PROJECT_REF: "nwgdzzpcbqmfqujycpqk", APP_ENV: "local", SUPABASE_ENVIRONMENT: "nonproduction", NEXT_PUBLIC_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co", E2E_SUPABASE_SECRET_KEY: "sb_secret_test_fixture_only" };
  it("accepts the explicitly approved project", () => expect(liveAuthConfiguration(environment).url).toBe(environment.NEXT_PUBLIC_SUPABASE_URL));
  it.each(Object.keys(environment))("rejects missing %s", key => {
    expect(() => liveAuthConfiguration({ ...environment, [key]: undefined })).toThrow();
  });
  it("rejects production and mismatched project URLs", () => {
    expect(() => liveAuthConfiguration({ ...environment, APP_ENV: "production" })).toThrow();
    expect(() => liveAuthConfiguration({ ...environment, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" })).toThrow();
  });
});
describe("test-only TOTP generator", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it.each([[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]])("matches RFC 6238 SHA-1 vector at %s seconds (six digits)", (seconds, expected) => {
    expect(totp(secret, Number(seconds) * 1000)).toBe(expected);
  });
  it("rejects malformed keys and time", () => {
    expect(() => totp("not-a-key")).toThrow();
    expect(() => totp(secret, -1)).toThrow();
  });
});