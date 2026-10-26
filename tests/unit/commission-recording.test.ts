import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { orderTotalRefundedBasis, parseStoredSnapshot, runRecordingBatch,
  type PolicyRow, type RecordingClient, type RecordingScanRow } from "../../src/lib/ledger/recording";
import type { OrderSnapshot } from "../../src/lib/woocommerce/orders";

const AFFILIATE = "20000000-0000-4000-8000-000000000091";

function policy(overrides: Partial<PolicyRow> = {}): PolicyRow {
  return {
    version: 1, effective_at: "2026-01-01T00:00:00.000Z", commission_bps: 1000,
    currency: "USD", currency_decimals: 2, minimum_payout: "25", hold_days: 30,
    basis: "order_total", refund_rule: "proportional", scope: "all_products_one_time",
    rounding: "half_up", qualification: "paid_completed", ...overrides,
  };
}

function snapshot(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  return {
    id: "7001", status: "completed", currency: "USD", total: "100.00",
    paymentMethod: "piprapay", paidAt: "2026-01-10T10:05:00Z",
    modifiedAt: "2026-01-10T10:05:00Z",
    refunds: [{ id: "1", total: "-25.00" }], commissionEnabled: false,
    ...overrides,
  };
}

function scanRow(overrides: Partial<RecordingScanRow> = {}): RecordingScanRow {
  return {
    order_id: "7001", order_at: "2026-01-10T10:00:00.000Z", outcome: "attributed",
    affiliate_id: AFFILIATE, snapshot: snapshot(),
    calc_effect_key: null, calc_revision: null, calc_affiliate_id: null,
    calc_basis: null, calc_currency: null, calc_currency_decimals: null,
    calc_refund_rule: null, calc_rounding: null, calc_basis_minor: null,
    calc_refunded_basis_minor: null, calc_gross_minor: null,
    calc_reversal_minor: null, calc_net_minor: null, calc_qualification: null,
    calc_unqualified_reason: null, calc_hold_until: null,
    calc_policy_version: null, ...overrides,
  };
}

/** A scan row whose order already has a recorded HEAD: the default
 * snapshot (total 100.00, one -25.00 refund, completed + paid) evaluated
 * under the default policy — basis 10000, gross 1000, reversal 250,
 * net 750, qualified, hold until order_at + 30 days. */
function recordedRow(overrides: Partial<RecordingScanRow> = {}): RecordingScanRow {
  return scanRow({
    calc_effect_key: "commission:order:7001:policy:1", calc_revision: 1,
    calc_affiliate_id: AFFILIATE, calc_basis: "order_total",
    calc_currency: "USD", calc_currency_decimals: 2,
    calc_refund_rule: "proportional", calc_rounding: "half_up",
    calc_basis_minor: "10000", calc_refunded_basis_minor: "2500",
    calc_gross_minor: "1000", calc_reversal_minor: "250", calc_net_minor: "750",
    calc_qualification: "qualified", calc_unqualified_reason: null,
    calc_hold_until: "2026-02-09T10:00:00.000Z", calc_policy_version: 1,
    ...overrides,
  });
}

type StoredRow = Record<string, unknown> & {
  revision: number; superseded: boolean; posted: boolean;
};

const CONTENT_KEYS = ["effectKey", "orderId", "affiliateId", "policyVersion",
  "currency", "currencyDecimals", "basis", "refundRule", "rounding",
  "basisMinor", "refundedBasisMinor", "grossMinor", "reversalMinor",
  "netMinor", "qualification", "unqualifiedReason", "holdUntil"];
const IDENTITY_KEYS = ["affiliateId", "currency", "currencyDecimals",
  "basis", "refundRule", "rounding"];
const MATERIAL_KEYS = ["qualification", "unqualifiedReason", "basisMinor",
  "refundedBasisMinor", "grossMinor", "reversalMinor", "netMinor", "holdUntil"];
const sameFields = (a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) =>
  keys.every(key => JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null));

/** In-memory stand-in for the recording RPC surface, including the
 * record RPC v2 semantics: effect-key idempotency/conflicts, first
 * record per (order, policy), and supersede revisions — the head must
 * match supersedesEffectKey, identity must match, a material field must
 * differ, and a posted head refuses with SQLSTATE 55000. Scan rows that
 * carry a recorded head seed the store, mirroring earlier recordings. */
