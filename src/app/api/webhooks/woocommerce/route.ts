import "server-only";
import { createClient } from "@supabase/supabase-js";
import { ingestionConfiguration } from "@/lib/woocommerce/configuration";
import { receiveWebhook } from "@/lib/woocommerce/webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = ingestionConfiguration(process.env);
  if (!config) return new Response(null, { status: 503 });
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  return receiveWebhook(request, { ...config, persist: async notification => {
    const { error } = await client.rpc("ingest_woo_notification", {
      p_webhook_id: notification.webhookId, p_delivery_id: notification.deliveryId,
      p_topic: notification.topic, p_order_id: notification.orderId, p_body_hash: notification.bodyHash,
    });
    if (error) throw new Error("Durable intake unavailable");
  } });
}