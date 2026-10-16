import "server-only";
import { handleWooRunner } from "@/lib/woocommerce/runner";
import { requeueWooOrders, runWooRefresh, runWooDiscovery } from "@/lib/woocommerce/worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleWooRunner(request, process.env, { requeue: requeueWooOrders, refresh: runWooRefresh, discover: runWooDiscovery });
}