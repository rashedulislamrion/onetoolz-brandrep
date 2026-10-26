import "server-only";
import { handleCommissionRunner } from "@/lib/ledger/runner";
import { runPostingWorker, runReleaseWorker } from "@/lib/ledger/posting";
import { runRecordingWorker } from "@/lib/ledger/recording";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleCommissionRunner(request, process.env, {
    recording: runRecordingWorker, posting: runPostingWorker, release: runReleaseWorker,
  });
}
