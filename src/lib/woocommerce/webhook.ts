import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MAX_WEBHOOK_BYTES = 1024 * 1024;
export type Notification = { webhookId: string; deliveryId: string; topic: string; orderId: string; bodyHash: string };
export class IntakeError extends Error {
  constructor(public readonly status: number) { super("Webhook rejected"); }
}

export async function boundedBody(request: Request, limit = MAX_WEBHOOK_BYTES): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new IntakeError(413);
  if (!request.body) throw new IntakeError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new IntakeError(413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

// Header metadata is NOT covered by Woo's body signature. Never derive credentials,
// financial decisions or a remote fetch origin from these headers.
export function verifyNotification(body: Buffer, headers: Headers, secret: string, origin: string): Notification {
  if (body.length > MAX_WEBHOOK_BYTES) throw new IntakeError(413);
  const signature = headers.get("x-wc-webhook-signature") ?? "";
  if (secret.length < 32 || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) throw new IntakeError(401);
  const expected = createHmac("sha256", secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "base64"))) throw new IntakeError(401);
  if (![origin, `${origin}/`].includes(headers.get("x-wc-webhook-source") ?? "")) throw new IntakeError(400);
  const topic = headers.get("x-wc-webhook-topic") ?? "";
  if (!["order.created", "order.updated", "order.deleted", "order.restored"].includes(topic)) throw new IntakeError(400);
  const webhookId = headers.get("x-wc-webhook-id") ?? "";
  const deliveryId = headers.get("x-wc-webhook-delivery-id") ?? "";
  if (!/^[1-9]\d{0,18}$/.test(webhookId) || !/^[A-Za-z0-9_-]{1,100}$/.test(deliveryId)) throw new IntakeError(400);
  let data: unknown;
  try { data = JSON.parse(body.toString("utf8")); } catch { throw new IntakeError(400); }
  if (!data || typeof data !== "object" || !("id" in data) ||
    typeof data.id !== "number" || !Number.isSafeInteger(data.id) || data.id < 1) throw new IntakeError(400);
  return { webhookId, deliveryId, topic, orderId: String(data.id), bodyHash: createHash("sha256").update(body).digest("hex") };
}

export async function receiveWebhook(request: Request, options: {
  secret: string; origin: string; persist: (notification: Notification) => Promise<void>;
}): Promise<Response> {
  try {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    // Woo's creation ping is unsigned. It is only a reachability probe, never
    // an ingestion event or evidence of store identity/configuration readiness.
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType === "application/x-www-form-urlencoded") {
      const body = await boundedBody(request, 64);
      const hasDeliveryHeaders = [...request.headers.keys()].some(name => name.startsWith("x-wc-webhook-"));
      if (hasDeliveryHeaders || !/^webhook_id=[1-9][0-9]{0,18}$/.test(body.toString("utf8"))) throw new IntakeError(400);
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    const notification = verifyNotification(await boundedBody(request), request.headers, options.secret, options.origin);
    await options.persist(notification);
    return new Response(null, { status: 202 });
  } catch (error) {
    // Do not log bodies, signatures, provider error messages or credentials.
    return new Response(null, { status: error instanceof IntakeError ? error.status : 503 });
  }
}