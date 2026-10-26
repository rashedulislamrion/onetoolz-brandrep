import "server-only";
import { createClient } from "@supabase/supabase-js";
import { postingConfiguration } from "./configuration";
import { journalIntentFor, reversalJournalIntentFor, type CommissionCalculation } from "./engine";
import { validateJournal, type Journal } from "./journal";
import type { CommissionQuote } from "./commission";
import type { Environment } from "../config";

// Phase 4 posting worker — the first code that turns recorded commission
// calculations into ledger journals. It consumes ONLY the narrow RPC
// surface of migration 20261026030000 (list / posting-state / account
// provisioning / namespaced journal posting); it never touches the private
// ledger or commissions schemas directly.
//
// Invariants maintained per calculation effect key:
// - Credited-to-held == the calculation's recorded net_minor. The earn
//   journal posts the net (engine.journalIntentFor); refund maintenance
//   below only ever brings an over-credited held balance DOWN to the
//   recorded net, so a reversal can never double-count a refund that was
//   already netted into the earn posting.
// - Every journal is idempotent on its effect key (ledger.post_journal):
//   retries resubmit identical content and receive the existing journal id.
// - Posting uses Woo-recorded qualification only. It is NOT settlement
//   evidence and NOT payout authorization; releases stay gated behind the
//   same enable flag, which must remain off until a settlement-evidence
//   gate exists (see docs/COMMISSION_ENGINE.md).

export type CalculationRow = Readonly<{
  id: string;
  effect_key: string;
  order_id: string;
  affiliate_id: string;
  policy_version: number;
  currency: string;
  currency_decimals: number;
  basis: string;
  refund_rule: string;
  rounding: string;
  basis_minor: string;
  refunded_basis_minor: string;
  gross_minor: string;
  reversal_minor: string;
  net_minor: string;
  qualification: string;
  unqualified_reason: string | null;
  hold_until: string | null;
  status: string;
  created_at: string;
}>;

/** Minimal RPC surface the worker needs; the real Supabase client and test
 * mocks both satisfy it. Errors are {code} only — provider bodies never
 * propagate into results or logs. */
export type PostingClient = {
  rpc: (fn: string, args?: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { code?: string } | null }>;
};

type Accounts = Readonly<{ expenseAccountId: string; heldAccountId: string; payableAccountId: string }>;
type PostingState = Readonly<{
  earnJournalId: string | null;
  earnMinor: string | null;
  reversalPostedMinor: string;
  releaseJournalId: string | null;
}>;

export type ItemProblem = Readonly<{ effectKey: string; stage: string; reason: string }>;
export type PostingBatchResult = Readonly<{
  posted: number;
  reversed: number;
  skipped: readonly ItemProblem[];
  errors: readonly ItemProblem[];
}>;
export type ReleaseBatchResult = Readonly<{
  released: number;
  skipped: readonly ItemProblem[];
  errors: readonly ItemProblem[];
}>;

const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const minorShape = /^(0|[1-9]\d{0,18})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rebuild the engine's calculation value from a stored row. Returns null
 * for any shape drift — a malformed row is an error entry, never a guess. */
export function calculationFromRow(row: CalculationRow): CommissionCalculation | null {
  if (!row || typeof row.effect_key !== "string" || typeof row.order_id !== "string" ||
    !uuidShape.test(row.affiliate_id ?? "") || !Number.isInteger(row.policy_version) ||
    !/^[A-Z]{3}$/.test(row.currency ?? "") || !Number.isInteger(row.currency_decimals) ||
    !["net_items", "order_total"].includes(row.basis) ||
    !["proportional", "full_on_any_refund"].includes(row.refund_rule) ||
    !["half_up", "down"].includes(row.rounding) ||
    ![row.basis_minor, row.refunded_basis_minor, row.gross_minor, row.reversal_minor, row.net_minor]
      .every(value => typeof value === "string" && minorShape.test(value)) ||
    !["qualified", "unqualified"].includes(row.qualification) ||
    (row.qualification === "qualified" ? row.unqualified_reason !== null
      : !["not_completed", "not_paid"].includes(row.unqualified_reason ?? "")) ||
    typeof row.hold_until !== "string" || row.hold_until.length === 0) return null;
  const quote: CommissionQuote = Object.freeze({
    policyVersion: row.policy_version, currency: row.currency, currencyDecimals: row.currency_decimals,
    basis: row.basis as CommissionQuote["basis"], refundRule: row.refund_rule as CommissionQuote["refundRule"],
    rounding: row.rounding as CommissionQuote["rounding"], basisMinor: row.basis_minor,
    refundedBasisMinor: row.refunded_basis_minor, grossCommissionMinor: row.gross_minor,
    reversalMinor: row.reversal_minor, netCommissionMinor: row.net_minor,
  });
  return Object.freeze({
    kind: "calculation", orderId: row.order_id, affiliateId: row.affiliate_id.toLowerCase(),
    policyVersion: row.policy_version, quote, qualification: row.qualification as "qualified" | "unqualified",
    ...(row.qualification === "unqualified"
      ? { unqualifiedReason: (row.unqualified_reason ?? "not_completed") as "not_completed" | "not_paid" } : {}),
    holdUntil: row.hold_until, effectKey: row.effect_key,
  });
}

