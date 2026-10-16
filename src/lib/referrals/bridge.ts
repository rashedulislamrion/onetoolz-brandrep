import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Environment } from "@/lib/config";
import { databaseEnvironmentAllowed } from "../database-environment.mts";
import { boundedBody } from "@/lib/woocommerce/webhook";
import { validReferralCode } from "./campaigns";
import { REFERRAL_POLICY } from "./policy";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;
const hash = /^[a-f0-9]{64}(?![\s\S])/;
export type BridgeEvent =
  | { kind: "capture"; visitorHash: string; code: string; consent: true; policyVersion: string }
  | { kind: "order"; visitorHash: string; orderId: string; orderAt: string; buyerUserId: string };

export function bridgeConfiguration(env: Environment) {
  if (env.REFERRAL_BRIDGE_ENABLED !== "true" || env.VERCEL_ENV === "preview" ||
    !databaseEnvironmentAllowed(env)) return null;
  const secret = env.REFERRAL_BRIDGE_SECRET ?? "";
  const key = env.REFERRAL_SUPABASE_SECRET_KEY ?? "";
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (secret.length < 32 || secret.length > 256 || secret.trim() !== secret ||
    secret === env.WOO_WEBHOOK_SECRET || secret === env.WOO_WORKER_SECRET ||
    !key.startsWith("sb_secret_") || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) ||
    env.REFERRAL_APPROVED_SUPABASE_URL !== url) return null;
  return { secret, key, url };
}

export function parseBridgeEvent(value: unknown): BridgeEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.visitorHash !== "string" || !hash.test(v.visitorHash)) return null;
  if (v.kind === "capture" && Object.keys(v).sort().join() === "code,consent,kind,policyVersion,visitorHash" &&
    typeof v.code === "string" && validReferralCode(v.code) && v.consent === true && v.policyVersion === REFERRAL_POLICY.version) {
    return v as BridgeEvent;
  }
  if (v.kind === "order" && Object.keys(v).sort().join() === "buyerUserId,kind,orderAt,orderId,visitorHash" &&
    typeof v.orderId === "string" && /^[1-9][0-9]{0,15}(?![\s\S])/.test(v.orderId) && BigInt(v.orderId) <= 9007199254740991n &&
    typeof v.buyerUserId === "string" && uuid.test(v.buyerUserId) && typeof v.orderAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.orderAt) &&
    Number.isFinite(Date.parse(v.orderAt)) && new Date(v.orderAt).toISOString() === v.orderAt) return v as BridgeEvent;
  return null;
}

export type BridgeReceipt = { requestId: string; bodyHash: string };
export async function receiveReferralBridge(request: Request, options: {
  secret: string; now?: () => number;
  buyerIdentity: (token: string) => Promise<string | null>;
  persist: (event: BridgeEvent, receipt: BridgeReceipt) => Promise<void>;
}): Promise<Response> {
  const reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return reply(405);
  const timestamp = request.headers.get("x-brandrep-timestamp") ?? "";
  const nonce = request.headers.get("x-brandrep-request-id") ?? "";
  const signature = request.headers.get("x-brandrep-signature") ?? "";
  const now = (options.now ?? Date.now)();
  if (options.secret.length < 32 || !/^[0-9]{10}$/.test(timestamp) || !uuid.test(nonce) || !hash.test(signature) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000) return reply(401);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return reply(415);
  try {
    const body = await boundedBody(request, 4096);
    const expected = createHmac("sha256", options.secret).update(`${timestamp}.${nonce}.`).update(body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return reply(401);
    let value: unknown;
    try { value = JSON.parse(body.toString("utf8")); } catch { return reply(400); }
    const event = parseBridgeEvent(value);
    if (!event) return reply(400);
    if (event.kind === "order") {
      if (Date.parse(event.orderAt) > now || Date.parse(event.orderAt) < 0) return reply(400);
      const authorization = request.headers.get("authorization") ?? "";
      if (!authorization.startsWith("Bearer ") || authorization.length > 8192) return reply(401);
      // A store signature alone cannot establish a buyer's BrandRep identity.
      // Require a server-verified buyer session AND the signed store assertion.
      if (await options.buyerIdentity(authorization.slice(7)) !== event.buyerUserId) return reply(401);
    }
    await options.persist(event, { requestId: nonce, bodyHash: createHash("sha256").update(body).digest("hex") });
    return reply(202);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 413) return reply(413);
    return reply(503);
  }
}