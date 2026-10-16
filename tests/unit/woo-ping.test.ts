import { describe, expect, it, vi } from "vitest";
import { receiveWebhook } from "../../src/lib/woocommerce/webhook";

const options = () => ({ secret: "synthetic-webhook-secret-for-unit-tests", origin: "https://cu.onetoolz.com", persist: vi.fn() });
function ping(body: string, extra: Record<string, string> = {}) {
  return new Request("https://example.invalid/api/webhooks/woocommerce", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", ...extra }, body,
  });
}
describe("unsigned reachability ping isolation", () => {
  it("acknowledges exact Woo ping without persistence", async () => {
    const deps = options(); const response = await receiveWebhook(ping("webhook_id=42"), deps);
    expect(response.status).toBe(200); expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it.each(["", "webhook_id=0", "webhook_id=-1", "webhook_id=01", "webhook_id=1&id=42", "webhook_id=1&webhook_id=2", "id=42", '{"id":42}', "webhook_id=%31"])("rejects malformed ping %#", async body => {
    const deps = options(); expect((await receiveWebhook(ping(body), deps)).status).toBe(400);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it.each(["x-wc-webhook-signature", "x-wc-webhook-topic", "x-wc-webhook-id", "x-wc-webhook-source", "x-wc-webhook-delivery-id"])("does not downgrade delivery with %s to ping", async name => {
    const deps = options(); expect((await receiveWebhook(ping("webhook_id=42", { [name]: "" }), deps)).status).toBe(400);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it("limits unsigned body size", async () => {
    const deps = options(); expect((await receiveWebhook(ping("x".repeat(65)), deps)).status).toBe(413);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it("requires authentication for JSON regardless of ping-like fields", async () => {
    const deps = options(); expect((await receiveWebhook(ping('{"webhook_id":42}', { "content-type": "application/json" }), deps)).status).toBe(401);
    expect(deps.persist).not.toHaveBeenCalled();
  });
  it("rejects GET without side effects", async () => {
    const deps = options(); expect((await receiveWebhook(new Request("https://example.invalid"), deps)).status).toBe(405);
    expect(deps.persist).not.toHaveBeenCalled();
  });
});