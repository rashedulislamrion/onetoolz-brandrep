import "server-only";
import { createClient } from "@supabase/supabase-js";
import { ingestionConfiguration } from "./configuration";
import { boundedBody } from "./webhook";
import { refreshOne, type RefreshJob } from "./orders";
import { discoverOne, fetchDiscoveryPage } from "./discovery";

export async function runWooDiscovery() {
  const config = ingestionConfiguration(process.env);
  const key = process.env.WOO_READ_CONSUMER_KEY ?? "";
  const secret = process.env.WOO_READ_CONSUMER_SECRET ?? "";
  if (process.env.WOO_DISCOVERY_ENABLED !== "true" || !config || !/^ck_[a-f0-9]{40}$/.test(key) || !/^cs_[a-f0-9]{40}$/.test(secret)) throw new Error("Discovery not configured");
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: databaseFetch },
  });
  return discoverOne({
    claim: async () => {
      const { data, error } = await client.rpc("claim_woo_discovery");
      if (error) throw new Error("Discovery claim failed");
      return data;
    },
    fetchPage: claim => fetchDiscoveryPage(claim, { key, secret }),
    finish: async (claim, page) => {
      const { data, error } = await client.rpc("finish_woo_discovery", {
        p_lease: claim.lease, p_page: claim.page, p_ids: page.ids, p_complete: page.complete,
      });
      if (error) throw new Error("Discovery persistence failed");
      return data;
    },
  });
}

// Bounded RPC transport; no credentials or provider error bodies are logged.
const databaseFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, signal: init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
});

export async function requeueWooOrders() {
  const config = ingestionConfiguration(process.env);
  if (!config) throw new Error("Worker not configured");
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: databaseFetch },
  });
  const { data, error } = await client.rpc("requeue_woo_orders");
  if (error || !Number.isInteger(data) || data < 0 || data > 100) throw new Error("Reconciliation unavailable");
  return data as number;
}

export async function runWooRefresh() {
  const config = ingestionConfiguration(process.env);
  const key = process.env.WOO_READ_CONSUMER_KEY ?? "";
  const secret = process.env.WOO_READ_CONSUMER_SECRET ?? "";
  if (!config || !/^ck_[a-f0-9]{40}$/.test(key) || !/^cs_[a-f0-9]{40}$/.test(secret)) throw new Error("Worker not configured");
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: databaseFetch },
  });
  const finish = async (job: RefreshJob, snapshot: unknown, success: boolean) => {
    const { error } = await client.rpc("finish_woo_refresh", { p_order_id: job.orderId, p_lease: job.lease, p_snapshot: snapshot, p_success: success });
    if (error) throw new Error("Refresh persistence failed");
  };
  return refreshOne({
    claim: async () => {
      const { data, error } = await client.rpc("claim_woo_refresh");
      if (error) throw new Error("Refresh claim failed");
      if (data === null) return null;
      if (!data || typeof data.id !== "string" || data.id !== data.orderId || !/^[1-9]\d{0,15}$/.test(data.orderId) ||
        typeof data.lease !== "string" || !/^[0-9a-f-]{36}$/.test(data.lease)) throw new Error("Invalid job");
      return data as RefreshJob;
    },
    complete: (job, snapshot) => finish(job, snapshot, true),
    fail: job => finish(job, null, false),
  }, async orderId => {
    const response = await fetch(`${config.origin}/wp-json/wc/v3/orders/${orderId}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Order unavailable"); }
    const body = await boundedBody(new Request("https://local.invalid", { method: "POST", body: response.body, duplex: "half" } as RequestInit));
    return JSON.parse(body.toString("utf8"));
  });
}