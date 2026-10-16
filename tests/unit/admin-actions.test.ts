import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  origin: vi.fn(), identity: vi.fn(), access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(),
  list: vi.fn(), enroll: vi.fn(), unenroll: vi.fn(), verify: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/access", () => ({ requireIdentity: mocks.identity, requireAccess: mocks.access }));
vi.mock("@/lib/auth/mutation", () => ({ requireMutationOrigin: mocks.origin }));
import { enrollAuthenticator, verifyAuthenticator } from "../../src/app/account/security/actions";
import { reviewApplication } from "../../src/app/admin/applications/actions";

const id = "10000000-0000-4000-8000-000000000001";
const client = { rpc: mocks.rpc, auth: { mfa: { listFactors: mocks.list, enroll: mocks.enroll, unenroll: mocks.unenroll, challengeAndVerify: mocks.verify } } };
function codeForm() { const form = new FormData(); form.set("factorId", id); form.set("code", "012345"); return form; }
function reviewForm() { const form = new FormData(); form.set("applicationId", id); form.set("decision", "approved"); form.set("reason", " Reviewed application "); form.set("confirmed", "yes"); return form; }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ client, user: { email_confirmed_at: "2026-10-15" } });
  mocks.access.mockResolvedValue({ client });
  mocks.list.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
  mocks.enroll.mockResolvedValue({ data: { id, totp: { secret: "synthetic-test-key" } }, error: null });
  mocks.unenroll.mockResolvedValue({ error: null }); mocks.verify.mockResolvedValue({ error: null }); mocks.rpc.mockResolvedValue({ error: null });
});
describe("MFA server action orchestration (mocked provider)", () => {
  it("checks origin before identity or enrollment", async () => {
    mocks.origin.mockRejectedValue(new Error("invalid origin"));
    await expect(enrollAuthenticator()).rejects.toThrow("invalid origin");
    expect(mocks.identity).not.toHaveBeenCalled(); expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("requires confirmed email", async () => {
    mocks.identity.mockResolvedValue({ client, user: {} });
    expect(await enrollAuthenticator()).toHaveProperty("error"); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("fails closed on factor lookup failure", async () => {
    mocks.list.mockResolvedValue({ data: null, error: { message: "private provider error" } });
    expect(await enrollAuthenticator()).toHaveProperty("error"); expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("does not remove or replace a verified TOTP factor", async () => {
    mocks.list.mockResolvedValue({ data: { all: [], totp: [{ id, status: "verified" }] }, error: null });
    expect(await enrollAuthenticator()).toHaveProperty("error"); expect(mocks.unenroll).not.toHaveBeenCalled(); expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("clears only unfinished TOTP factors before enrollment", async () => {
    mocks.list.mockResolvedValue({ data: { all: [{ id, factor_type: "totp", status: "unverified" }, { id: "phone", factor_type: "phone", status: "unverified" }], totp: [] }, error: null });
    expect(await enrollAuthenticator()).toEqual({ factorId: id, secret: "synthetic-test-key" });
    expect(mocks.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: id });
  });
  it("stops when unfinished factor cleanup fails", async () => {
    mocks.list.mockResolvedValue({ data: { all: [{ id, factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    mocks.unenroll.mockResolvedValue({ error: {} });
    expect(await enrollAuthenticator()).toHaveProperty("error"); expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("does not expose provider enrollment errors", async () => {
    mocks.enroll.mockResolvedValue({ error: { message: "private details" } });
    expect(JSON.stringify(await enrollAuthenticator())).not.toContain("private details");
  });
  it("rejects malformed codes without calling provider", async () => {
    const form = codeForm(); form.set("code", "bad");
    await expect(verifyAuthenticator(form)).rejects.toThrow("notice=invalid"); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("rejects a factor that is not owned by the signed-in user", async () => {
    await expect(verifyAuthenticator(codeForm())).rejects.toThrow("notice=invalid"); expect(mocks.verify).not.toHaveBeenCalled();
  });
  it.each([true, false])("handles provider verification error=%s", async error => {
    mocks.list.mockResolvedValue({ data: { all: [{ id, factor_type: "totp" }] }, error: null });
    mocks.verify.mockResolvedValue({ error: error ? {} : null });
    await expect(verifyAuthenticator(codeForm())).rejects.toThrow(error ? "notice=invalid" : "notice=verified");
    expect(mocks.verify).toHaveBeenCalledWith({ factorId: id, code: "012345" });
  });
});
describe("review server action orchestration (mocked database)", () => {
  it("checks origin before authorization", async () => {
    mocks.origin.mockRejectedValue(new Error("invalid origin"));
    await expect(reviewApplication(reviewForm())).rejects.toThrow("invalid origin"); expect(mocks.access).not.toHaveBeenCalled();
  });
  it("never calls RPC when admin authorization fails", async () => {
    mocks.access.mockRejectedValue(new Error("denied"));
    await expect(reviewApplication(reviewForm())).rejects.toThrow("denied"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires confirmation", async () => {
    const form = reviewForm(); form.delete("confirmed");
    await expect(reviewApplication(form)).rejects.toThrow("notice=invalid"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes only validated fields to the guarded RPC", async () => {
    await expect(reviewApplication(reviewForm())).rejects.toThrow("notice=saved");
    expect(mocks.access).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("review_affiliate_application", { p_application_id: id, p_decision: "approved", p_reason: "Reviewed application" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/applications");
  });
  it("does not report success on database rejection", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "private database error" } });
    await expect(reviewApplication(reviewForm())).rejects.toThrow("notice=failed"); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});