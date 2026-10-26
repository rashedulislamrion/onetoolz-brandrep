import { createHash, timingSafeEqual } from "node:crypto";
import type { Environment } from "../config";
import { postingConfiguration } from "./configuration";
import type { PostingBatchResult, ReleaseBatchResult } from "./posting";
import type { RecordingBatchResult } from "./recording";

type Dependencies = {
  recording: () => Promise<RecordingBatchResult>;
  posting: () => Promise<PostingBatchResult>;
  release: () => Promise<ReleaseBatchResult>;
  now?: () => number;
};

// POST only; deliberately independent of browser login and of every other
// subsystem secret. Mirrors the Woo worker runner: a dedicated scheduler
// credential, fail-closed configuration, a soft time budget, and a
// counts-only response (no row detail, no provider errors).
export async function handleCommissionRunner(request: Request, env: Environment, dependencies: Dependencies) {
  const respond = (status: number, body: Record<string, unknown>) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (request.method !== "POST") return respond(405, { error: "METHOD_NOT_ALLOWED" });
  const secret = env.COMMISSION_WORKER_SECRET ?? "";
  if (secret.length < 32 || secret.length > 256 || secret.trim() !== secret ||
    secret === env.WOO_WORKER_SECRET || secret === env.WOO_WEBHOOK_SECRET ||
    secret === env.REFERRAL_BRIDGE_SECRET || !postingConfiguration(env)) {
    return respond(503, { error: "WORKER_DISABLED" });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (authorization.length > 300 || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return respond(401, { error: "UNAUTHORIZED" });
  }
  const now = dependencies.now ?? Date.now;
  const started = now();
  const counts = { recorded: 0, revised: 0, supersedeRefused: 0, posted: 0, reversed: 0, released: 0, skipped: 0, errors: 0 };
  try {
    // Recording first: it creates the calculation rows the posting batch
    // then consumes, so a single run can record and post a fresh order.
    const recording = await dependencies.recording();
    counts.recorded += recording.recorded;
    counts.revised += recording.revised;
    counts.supersedeRefused += recording.supersedeRefused;
    counts.skipped += Object.values(recording.skipped).reduce((sum, count) => sum + count, 0);
    counts.errors += recording.errors.length;
    const posting = await dependencies.posting();
    counts.posted += posting.posted; counts.reversed += posting.reversed;
    counts.skipped += posting.skipped.length; counts.errors += posting.errors.length;
    // Soft admission budget: recording and posting first, releases only
    // with time left.
    if (now() - started < 20000) {
      const release = await dependencies.release();
      counts.released += release.released;
      counts.skipped += release.skipped.length; counts.errors += release.errors.length;
    }
    return respond(200, counts);
  } catch {
    return respond(503, { error: "WORKER_UNAVAILABLE", ...counts });
  }
}