async function rpc<T>(client: PostingClient, fn: string, args: Record<string, unknown>,
  parse: (data: unknown) => T | null): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error("rpc_failed");
  const parsed = parse(data);
  if (parsed === null) throw new Error("rpc_invalid_response");
  return parsed;
}

function parseRows(data: unknown): CalculationRow[] | null {
  if (!Array.isArray(data)) return null;
  return data as CalculationRow[];
}

function parseAccounts(data: unknown): Accounts | null {
  if (!isRecord(data) || typeof data.expenseAccountId !== "string" ||
    typeof data.heldAccountId !== "string" || typeof data.payableAccountId !== "string" ||
    !uuidShape.test(data.expenseAccountId) || !uuidShape.test(data.heldAccountId) ||
    !uuidShape.test(data.payableAccountId)) return null;
  return { expenseAccountId: data.expenseAccountId.toLowerCase(),
    heldAccountId: data.heldAccountId.toLowerCase(), payableAccountId: data.payableAccountId.toLowerCase() };
}

function parseState(data: unknown): PostingState | null {
  if (!isRecord(data) || !(data.earnJournalId === null || typeof data.earnJournalId === "string") ||
    !(data.earnMinor === null || (typeof data.earnMinor === "string" && minorShape.test(data.earnMinor))) ||
    typeof data.reversalPostedMinor !== "string" || !minorShape.test(data.reversalPostedMinor) ||
    !(data.releaseJournalId === null || typeof data.releaseJournalId === "string")) return null;
  return { earnJournalId: data.earnJournalId as string | null, earnMinor: data.earnMinor as string | null,
    reversalPostedMinor: data.reversalPostedMinor, releaseJournalId: data.releaseJournalId as string | null };
}

const accountsFor = (client: PostingClient, row: CalculationRow) =>
  rpc(client, "get_or_create_commission_accounts",
    { p_affiliate_id: row.affiliate_id, p_currency: row.currency, p_exponent: row.currency_decimals }, parseAccounts);

const stateFor = (client: PostingClient, effectKey: string) =>
  rpc(client, "commission_posting_state", { p_effect_key: effectKey }, parseState);

async function postJournal(client: PostingClient, journal: Journal): Promise<void> {
  const { error } = await client.rpc("post_commission_journal", { p_journal: journal });
  if (error) throw new Error("rpc_failed");
}

/**
 * Post earn journals (and refund-maintenance reversals) for recorded
 * qualified calculations, oldest first. Each row is isolated: a failure is
 * recorded in `errors` and never aborts the batch.
 */
export async function runPostingBatch(client: PostingClient,
  options: { limit?: number } = {}): Promise<PostingBatchResult> {
  const limit = options.limit ?? 25;
  const rows = await rpc(client, "list_commission_calculations",
    { p_qualification: null, p_due_before: null, p_limit: limit }, parseRows);
  let posted = 0;
  let reversed = 0;
  const skipped: ItemProblem[] = [];
  const errors: ItemProblem[] = [];
  for (const row of rows ?? []) {
    const effectKey = typeof row?.effect_key === "string" ? row.effect_key : "unknown";
    try {
      const calculation = calculationFromRow(row);
      if (!calculation) { errors.push({ effectKey, stage: "posting", reason: "invalid_row" }); continue; }
      // Defense in depth: the scan may return unqualified rows; they are
      // pending estimates and are never posted.
      if (calculation.qualification !== "qualified") {
        skipped.push({ effectKey, stage: "posting", reason: "unqualified" }); continue;
      }
      const state = await stateFor(client, calculation.effectKey);
      let accounts: Accounts | null = null;
      const ledgerAccounts = async () => {
        accounts ??= await accountsFor(client, row);
        return { platformExpenseAccountId: accounts.expenseAccountId, affiliateHeldAccountId: accounts.heldAccountId };
      };
      let credited: bigint | null = state.earnJournalId
        ? BigInt(state.earnMinor ?? "0") - BigInt(state.reversalPostedMinor) : null;
      if (!state.earnJournalId) {
        const intent = journalIntentFor(calculation, await ledgerAccounts());
        if (!intent) { skipped.push({ effectKey, stage: "posting", reason: "zero_amount" }); continue; }
        await postJournal(client, intent);
        posted++;
        credited = BigInt(calculation.quote.netCommissionMinor);
      }
      // Refund maintenance: if more was credited than the recorded net
      // (e.g. an earn posted before a refund state was recorded), post the
      // delta reversal keyed by the calculation's cumulative refunded
      // basis. When credited already equals the net this is a no-op, so a
      // refund already netted into the earn posting is never reversed twice.
      const excess = (credited ?? 0n) - BigInt(calculation.quote.netCommissionMinor);
      if (excess > 0n) {
        const intent = reversalJournalIntentFor(calculation, excess.toString(), await ledgerAccounts());
        if (!intent) { errors.push({ effectKey, stage: "reversal", reason: "invalid_intent" }); continue; }
        await postJournal(client, intent);
        reversed++;
      }
    } catch {
      errors.push({ effectKey, stage: "posting", reason: "rpc_failed" });
    }
  }
  return Object.freeze({ posted, reversed, skipped: Object.freeze(skipped), errors: Object.freeze(errors) });
}

