import { describe, expect, it } from "vitest";
import { parseReview, reviewPage, validFactorCode } from "../../src/lib/admin/validation";
const id = "10000000-0000-4000-8000-000000000001";
describe("administrative inputs", () => {
  it("accepts only six-digit authenticator codes and UUID factors", () => {
    expect(validFactorCode(id, "012345")).toBe(true);
    for (const code of ["12345", "1234567", "abcdef", "123 45", null]) expect(validFactorCode(id, code)).toBe(false);
    expect(validFactorCode("other", "123456")).toBe(false);
  });
  it("requires an explicit reason, decision and confirmation", () => {
    const form = new FormData(); form.set("applicationId", id); form.set("decision", "approved"); form.set("reason", "Reviewed application");
    expect(parseReview(form)).toBeNull(); form.set("confirmed", "yes"); expect(parseReview(form)?.decision).toBe("approved");
    form.set("decision", "admin"); expect(parseReview(form)).toBeNull();
    form.set("decision", "rejected"); form.set("reason", "  "); expect(parseReview(form)).toBeNull();
  });
  it("bounds pagination", () => {
    for (const value of [undefined, "-1", "0", "1.5", "x", "999999"]) expect(reviewPage(value)).toBe(1);
    expect(reviewPage("2")).toBe(2); expect(reviewPage("9999")).toBe(1000);
  });
});