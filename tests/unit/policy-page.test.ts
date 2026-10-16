import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const { access, from } = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/access", () => ({ requireAccess: access }));
vi.mock("@/components/submit-button", () => ({ SubmitButton: ({ children }: { children: string }) => children }));
vi.mock("@/app/admin/settings/actions", () => ({ saveProgramSettings: vi.fn(), publishProgramPolicy: vi.fn() }));
import Settings from "@/app/admin/settings/page";
const draft = { revision: 1, commission_bps: 1250, currency: "USD", minimum_payout: "25", hold_days: 30, payout_cadence: "manual", reason: "Synthetic draft", created_at: "2026-10-16" };
let draftResult: object; let policyResult: object;
beforeEach(() => {
  vi.clearAllMocks(); draftResult = { data: [draft], error: null }; policyResult = { data: [], error: null };
  access.mockResolvedValue({ client: { from } });
  from.mockImplementation((table: string) => ({ select: () => ({ order: () => ({ limit: async () => table === "program_policies" ? policyResult : draftResult }) }) }));
});
const render = async () => renderToStaticMarkup(await Settings({ searchParams: Promise.resolve({}) }));
describe("administrator policy editor", () => {
  it("requires administrator access before storage", async () => {
    access.mockRejectedValue(new Error("denied")); await expect(render()).rejects.toThrow("denied"); expect(from).not.toHaveBeenCalled();
  });
  it("offers explicit publication choices for the latest saved draft", async () => {
    const html = await render(); expect(access).toHaveBeenCalledWith("admin");
    for (const text of ["Publish draft 1 as policy 1", 'name="currencyDecimals"', 'name="basis"', 'name="refundRule"', 'name="publishConfirmed"', "No policy is published"]) expect(html).toContain(text);
    expect(html).not.toContain("private");
  });
  it("keeps draft editing independent when publication storage is missing", async () => {
    policyResult = { data: null, error: { message: "private" } }; const html = await render();
    expect(html).toContain("Publishing is disabled"); expect(html).toContain("Save draft revision"); expect(html).not.toContain('name="publishConfirmed"');
  });
  it("does not republish an already published draft and escapes history", async () => {
    policyResult = { data: [{ ...draft, version: 1, draft_revision: 1, currency_decimals: 2, basis: "net_items", refund_rule: "proportional", reason: "<script>bad</script>", effective_at: "2026-10-16" }], error: null };
    const html = await render(); expect(html).toContain("latest draft is already published"); expect(html).not.toContain('name="publishConfirmed"');
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
  });
  it("requires a saved draft before publication", async () => {
    draftResult = { data: [], error: null }; expect(await render()).toContain("Save a draft before publishing");
  });
});