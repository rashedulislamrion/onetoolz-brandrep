import "server-only";
import { createClient } from "@supabase/supabase-js";
import { postingConfiguration } from "./configuration";
import { policyForOrder } from "./commission";
import { evaluateOrder, validEnginePolicy, type CommissionCalculation, type EnginePolicy } from "./engine";
import type { OrderSnapshot } from "../woocommerce/orders";
import type { Environment } from "../config";

// Phase 4 recording worker — the first (and only) caller of
// record_commission_calculation. It turns attributed Woo orders into
// recorded commission calculations through the narrow RPC surface of
// migration 20261026040000 (order/decision scan + complete policy history)
// plus the record RPC of 20261026020100. It never touches the private woo,
// referral or commissions schemas directly, and it moves no money:
// a recorded row is an estimate/record that the posting worker may later
// act on under its own gate.
//
// Evidence rules (see docs/COMMISSION_ENGINE.md for the full decision):
// - Order creation time comes from referral.order_decisions.order_at —
//   the bridge-supplied time the association RPC validated. The stored
//   Woo snapshot deliberately carries no creation time (only modifiedAt),
//   and modified time is never substituted for creation time.
// - Basis: the snapshot stores NO line items, so a net_items policy can
//   never be evaluated from stored evidence — those orders skip as
//   basis_unavailable. For an order_total policy the basis IS the order
//   total, and Woo refunds are refunds of that total, so the cumulative
//   refunded basis is exactly the sum of the refund magnitudes. That sum
//   is NOT a net-items refund figure and is never used as one.
// - Hold days come from the immutable published policy row itself
//   (publication copies hold_days from the draft); drafts are never read.
// - commissions.calculations is append-only, but since migration
//   20261026050000 a recorded HEAD may be SUPERSEDED by a revision row
//   when the evidence drifts (refund growth, qualification flip). The
//   batch re-evaluates recorded heads, records a revision via
//   supersedesEffectKey when a material field changed, and counts
//   `revised`. A head that already has posted journals can never be
//   superseded (the record RPC raises 55000); those drifts count as
//   `supersedeRefused` and the money stays governed by the posting
//   worker's credited == recorded-net invariant. Drift the worker cannot
//   express as a revision (identity/policy drift, net_items evidence)
//   counts as skipped `unresolvable_drift`.

export type RecordingScanRow = Readonly<{
  order_id: string;
  order_at: string;
  outcome: string;
  affiliate_id: string | null;
  snapshot: unknown;
  /** Full recorded HEAD state (all null when nothing is recorded yet),
   * returned by list_orders_for_commission_recording for recheck diffing. */
  calc_effect_key: string | null;
  calc_revision: number | null;
  calc_affiliate_id: string | null;
  calc_basis: string | null;
  calc_currency: string | null;
  calc_currency_decimals: number | null;
  calc_refund_rule: string | null;
  calc_rounding: string | null;
  calc_basis_minor: string | null;
  calc_refunded_basis_minor: string | null;
  calc_gross_minor: string | null;
  calc_reversal_minor: string | null;
  calc_net_minor: string | null;
  calc_qualification: string | null;
  calc_unqualified_reason: string | null;
  calc_hold_until: string | null;
  calc_policy_version: number | null;
}>;

export type PolicyRow = Readonly<{
  version: number;
  effective_at: string;
  commission_bps: number;
  currency: string;
  currency_decimals: number;
  minimum_payout: string;
  hold_days: number;
  basis: string;
  refund_rule: string;
  scope: string;
  rounding: string | null;
  qualification: string | null;
}>;

/** Minimal RPC surface the worker needs; the real Supabase client and test
 * mocks both satisfy it. Errors are {code} only — provider bodies never
 * propagate into results or logs. */
export type RecordingClient = {
  rpc: (fn: string, args?: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { code?: string } | null }>;
};

export type RecordingProblem = Readonly<{ orderId: string; stage: string; reason: string }>;
export type RecordingBatchResult = Readonly<{
  /** First-time calculations recorded. */
  recorded: number;
  /** Recorded heads superseded by a revision because the evidence
   * drifted materially (refund growth or qualification change). */
  revised: number;
  /** Drifts whose revision the record RPC refused because the head
   * already has posted journals (SQLSTATE 55000). The recorded state
   * stays authoritative and the posting invariant governs the money. */
  supersedeRefused: number;
  skipped: Readonly<Record<string, number>>;
  errors: readonly RecordingProblem[];
}>;

