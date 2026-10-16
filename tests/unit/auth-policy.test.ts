import { describe, expect, it } from "vitest";
import { isSameOrigin, mayAccessAdmin, mayAccessAffiliate, safeReturnPath, validateCredentials } from "../../src/lib/auth/policy";

describe("server authorization policy", () => {
  it("requires both a protected role and approved status", () => {
    expect(mayAccessAffiliate({ roles: ["affiliate"], affiliateStatus: "approved", aal: null })).toBe(true);
    for (const status of [null, "pending", "suspended", "rejected"]) expect(mayAccessAffiliate({ roles: ["affiliate"], affiliateStatus: status, aal: null })).toBe(false);
    expect(mayAccessAffiliate({ roles: [], affiliateStatus: "approved", aal: null })).toBe(false);
  });
  it("requires admin role AND MFA, not an affiliate role", () => {
    expect(mayAccessAdmin({ roles: ["admin"], affiliateStatus: null, aal: "aal2" })).toBe(true);
    expect(mayAccessAdmin({ roles: ["admin"], affiliateStatus: null, aal: "aal1" })).toBe(false);
    expect(mayAccessAdmin({ roles: ["affiliate"], affiliateStatus: "approved", aal: "aal2" })).toBe(false);
    expect(mayAccessAdmin({ roles: [], affiliateStatus: null, aal: "aal2" })).toBe(false);
  });
  it.each([null, "null", "https://evil.example", "https://app.example.evil.example", "https://app.example/path"])("rejects noncanonical origin %s", (origin) => {
    expect(isSameOrigin(origin, "https://app.example")).toBe(false);
  });
  it("accepts exact origin", () => expect(isSameOrigin("https://app.example", "https://app.example")).toBe(true));
  it.each([null, "https://evil.example", "//evil.example", "/admin", "/\\evil.example", "/reset-password?next=evil"])("rejects unapproved return target %s", (value) => {
    expect(safeReturnPath(value)).toBe("/application/status");
  });
  it("allows the password recovery destination", () => expect(safeReturnPath("/reset-password")).toBe("/reset-password"));
  it("validates and normalizes credentials without modifying passwords", () => {
    const form = new FormData(); form.set("email", " User@Example.com "); form.set("password", "my long passphrase");
    expect(validateCredentials(form)).toEqual({ email: "user@example.com", password: "my long passphrase" });
    form.set("password", "short"); expect(validateCredentials(form)).toBeNull();
    form.set("password", "a".repeat(129)); expect(validateCredentials(form)).toBeNull();
    form.set("password", "my long passphrase"); form.set("email", "bad"); expect(validateCredentials(form)).toBeNull();
  });
});