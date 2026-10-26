import { describe, expect, it } from "vitest";
import { evaluateOrder, journalIntentFor, recomputeForRefund, reversalJournalIntentFor,
  validEnginePolicy, type EnginePolicy } from "@/lib/ledger/engine";
import { validateJournal } from "@/lib/ledger/journal";

const AFFILIATE = "20000000-0000-4000-8000-000000000091";
const EXPENSE = "30000000-0000-4000-8000-000000000001";
const HELD = "30000000-0000-4000-8000-000000000002";
const policy: EnginePolicy = { version: 1, effectiveAt: "2026-10-16T10:00:00.000Z", commissionBps: 1000,
  currency: "USD", currencyDecimals: 2, basis: "net_items", refundRule: "proportional", scope: "all_products_one_time",
  rounding: "half_up", qualification: "paid_completed", holdDays: 30, minimumPayout: "25" };
const order = { id: "5001", status: "completed", currency: "USD", createdAt: "2026-10-17T10:00:00.000Z",
  paidAt: "2026-10-17T10:05:00.000Z", basisAmount: "100.00", refundedBasisAmount: "0" };
const evaluate = (overrides: Record<string, unknown> = {}, policies: readonly EnginePolicy[] = [policy],
  attribution: { affiliateId: string } | null = { affiliateId: AFFILIATE }) =>
  evaluateOrder({ order: { ...order, ...overrides } as typeof order, attribution, policies });

describe("commission engine skip paths", () => {
  it("skips unattributed orders", () => {
    expect(evaluate({}, [policy], null)).toEqual({ kind: "skip", reason: "unattributed" });
  });
  it("skips when no policy is effective at order time", () => {
    expect(evaluate({ createdAt: "2026-10-16T09:59:59.999Z" })).toEqual({ kind: "skip", reason: "no_policy" });
    expect(evaluate({}, [])).toEqual({ kind: "skip", reason: "no_policy" });
  });
  it("skips invalid policies instead of guessing rules", () => {
    expect(evaluate({}, [{ ...policy, rounding: "nearest" } as unknown as EnginePolicy])).toEqual({ kind: "skip", reason: "invalid_policy" });
    expect(evaluate({}, [{ ...policy, qualification: "completed_only" } as unknown as EnginePolicy])).toEqual({ kind: "skip", reason: "invalid_policy" });
    expect(validEnginePolicy(policy)).toBe(true);
    expect(validEnginePolicy({ ...policy, holdDays: 366 })).toBe(false);
  });
  it("skips currency mismatches and zero basis", () => {
    expect(evaluate({ currency: "BDT" })).toEqual({ kind: "skip", reason: "currency_mismatch" });
    expect(evaluate({ basisAmount: "0.00" })).toEqual({ kind: "skip", reason: "zero_basis" });
  });
  it("skips malformed orders and refund overflow", () => {
    expect(evaluate({ createdAt: "2026-10-17" })).toEqual({ kind: "skip", reason: "invalid_order" });
    expect(evaluate({ refundedBasisAmount: "100.01" })).toEqual({ kind: "skip", reason: "invalid_order" });
    expect(evaluate({}, [policy], { affiliateId: "not-a-uuid" })).toEqual({ kind: "skip", reason: "invalid_order" });
  });
});

describe("commission engine qualification", () => {
  it("qualifies a paid + completed order and computes holdUntil from order creation", () => {
    const result = evaluate();
    expect(result).toMatchObject({ kind: "calculation", orderId: "5001", affiliateId: AFFILIATE, policyVersion: 1,
      qualification: "qualified", holdUntil: "2026-11-16T10:00:00.000Z", effectKey: "commission:order:5001:policy:1" });
    if (result.kind !== "calculation") throw new Error("expected calculation");
    expect(result.quote).toMatchObject({ grossCommissionMinor: "1000", netCommissionMinor: "1000", reversalMinor: "0", rounding: "half_up" });
    expect(result.unqualifiedReason).toBeUndefined();
  });
  it("keeps non-completed orders as unqualified estimates, not earnings", () => {
    const result = evaluate({ status: "processing" });
    expect(result).toMatchObject({ kind: "calculation", qualification: "unqualified", unqualifiedReason: "not_completed" });
    if (result.kind !== "calculation") throw new Error("expected calculation");
    expect(result.quote.netCommissionMinor).toBe("1000");
  });
  it("keeps completed-but-unpaid orders unqualified with not_paid", () => {
    expect(evaluate({ paidAt: null })).toMatchObject({ kind: "calculation", qualification: "unqualified", unqualifiedReason: "not_paid" });
  });
  it("selects the policy effective at order time across versions", () => {
    const later = { ...policy, version: 2, effectiveAt: "2026-11-01T10:00:00.000Z", commissionBps: 2000 };
    expect(evaluate({}, [later, policy])).toMatchObject({ kind: "calculation", policyVersion: 1 });
    expect(evaluate({ createdAt: "2026-11-02T10:00:00.000Z" }, [policy, later])).toMatchObject({ kind: "calculation", policyVersion: 2 });
  });
});

