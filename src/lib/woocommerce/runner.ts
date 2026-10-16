import { createHash, timingSafeEqual } from "node:crypto";
import type { Environment } from "../config";

type Dependencies = {
  requeue: () => Promise<number>;
  refresh: () => Promise<boolean>;
  discover?: () => Promise<{ scanned: number; queued: number }>;
  now?: () => number;
};

// POST only; deliberately independent of browser login and webhook signing secrets.
export async function handleWooRunner(request: Request, env: Environment, dependencies: Dependencies) {
  const respond = (status: number, body: Record<string, unknown>) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (request.method !== "POST") return respond(405, { error: "METHOD_NOT_ALLOWED" });
  const secret = env.WOO_WORKER_SECRET ?? "";
  if (env.WOO_WORKER_ENABLED !== "true" || secret.length < 32 || secret.length > 256 ||
    secret.trim() !== secret || secret === env.WOO_WEBHOOK_SECRET ||
    !["local", "staging"].includes(env.APP_ENV ?? "") || env.SUPABASE_ENVIRONMENT !== "nonproduction") {
    return respond(503, { error: "WORKER_DISABLED" });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (authorization.length > 300 || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return respond(401, { error: "UNAUTHORIZED" });
  }
  const now = dependencies.now ?? Date.now;
  const started = now();
  let attempted = 0;
  try {
    const requeued = await dependencies.requeue();
    let discovery: { scanned: number; queued: number } | undefined;
    let discoveryFailed = false;
    if (env.WOO_DISCOVERY_ENABLED === "true" && now() - started < 20000) {
      try {
        if (!dependencies.discover) throw new Error("Discovery unavailable");
        discovery = await dependencies.discover();
      } catch { discoveryFailed = true; }
    }
    // Soft admission budget: finish the current job, never abandon its promise.
    // A boolean means attempted, NOT successfully synchronized.
    while (attempted < 3 && now() - started < 20000) {
      if (!await dependencies.refresh()) break;
      attempted++;
    }
    return respond(discoveryFailed ? 503 : 200, { attempted, requeued, ...(discovery ? { discovery } : {}),
      ...(discoveryFailed ? { error: "DISCOVERY_UNAVAILABLE" } : {}) });
  } catch {
    return respond(503, { error: "WORKER_UNAVAILABLE", attempted });
  }
}