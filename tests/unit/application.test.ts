import { describe, expect, it } from "vitest";
import { validateApplication } from "../../src/lib/applications/validation";

function validForm() {
  const form = new FormData();
  form.set("displayName", "Test Partner");
  form.set("promotionUrl", "https://example.com/community");
  form.set("promotionPlan", "I publish independent tutorials for my community of software users.");
  return form;
}
describe("application validation", () => {
  it("accepts a complete application", () => expect(validateApplication(validForm())?.displayName).toBe("Test Partner"));
  it.each(["javascript:alert(1)", "http://example.com", "https://user:secret@example.com", "not a url", "https://localhost"])("rejects unsafe URL %s", url => {
    const form = validForm(); form.set("promotionUrl", url); expect(validateApplication(form)).toBeNull();
  });
  it("rejects short plans and missing names", () => {
    const form = validForm(); form.set("promotionPlan", "short"); expect(validateApplication(form)).toBeNull();
    const other = validForm(); other.delete("displayName"); expect(validateApplication(other)).toBeNull();
  });
  it("rejects oversized plans", () => {
    const form = validForm(); form.set("promotionPlan", "x".repeat(2001)); expect(validateApplication(form)).toBeNull();
  });
});