describe("commission engine policy rounding", () => {
  // 5 minor * 10% = 0.5 minor: half_up rounds to 1, down truncates to 0.
  const tiny = { basisAmount: "0.05" };
  it("uses the policy's own rounding — half_up", () => {
    const result = evaluate(tiny);
    if (result.kind !== "calculation") throw new Error("expected calculation");
    expect(result.quote.grossCommissionMinor).toBe("1");
  });
  it("uses the policy's own rounding — down differs by exactly one minor unit", () => {
    const result = evaluate(tiny, [{ ...policy, rounding: "down" }]);
    if (result.kind !== "calculation") throw new Error("expected calculation");
    expect(result.quote.grossCommissionMinor).toBe("0");
  });
});

describe("commission engine refund recompute", () => {
  it("reconciles two sequential refunds to a full reversal without drift", () => {
    const initial = evaluate({ basisAmount: "10.05" });
    if (initial.kind !== "calculation") throw new Error("expected calculation");
    expect(initial.quote.grossCommissionMinor).toBe("101"); // 100.5 half_up
    const step1 = recomputeForRefund(policy, initial.quote, "5.03");
    expect(step1).not.toBeNull();
    expect(step1!.quote).toMatchObject({ netCommissionMinor: "50", reversalMinor: "51" });
    expect(step1!.deltaReversalMinor).toBe("51");
    const step2 = recomputeForRefund(policy, step1!.quote, "10.05");
    expect(step2).not.toBeNull();
    expect(step2!.quote).toMatchObject({ netCommissionMinor: "0", reversalMinor: "101" });
    expect(step2!.deltaReversalMinor).toBe("50");
    expect(BigInt(step1!.deltaReversalMinor) + BigInt(step2!.deltaReversalMinor)).toBe(101n);
  });
  it("rejects recompute against a different policy or an excessive refund", () => {
    const initial = evaluate();
    if (initial.kind !== "calculation") throw new Error("expected calculation");
    expect(recomputeForRefund({ ...policy, version: 2 }, initial.quote, "1.00")).toBeNull();
    expect(recomputeForRefund(policy, initial.quote, "100.01")).toBeNull();
  });
});

describe("commission engine journal intents", () => {
  const accounts = { platformExpenseAccountId: EXPENSE, affiliateHeldAccountId: HELD };
  it("builds a balanced earn intent that validateJournal accepts", () => {
    const result = evaluate();
    if (result.kind !== "calculation") throw new Error("expected calculation");
    const intent = journalIntentFor(result, accounts);
    expect(intent).not.toBeNull();
    expect(validateJournal(intent)).toEqual(intent);
    expect(intent!.effectKey).toBe("commission:order:5001:policy:1");
    expect(intent!.lines).toEqual([
      expect.objectContaining({ accountId: EXPENSE, debitMinor: "1000", creditMinor: "0" }),
      expect.objectContaining({ accountId: HELD, debitMinor: "0", creditMinor: "1000" }),
    ]);
  });
  it("refuses earn intents for unqualified calculations", () => {
    const result = evaluate({ status: "processing" });
    if (result.kind !== "calculation") throw new Error("expected calculation");
    expect(journalIntentFor(result, accounts)).toBeNull();
  });
  it("returns null for zero net amounts", () => {
    const result = evaluate({}, [{ ...policy, rounding: "down" }], { affiliateId: AFFILIATE });
    const tiny = evaluateOrder({ order: { ...order, basisAmount: "0.05" }, attribution: { affiliateId: AFFILIATE }, policies: [{ ...policy, rounding: "down" }] });
    expect(result.kind).toBe("calculation");
    if (tiny.kind !== "calculation") throw new Error("expected calculation");
    expect(tiny.quote.netCommissionMinor).toBe("0");
    expect(journalIntentFor(tiny, accounts)).toBeNull();
  });
  it("builds a balanced reversal intent in the opposite direction, keyed by refund state", () => {
    const initial = evaluate({ basisAmount: "10.05" });
    if (initial.kind !== "calculation") throw new Error("expected calculation");
    const step = recomputeForRefund(policy, initial.quote, "5.03")!;
    const refundedCalc = { ...initial, quote: step.quote };
    const intent = reversalJournalIntentFor(refundedCalc, step.deltaReversalMinor, accounts);
    expect(intent).not.toBeNull();
    expect(validateJournal(intent)).toEqual(intent);
    expect(intent!.effectKey).toBe("commission:order:5001:policy:1:refund:503");
    expect(intent!.lines).toEqual([
      expect.objectContaining({ accountId: HELD, debitMinor: "51", creditMinor: "0" }),
      expect.objectContaining({ accountId: EXPENSE, debitMinor: "0", creditMinor: "51" }),
    ]);
    expect(reversalJournalIntentFor(refundedCalc, "0", accounts)).toBeNull();
  });
  it("fails closed when the two accounts are identical or malformed", () => {
    const result = evaluate();
    if (result.kind !== "calculation") throw new Error("expected calculation");
    expect(journalIntentFor(result, { platformExpenseAccountId: EXPENSE, affiliateHeldAccountId: EXPENSE })).toBeNull();
    expect(journalIntentFor(result, { platformExpenseAccountId: "nope", affiliateHeldAccountId: HELD })).toBeNull();
  });
});
