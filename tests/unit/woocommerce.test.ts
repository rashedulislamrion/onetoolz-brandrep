import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { boundedBody, MAX_WEBHOOK_BYTES, receiveWebhook, verifyNotification } from "../../src/lib/woocommerce/webhook";
import { ingestionConfiguration } from "../../src/lib/woocommerce/configuration";
import { orderSnapshot, refreshOne } from "../../src/lib/woocommerce/orders";

const secret = "synthetic-webhook-fixture-not-a-real-secret";
const origin = "https://cu.onetoolz.com";
function signed(body = Buffer.from('{"id":42}')) {
  return new Headers({ "x-wc-webhook-signature": createHmac("sha256", secret).update(body).digest("base64"),
    "x-wc-webhook-source": origin, "x-wc-webhook-topic": "order.updated", "x-wc-webhook-id": "1", "x-wc-webhook-delivery-id": "delivery-1" });
}
function order() {
  return { id: 42, status: "completed", currency: "USD", total: "12.50", payment_method: "piprapay",
    date_modified_gmt: "2026-10-15T10:00:00", date_paid_gmt: "2026-10-15T09:00:00", refunds: [],
    billing: { email: "private@example.invalid" }, line_items: [{ name: "Digital subscription" }] };
}
describe("Woo intake", () => {
  it("authenticates raw bytes and retains no customer payload", () => {
    const body = Buffer.from('{"id":42,"billing":{"email":"private@example.invalid"}}');
    expect(verifyNotification(body, signed(body), secret, origin)).toMatchObject({ orderId: "42", topic: "order.updated" });
    expect(JSON.stringify(verifyNotification(body, signed(body), secret, origin))).not.toContain("private@");
  });
  it.each(["", "invalid", "A".repeat(44)])("rejects invalid signature %s", signature => {
    const headers = signed(); headers.set("x-wc-webhook-signature", signature);
    expect(() => verifyNotification(Buffer.from('{"id":42}'), headers, secret, origin)).toThrow();
  });
  it("rejects tampered bytes", () => expect(() => verifyNotification(Buffer.from('{"id":43}'), signed(), secret, origin)).toThrow());
  it.each(["x-wc-webhook-source", "x-wc-webhook-topic", "x-wc-webhook-id", "x-wc-webhook-delivery-id"])("rejects missing %s", name => {
    const headers = signed(); headers.delete(name);
    expect(() => verifyNotification(Buffer.from('{"id":42}'), headers, secret, origin)).toThrow();
  });
  it.each(['{}', '{"id":0}', '{"id":9007199254740992}', 'not json'])("rejects malformed signed body %s", raw => {
    const body = Buffer.from(raw); expect(() => verifyNotification(body, signed(body), secret, origin)).toThrow();
  });
  it("rejects oversized bodies with and without declared size", async () => {
    await expect(boundedBody(new Request(origin, { method: "POST", headers: { "content-length": String(MAX_WEBHOOK_BYTES + 1) }, body: "a" }))).rejects.toThrow();
    await expect(boundedBody(new Request(origin, { method: "POST", body: "a".repeat(MAX_WEBHOOK_BYTES + 1) }))).rejects.toThrow();
  });
  it("acknowledges only after durable persistence", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const request = () => new Request(origin, { method: "POST", headers: signed(), body: '{"id":42}' });
    expect((await receiveWebhook(request(), { secret, origin, persist })).status).toBe(202);
    expect(persist).toHaveBeenCalledOnce();
    persist.mockRejectedValue(new Error("private infrastructure detail"));
    const failure = await receiveWebhook(request(), { secret, origin, persist });
    expect(failure.status).toBe(503); expect(await failure.text()).toBe("");
  });
  it("defaults off and rejects production or unverified configuration", () => {
    expect(ingestionConfiguration({})).toBeNull();
    const env = { WOO_INGESTION_ENABLED: "true", APP_ENV: "staging", SUPABASE_ENVIRONMENT: "nonproduction", WOO_STORE_VERIFIED: "true",
      WOO_STORE_ORIGIN: origin, WOO_WEBHOOK_SECRET: secret, WOO_INGESTION_SUPABASE_SECRET_KEY: "sb_secret_fixture_only",
      NEXT_PUBLIC_SUPABASE_URL: "https://nwgdzzpcbqmfqujycpqk.supabase.co", WOO_PRODUCTION_STORE_ACCESS_APPROVED: "true" };
    expect(ingestionConfiguration(env)).not.toBeNull();
    expect(ingestionConfiguration({ ...env, APP_ENV: "production" })).toBeNull();
    expect(ingestionConfiguration({ ...env, WOO_STORE_VERIFIED: "false" })).toBeNull();
    expect(ingestionConfiguration({ ...env, WOO_PRODUCTION_STORE_ACCESS_APPROVED: "false" })).toBeNull();
    expect(ingestionConfiguration({ ...env, WOO_PRODUCTION_STORE_ACCESS_APPROVED: undefined })).toBeNull();
  });
});
describe("authoritative order refresh", () => {
  it.each(["pending", "processing", "completed", "cancelled", "refunded", "failed"])("preserves %s without enabling commissions", status => {
    const result = orderSnapshot({ ...order(), status });
    expect(result.status).toBe(status); expect(result.commissionEnabled).toBe(false);
    expect(result).not.toHaveProperty("billing"); expect(result).not.toHaveProperty("recurring");
  });
  it("keeps exact partial/full refund summaries", () => {
    expect(orderSnapshot({ ...order(), refunds: [{ id: 1, total: "-2.50" }, { id: 2, total: "-10.00" }] }).refunds)
      .toEqual([{ id: "1", total: "-2.50" }, { id: "2", total: "-10.00" }]);
  });
  it("rejects duplicate refund IDs and floating point totals", () => {
    expect(() => orderSnapshot({ ...order(), refunds: [{ id: 1, total: "-1" }, { id: 1, total: "-1" }] })).toThrow();
    expect(() => orderSnapshot({ ...order(), total: 12.5 })).toThrow();
  });
  it("refreshes from source and records failures without replacing state", async () => {
    const job = { id: "42", orderId: "42", lease: "fixture" };
    const repository = { claim: vi.fn().mockResolvedValue(job), complete: vi.fn(), fail: vi.fn() };
    await refreshOne(repository, async () => order());
    expect(repository.complete).toHaveBeenCalledOnce();
    await refreshOne(repository, async () => { throw new Error("404"); });
    expect(repository.complete).toHaveBeenCalledOnce(); expect(repository.fail).toHaveBeenCalledWith(job, "ORDER_REFRESH_FAILED");
    await refreshOne(repository, async () => ({ ...order(), id: 99 }));
    expect(repository.fail).toHaveBeenCalledTimes(2);
  });
});