/**
 * Release matured holds: for each qualified calculation whose hold_until
 * has passed and whose earn journal exists, move the currently credited
 * amount from the affiliate's held account to their payable (available)
 * account under effect key `<effectKey>:release`. Idempotent — an existing
 * release journal is a skip, and ledger.post_journal deduplicates retries.
 */
export async function releaseDue(client: PostingClient,
  options: { limit?: number; now?: Date } = {}): Promise<ReleaseBatchResult> {
  const limit = options.limit ?? 25;
  const now = options.now ?? new Date();
  const rows = await rpc(client, "list_commission_calculations",
    { p_qualification: "qualified", p_due_before: now.toISOString(), p_limit: limit }, parseRows);
  let released = 0;
  const skipped: ItemProblem[] = [];
  const errors: ItemProblem[] = [];
  for (const row of rows ?? []) {
    const effectKey = typeof row?.effect_key === "string" ? row.effect_key : "unknown";
    try {
      const calculation = calculationFromRow(row);
      if (!calculation) { errors.push({ effectKey, stage: "release", reason: "invalid_row" }); continue; }
      // The RPC already filters by due time; re-check so a stale or
      // mis-filtered row can never release early.
      if (!row.hold_until || Date.parse(row.hold_until) > now.getTime()) {
        skipped.push({ effectKey, stage: "release", reason: "not_due" }); continue;
      }
      const state = await stateFor(client, calculation.effectKey);
      if (state.releaseJournalId) { skipped.push({ effectKey, stage: "release", reason: "already_released" }); continue; }
      if (!state.earnJournalId) { skipped.push({ effectKey, stage: "release", reason: "not_posted" }); continue; }
      const amount = BigInt(state.earnMinor ?? "0") - BigInt(state.reversalPostedMinor);
      if (amount <= 0n) { skipped.push({ effectKey, stage: "release", reason: "zero_amount" }); continue; }
      const accounts = await accountsFor(client, row);
      const journal = validateJournal({
        effectKey: `${calculation.effectKey}:release`, currency: calculation.quote.currency,
        exponent: calculation.quote.currencyDecimals,
        reason: `Commission released for order ${calculation.orderId} under policy ${calculation.policyVersion}`,
        lines: [
          { accountId: accounts.heldAccountId, currency: calculation.quote.currency, exponent: calculation.quote.currencyDecimals, debitMinor: amount.toString(), creditMinor: "0" },
          { accountId: accounts.payableAccountId, currency: calculation.quote.currency, exponent: calculation.quote.currencyDecimals, debitMinor: "0", creditMinor: amount.toString() },
        ],
      });
      if (!journal) { errors.push({ effectKey, stage: "release", reason: "invalid_intent" }); continue; }
      await postJournal(client, journal);
      released++;
    } catch {
      errors.push({ effectKey, stage: "release", reason: "rpc_failed" });
    }
  }
  return Object.freeze({ released, skipped: Object.freeze(skipped), errors: Object.freeze(errors) });
}

// Bounded RPC transport, matching the Woo worker: no credentials or
// provider error bodies are logged.
const databaseFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, signal: init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
});

function workerClient(env: Environment): PostingClient {
  const config = postingConfiguration(env);
  if (!config) throw new Error("Posting not configured");
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: databaseFetch },
  }) as unknown as PostingClient;
}

export async function runPostingWorker(env: Environment = process.env): Promise<PostingBatchResult> {
  return runPostingBatch(workerClient(env));
}

export async function runReleaseWorker(env: Environment = process.env): Promise<ReleaseBatchResult> {
  return releaseDue(workerClient(env));
}