function mockClient(policies: PolicyRow[], rows: RecordingScanRow[],
  options: { postedEffectKeys?: string[] } = {}) {
  const postedKeys = new Set(options.postedEffectKeys ?? []);
  const stored: StoredRow[] = [];
  for (const row of rows) {
    if (row.calc_basis === null || !row.calc_effect_key) continue;
    stored.push({
      effectKey: row.calc_effect_key, orderId: row.order_id,
      affiliateId: row.calc_affiliate_id, policyVersion: row.calc_policy_version,
      currency: row.calc_currency, currencyDecimals: row.calc_currency_decimals,
      basis: row.calc_basis, refundRule: row.calc_refund_rule,
      rounding: row.calc_rounding, basisMinor: row.calc_basis_minor,
      refundedBasisMinor: row.calc_refunded_basis_minor,
      grossMinor: row.calc_gross_minor, reversalMinor: row.calc_reversal_minor,
      netMinor: row.calc_net_minor, qualification: row.calc_qualification,
      unqualifiedReason: row.calc_unqualified_reason, holdUntil: row.calc_hold_until,
      revision: row.calc_revision ?? 1, superseded: false,
      posted: postedKeys.has(row.calc_effect_key),
    });
  }
  const recordedPayloads: Record<string, unknown>[] = [];
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === "list_program_policies_for_recording") return { data: policies, error: null };
    if (fn === "list_orders_for_commission_recording") {
      return { data: rows.slice(0, (args?.p_limit as number) ?? 50), error: null };
    }
    if (fn === "record_commission_calculation") {
      const payload = args?.p as Record<string, unknown>;
      const byKey = stored.find(r => r.effectKey === payload.effectKey);
      if (byKey) {
        return sameFields(byKey, payload, CONTENT_KEYS)
          ? { data: "60000000-0000-4000-8000-000000000001", error: null }
          : { data: null, error: { code: "22023" } };
      }
      const supersedes = payload.supersedesEffectKey as string | undefined;
      if (supersedes) {
        const head = stored.find(r => r.orderId === payload.orderId &&
          r.policyVersion === payload.policyVersion && !r.superseded);
        if (!head || head.effectKey !== supersedes ||
          !sameFields(head, payload, IDENTITY_KEYS) ||
          sameFields(head, payload, MATERIAL_KEYS)) {
          return { data: null, error: { code: "22023" } };
        }
        if (head.posted) return { data: null, error: { code: "55000" } };
        head.superseded = true;
        stored.push({ ...payload, revision: head.revision + 1, superseded: false, posted: false });
        recordedPayloads.push(payload);
        return { data: "60000000-0000-4000-8000-000000000002", error: null };
      }
      if (stored.some(r => r.orderId === payload.orderId && r.policyVersion === payload.policyVersion)) {
        return { data: null, error: { code: "22023" } };
      }
      stored.push({ ...payload, revision: 1, superseded: false, posted: false });
      recordedPayloads.push(payload);
      return { data: "60000000-0000-4000-8000-000000000001", error: null };
    }
    return { data: null, error: { code: "42883" } };
  });
  return { client: { rpc } as unknown as RecordingClient, recordedPayloads, stored, rpc };
}

describe("stored snapshot validation and refund evidence", () => {
  it("rejects stored-shape drift and accepts the stored contract", () => {
    expect(parseStoredSnapshot(snapshot())).not.toBeNull();
    expect(parseStoredSnapshot({ ...snapshot(), commissionEnabled: true })).toBeNull();
    expect(parseStoredSnapshot({ ...snapshot(), refunds: [{ id: "1", total: "abc" }] })).toBeNull();
    expect(parseStoredSnapshot({ ...snapshot(), refunds: [
      { id: "1", total: "-1.00" }, { id: "1", total: "-2.00" }] })).toBeNull();
    expect(parseStoredSnapshot(null)).toBeNull();
  });

  it("sums refund magnitudes exactly for the order_total basis", () => {
    expect(orderTotalRefundedBasis(snapshot())).toBe("25");
    expect(orderTotalRefundedBasis(snapshot({ refunds: [
      { id: "1", total: "-10.00" }, { id: "2", total: "-15.50" }] }))).toBe("25.5");
    expect(orderTotalRefundedBasis(snapshot({ refunds: [] }))).toBe("0");
    // A positive refund total contradicts the Woo evidence shape.
    expect(orderTotalRefundedBasis(snapshot({ refunds: [{ id: "1", total: "5.00" }] }))).toBeNull();
  });
});