const decimalShape = /^(0|[1-9]\d{0,18})(\.\d{1,8})?$/;
const signedDecimalShape = /^-?(0|[1-9]\d{0,18})(\.\d{1,8})?$/;
const storedTimestampShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a STORED snapshot (the output contract of ingestion's
 * orderSnapshot, persisted in woo.orders.snapshot) before trusting it.
 * This is deliberately not the raw-Woo parser: ingestion already
 * normalized the store payload; the worker re-checks the stored shape
 * defensively and fails the item closed on any drift.
 */
export function parseStoredSnapshot(value: unknown): OrderSnapshot | null {
  if (!isRecord(value) || typeof value.id !== "string" || !/^[1-9][0-9]{0,15}$/.test(value.id) ||
    typeof value.status !== "string" || !/^[a-z][a-z0-9-]{0,49}$/.test(value.status) ||
    typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) ||
    typeof value.total !== "string" || !decimalShape.test(value.total) ||
    typeof value.paymentMethod !== "string" || value.paymentMethod.length > 100 ||
    !(value.paidAt === null || (typeof value.paidAt === "string" && storedTimestampShape.test(value.paidAt))) ||
    typeof value.modifiedAt !== "string" || !storedTimestampShape.test(value.modifiedAt) ||
    !Array.isArray(value.refunds) || value.refunds.length > 10000 ||
    value.commissionEnabled !== false) return null;
  const refundIds = new Set<string>();
  for (const refund of value.refunds) {
    if (!isRecord(refund) || typeof refund.id !== "string" || !/^[1-9][0-9]{0,15}$/.test(refund.id) ||
      typeof refund.total !== "string" || !signedDecimalShape.test(refund.total) ||
      refundIds.has(refund.id)) return null;
    refundIds.add(refund.id);
  }
  return value as unknown as OrderSnapshot;
}

/** Parse a Woo decimal string (optional sign, up to 8dp) into an exact
 * bigint scaled by 10^8. Null on any shape drift. */