describe("commission recording worker", () => {
  it("records a qualified order_total calculation once, with exact payload amounts", async () => {
    const { client, recordedPayloads } = mockClient([policy()], [scanRow()]);
    const result = await runRecordingBatch(client);
    expect(result.recorded).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(recordedPayloads).toHaveLength(1);
    expect(recordedPayloads[0]).toMatchObject({
      effectKey: "commission:order:7001:policy:1", orderId: "7001", affiliateId: AFFILIATE,
      policyVersion: 1, currency: "USD", currencyDecimals: 2, basis: "order_total",
      refundRule: "proportional", rounding: "half_up",
      basisMinor: "10000", refundedBasisMinor: "2500", grossMinor: "1000",
      reversalMinor: "250", netMinor: "750", qualification: "qualified",
      unqualifiedReason: null, holdUntil: "2026-02-09T10:00:00.000Z",
    });
    // Rerun against the same unrecorded scan is idempotent at the RPC.
    const rerun = await runRecordingBatch(client);
    expect(rerun.recorded).toBe(1);
    expect(recordedPayloads).toHaveLength(1);
  });

  it("records unqualified estimates for orders that have not completed or paid", async () => {
    const { client, recordedPayloads } = mockClient([policy()], [
      scanRow({ snapshot: snapshot({ status: "processing", paidAt: null }) }),
    ]);
    const result = await runRecordingBatch(client);
    expect(result.recorded).toBe(1);
    expect(recordedPayloads[0]).toMatchObject({ qualification: "unqualified", unqualifiedReason: "not_completed" });
  });

  it("skips non-attributed decisions by their outcome, without recording", async () => {
    const { client, recordedPayloads } = mockClient([policy()], [
      scanRow({ order_id: "7002", outcome: "unattributed", affiliate_id: null, snapshot: snapshot({ id: "7002" }) }),
      scanRow({ order_id: "7003", outcome: "self_referral", snapshot: snapshot({ id: "7003" }) }),
      scanRow({ order_id: "7004", outcome: "partner_unavailable", affiliate_id: null, snapshot: snapshot({ id: "7004" }) }),
    ]);
    const result = await runRecordingBatch(client);
    expect(result.recorded).toBe(0);
    expect(result.skipped).toEqual({ unattributed: 1, self_referral: 1, partner_unavailable: 1 });
    expect(recordedPayloads).toHaveLength(0);
  });

  it("skips net_items policies as basis_unavailable: snapshots hold no line items", async () => {
    const { client, recordedPayloads } = mockClient([policy({ basis: "net_items" })], [scanRow()]);
    const result = await runRecordingBatch(client);
    expect(result.recorded).toBe(0);
    expect(result.skipped).toEqual({ basis_unavailable: 1 });
    expect(recordedPayloads).toHaveLength(0);
  });

  it("skips orders with a refund sign anomaly as basis_unavailable", async () => {
    const { client } = mockClient([policy()], [
      scanRow({ snapshot: snapshot({ refunds: [{ id: "1", total: "5.00" }] }) }),
    ]);
    const result = await runRecordingBatch(client);
    expect(result.skipped).toEqual({ basis_unavailable: 1 });
  });

  it("skips orders predating every policy and currency mismatches", async () => {
    const { client } = mockClient([policy()], [
      scanRow({ order_at: "2025-12-01T10:00:00.000Z" }),
      scanRow({ order_id: "7005", snapshot: snapshot({ id: "7005", currency: "EUR" }) }),
      scanRow({ order_id: "7006", snapshot: snapshot({ id: "7006", total: "0.00", refunds: [] }) }),
    ]);
    const result = await runRecordingBatch(client);
    expect(result.skipped).toEqual({ no_policy: 1, currency_mismatch: 1, zero_basis: 1 });
  });

  it("isolates a corrupt snapshot so later orders still record", async () => {
    const { client, recordedPayloads } = mockClient([policy()], [
      scanRow({ snapshot: { bogus: true } }),
      scanRow({ order_id: "7007", snapshot: snapshot({ id: "7007" }) }),
    ]);
    const result = await runRecordingBatch(client);
    expect(result.recorded).toBe(1);
    expect(result.errors).toEqual([{ orderId: "7001", stage: "recording", reason: "invalid_snapshot" }]);
    expect(recordedPayloads[0].orderId).toBe("7007");
  });

  it("records a revision when refunds grow on a recorded order", async () => {
    const { client, stored, rpc } = mockClient([policy()], [
      recordedRow({ snapshot: snapshot({ refunds: [{ id: "1", total: "-40.00" }] }) }),
    ]);
    const result = await runRecordingBatch(client);
    expect(result.recorded).toBe(0);
    expect(result.revised).toBe(1);
    expect(result.supersedeRefused).toBe(0);
    const revision = stored.find(r => r.effectKey === "commission:order:7001:policy:1:r2");
    expect(revision).toMatchObject({ refundedBasisMinor: "4000", reversalMinor: "400",
      netMinor: "600", revision: 2, superseded: false });
    expect(stored.find(r => r.effectKey === "commission:order:7001:policy:1")?.superseded).toBe(true);
    const call = rpc.mock.calls.find(c => c[0] === "record_commission_calculation");
    expect((call?.[1] as { p: Record<string, unknown> }).p).toMatchObject({
      effectKey: "commission:order:7001:policy:1:r2",
      supersedesEffectKey: "commission:order:7001:policy:1",
    });
  });

  it("records a revision when qualification flips on a recorded order", async () => {
    const { client, stored } = mockClient([policy()], [
      recordedRow({ calc_qualification: "unqualified", calc_unqualified_reason: "not_completed",
        snapshot: snapshot({ status: "completed", paidAt: "2026-01-10T10:05:00Z" }) }),
    ]);
    const result = await runRecordingBatch(client);
    expect(result.revised).toBe(1);
    expect(result.skipped).toEqual({});
    const revision = stored.find(r => r.effectKey === "commission:order:7001:policy:1:r2");
    expect(revision).toMatchObject({ qualification: "qualified", unqualifiedReason: null });
  });

  it("treats an unchanged recorded order as already_recorded, not drift", async () => {
    const { client, rpc } = mockClient([policy()], [recordedRow()]);
    const result = await runRecordingBatch(client);
    expect(result.revised).toBe(0);
    expect(result.skipped).toEqual({ already_recorded: 1 });
    expect(rpc.mock.calls.some(call => call[0] === "record_commission_calculation")).toBe(false);
  });

  it("treats a head that already is the current revision as already_recorded", async () => {
    const { client, rpc } = mockClient([policy()], [
      recordedRow({ calc_effect_key: "commission:order:7001:policy:1:r2", calc_revision: 2,
        calc_refunded_basis_minor: "4000", calc_reversal_minor: "400", calc_net_minor: "600",
        snapshot: snapshot({ refunds: [{ id: "1", total: "-40.00" }] }) }),
    ]);
    const result = await runRecordingBatch(client);
    expect(result.revised).toBe(0);
    expect(result.skipped).toEqual({ already_recorded: 1 });
    expect(rpc.mock.calls.some(call => call[0] === "record_commission_calculation")).toBe(false);
  });

  it("counts drift on a posted head as supersedeRefused and never rewrites it", async () => {
    const { client, stored } = mockClient([policy()], [
      recordedRow({ snapshot: snapshot({ refunds: [{ id: "1", total: "-40.00" }] }) }),
    ], { postedEffectKeys: ["commission:order:7001:policy:1"] });
    const result = await runRecordingBatch(client);
    expect(result.revised).toBe(0);
    expect(result.supersedeRefused).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(stored.filter(r => !r.superseded)).toHaveLength(1);
  });
});