function parseScaled(value: string): bigint | null {
  if (!signedDecimalShape.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const scaled = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0") || "0");
  return negative ? -scaled : scaled;
}

function scaledToDecimal(scaled: bigint): string {
  const whole = scaled / 100000000n;
  const fraction = (scaled % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Cumulative refunded amount for the ORDER_TOTAL basis: the exact sum of
 * the stored refunds' magnitudes. Woo emits refund totals as negative
 * amounts of the order total returned; the basis here IS that total, so
 * the sum is exact for this basis (and only this basis). Returns null on
 * a sign anomaly — a positive refund total contradicts the known evidence
 * shape, so the order is skipped rather than estimated.
 */
export function orderTotalRefundedBasis(snapshot: OrderSnapshot): string | null {
  let refunded = 0n;
  for (const refund of snapshot.refunds) {
    const total = parseScaled(refund.total);
    if (total === null || total > 0n) return null;
    refunded -= total;
  }
  return scaledToDecimal(refunded);
}

/** Normalize a stored timestamp to the canonical millisecond ISO shape
 * the engine requires. Unparseable values pass through untouched so the
 * engine's own validation fails the item closed. */
function canonical(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

/** Map a published policy row to the engine's policy shape. Rows published
 * before rounding/qualification existed carry NULLs; the values pass
 * through and validEnginePolicy rejects them (invalid_policy) rather than
 * the worker inventing a rule. */
export function enginePolicyFromRow(row: PolicyRow): EnginePolicy {
  return Object.freeze({
    version: row.version, effectiveAt: canonical(row.effective_at), commissionBps: row.commission_bps,
    currency: row.currency, currencyDecimals: row.currency_decimals,
    basis: row.basis, refundRule: row.refund_rule, scope: row.scope,
    rounding: row.rounding, qualification: row.qualification,
    holdDays: row.hold_days, minimumPayout: row.minimum_payout,
  }) as EnginePolicy;
}

/** The record_commission_calculation payload for an engine calculation. */
export function recordPayload(calculation: CommissionCalculation): Record<string, unknown> {
  const quote = calculation.quote;
  return {
    effectKey: calculation.effectKey, orderId: calculation.orderId, affiliateId: calculation.affiliateId,
    policyVersion: calculation.policyVersion, currency: quote.currency, currencyDecimals: quote.currencyDecimals,
    basis: quote.basis, refundRule: quote.refundRule, rounding: quote.rounding,
    basisMinor: quote.basisMinor, refundedBasisMinor: quote.refundedBasisMinor,
    grossMinor: quote.grossCommissionMinor, reversalMinor: quote.reversalMinor,
    netMinor: quote.netCommissionMinor, qualification: calculation.qualification,
    unqualifiedReason: calculation.unqualifiedReason ?? null, holdUntil: calculation.holdUntil,
  };
}

/** True when a fresh engine payload is materially IDENTICAL to the
 * recorded head: same qualification, reason, amounts and hold. Identity
 * fields are compared separately by the caller (a mismatch there is not
 * a revision at all). Amounts and timestamps compare as exact strings —
 * both sides are canonical engine/RPC shapes, never floats. */
export function payloadMatchesHead(row: RecordingScanRow,
  payload: Record<string, unknown>): boolean {
  return payload.qualification === row.calc_qualification
    && (payload.unqualifiedReason ?? null) === row.calc_unqualified_reason
    && payload.basisMinor === row.calc_basis_minor
    && payload.refundedBasisMinor === row.calc_refunded_basis_minor
    && payload.grossMinor === row.calc_gross_minor
    && payload.reversalMinor === row.calc_reversal_minor
    && payload.netMinor === row.calc_net_minor
    && payload.holdUntil === row.calc_hold_until;
}

async function rpc<T>(client: RecordingClient, fn: string, args: Record<string, unknown>,
  parse: (data: unknown) => T | null): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error("rpc_failed");
  const parsed = parse(data);
  if (parsed === null) throw new Error("rpc_invalid_response");
  return parsed;
}

function parseRows<T>(data: unknown): T[] | null {
  return Array.isArray(data) ? data as T[] : null;
}

/**
 * Record commission calculations for decided orders, oldest decision
 * first. Each order is isolated: a failure is recorded in `errors` and
 * never aborts the batch. Unrecorded orders get a first-time record;
 * already-recorded orders surface as recheck candidates whose fresh
 * evaluation is diffed against the recorded HEAD and, on material
 * drift, stored as a superseding revision.
 */
export async function runRecordingBatch(client: RecordingClient,
  options: { limit?: number } = {}): Promise<RecordingBatchResult> {
  const limit = options.limit ?? 25;
  const policyRows = await rpc(client, "list_program_policies_for_recording", {}, data => parseRows<PolicyRow>(data));
  const policies: EnginePolicy[] = (policyRows ?? []).map(enginePolicyFromRow);
  const rows = await rpc(client, "list_orders_for_commission_recording",
    { p_limit: limit }, data => parseRows<RecordingScanRow>(data));
  let recorded = 0;
  let revised = 0;
  let supersedeRefused = 0;
  const skipped: Record<string, number> = {};
  const errors: RecordingProblem[] = [];
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };

  for (const row of rows ?? []) {
    const orderId = typeof row?.order_id === "string" ? row.order_id : "unknown";
    try {
      const snapshot = parseStoredSnapshot(row?.snapshot);
      if (!snapshot) { errors.push({ orderId, stage: "recording", reason: "invalid_snapshot" }); continue; }
      if (snapshot.id !== row.order_id) { errors.push({ orderId, stage: "recording", reason: "snapshot_mismatch" }); continue; }

      // Recheck path: a calculation HEAD already exists for this order.
      // Re-evaluate the current evidence and diff it against the head:
      // identical means already_recorded; a material change is stored
      // as a superseding revision; anything the revision contract
      // cannot express is unresolvable_drift (never silently forced).
      if (row.calc_basis !== null && row.calc_basis !== undefined) {
        if (!row.calc_effect_key || row.calc_revision === null || row.calc_revision === undefined ||
          row.calc_affiliate_id === null || row.calc_affiliate_id === undefined ||
          row.calc_policy_version === null || row.calc_policy_version === undefined) {
          errors.push({ orderId, stage: "recheck", reason: "invalid_recorded_row" }); continue;
        }
        // A revision must preserve the recorded identity: the same
        // attributed affiliate and the same policy version that priced
        // the order. Any disagreement is drift this worker cannot fix.
        if (row.outcome !== "attributed" || !row.affiliate_id ||
          row.affiliate_id.toLowerCase() !== row.calc_affiliate_id ||
          policies.length === 0 || !policies.every(policy => validEnginePolicy(policy))) {
          skip("unresolvable_drift"); continue;
        }
        const selected = policyForOrder(policies, canonical(row.order_at));
        if (!selected || selected.version !== row.calc_policy_version ||
          snapshot.currency !== selected.currency || selected.basis !== "order_total" ||
          row.calc_basis !== selected.basis) {
          skip("unresolvable_drift"); continue;
        }
        const refundedBasisAmount = orderTotalRefundedBasis(snapshot);
        if (refundedBasisAmount === null) {
          errors.push({ orderId, stage: "recheck", reason: "invalid_refund_evidence" }); continue;
        }
        const evaluation = evaluateOrder({
          order: {
            id: snapshot.id, status: snapshot.status, currency: snapshot.currency,
            createdAt: canonical(row.order_at),
            paidAt: snapshot.paidAt === null ? null : canonical(snapshot.paidAt),
            basisAmount: snapshot.total, refundedBasisAmount,
          },
          attribution: { affiliateId: row.affiliate_id },
          policies,
        });
        if (evaluation.kind === "skip") { skip("unresolvable_drift"); continue; }
        const payload = recordPayload(evaluation);
        // Identity fields must be the head's own; the record RPC also
        // enforces this, but a mismatch here means the diff is not a
        // revision of this head at all.
        if (payload.affiliateId !== row.calc_affiliate_id || payload.currency !== row.calc_currency ||
          payload.currencyDecimals !== row.calc_currency_decimals ||
          payload.basis !== row.calc_basis || payload.refundRule !== row.calc_refund_rule ||
          payload.rounding !== row.calc_rounding) {
          skip("unresolvable_drift"); continue;
        }
        if (payloadMatchesHead(row, payload)) { skip("already_recorded"); continue; }
        const revisionPayload = {
          ...payload,
          effectKey: `${payload.effectKey}:r${row.calc_revision + 1}`,
          supersedesEffectKey: row.calc_effect_key,
        };
        const { error } = await client.rpc("record_commission_calculation", { p: revisionPayload });
        if (!error) { revised++; continue; }
        // 55000: the head already has posted journals, so it can never
        // be superseded. A designed refusal, not a failure — the count
        // surfaces it and the posting invariant governs the money.
        if (error.code === "55000") { supersedeRefused++; continue; }
        errors.push({ orderId, stage: "recheck", reason: "revision_rejected" });
        continue;
      }

      // Attribution gate: only an 'attributed' decision can produce a
      // calculation. Other outcomes are terminal skip reasons mirroring
      // the decision vocabulary.
      if (row.outcome === "self_referral") { skip("self_referral"); continue; }
      if (row.outcome === "partner_unavailable") { skip("partner_unavailable"); continue; }
      if (row.outcome !== "attributed") { skip("unattributed"); continue; }
      if (!row.affiliate_id) { skip("unattributed"); continue; }

      // Policy pre-checks exist only to learn the basis (the refund/basis
      // evidence depends on it) and to name basis_unavailable, which the
      // engine has no reason for. Every other decision is the engine's:
      // evaluateOrder below re-runs selection and validation and its skip
      // reason is what gets counted on any disagreement.
      if (policies.length === 0) { skip("no_policy"); continue; }
      if (!policies.every(policy => validEnginePolicy(policy))) { skip("invalid_policy"); continue; }
      const selected = policyForOrder(policies, canonical(row.order_at));
      if (!selected) { skip("no_policy"); continue; }
      if (snapshot.currency !== selected.currency) { skip("currency_mismatch"); continue; }
      if (selected.basis !== "order_total") { skip("basis_unavailable"); continue; }
      const refundedBasisAmount = orderTotalRefundedBasis(snapshot);
      if (refundedBasisAmount === null) { skip("basis_unavailable"); continue; }

      const evaluation = evaluateOrder({
        order: {
          id: snapshot.id, status: snapshot.status, currency: snapshot.currency,
          createdAt: canonical(row.order_at),
          paidAt: snapshot.paidAt === null ? null : canonical(snapshot.paidAt),
          basisAmount: snapshot.total, refundedBasisAmount,
        },
        attribution: { affiliateId: row.affiliate_id },
        policies,
      });
      if (evaluation.kind === "skip") { skip(evaluation.reason); continue; }
      const { error } = await client.rpc("record_commission_calculation", { p: recordPayload(evaluation) });
      if (error) { errors.push({ orderId, stage: "recording", reason: "record_rejected" }); continue; }
      recorded++;
    } catch {
      errors.push({ orderId, stage: "recording", reason: "rpc_failed" });
    }
  }
  return Object.freeze({ recorded, revised, supersedeRefused,
    skipped: Object.freeze(skipped), errors: Object.freeze(errors) });
}

// Bounded RPC transport, matching the Woo and posting workers: no
// credentials or provider error bodies are logged.
const databaseFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, signal: init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
});

function workerClient(env: Environment): RecordingClient {
  const config = postingConfiguration(env);
  if (!config) throw new Error("Recording not configured");
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: databaseFetch },
  }) as unknown as RecordingClient;
}

/**
 * Recording deliberately rides the posting gate (COMMISSION_POSTING_ENABLED
 * and the COMMISSION_* configuration): one operational switch activates
 * the whole Phase 4 worker chain. Recording alone moves no money, but its
 * rows are the posting worker's input — enabling it separately would
 * silently accumulate unposted records under a flag named for something
 * else.
 */
export async function runRecordingWorker(env: Environment = process.env): Promise<RecordingBatchResult> {
  return runRecordingBatch(workerClient(env));
}
