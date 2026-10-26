import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { calculationFromRow, releaseDue, runPostingBatch,
  type CalculationRow, type PostingClient } from "../../src/lib/ledger/posting";
import type { Journal } from "../../src/lib/ledger/journal";

const AFFILIATE = "20000000-0000-4000-8000-000000000091";
const EXPENSE = "30000000-0000-4000-8000-000000000001";
const HELD = "30000000-0000-4000-8000-000000000002";
const PAYABLE = "30000000-0000-4000-8000-000000000003";

function row(overrides: Partial<CalculationRow> = {}): CalculationRow {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    effect_key: "commission:order:6001:policy:1", order_id: "6001", affiliate_id: AFFILIATE,
    policy_version: 1, currency: "USD", currency_decimals: 2, basis: "net_items",
    refund_rule: "proportional", rounding: "half_up", basis_minor: "1000",
    refunded_basis_minor: "200", gross_minor: "100", reversal_minor: "20", net_minor: "80",
    qualification: "qualified", unqualified_reason: null,
    hold_until: "2026-01-15T10:00:00.000Z", status: "recorded", created_at: "2025-12-16T10:00:00.000Z",
    ...overrides,
  };
}

type PostedJournal = Journal & { id: string };

/** In-memory stand-in for the migration 20261026030000 RPC surface,
 * including ledger.post_journal's effect-key idempotency semantics. */
function mockClient(rows: CalculationRow[]) {
  const journals: PostedJournal[] = [];
  let sequence = 0;
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === "list_commission_calculations") {
      let data = [...rows];
      if (args?.p_qualification) data = data.filter(r => r.qualification === args.p_qualification);
      if (args?.p_due_before) data = data.filter(r => r.hold_until !== null && r.hold_until <= (args.p_due_before as string));
      return { data: data.slice(0, (args?.p_limit as number) ?? 50), error: null };
    }
    if (fn === "get_or_create_commission_accounts") {
      return { data: { expenseAccountId: EXPENSE, heldAccountId: HELD, payableAccountId: PAYABLE }, error: null };
    }
    if (fn === "commission_posting_state") {
      const key = args?.p_effect_key as string;
      const earn = journals.find(j => j.effectKey === key);
      const reversalPosted = journals.filter(j => j.effectKey.startsWith(`${key}:refund:`))
        .reduce((sum, j) => sum + BigInt(j.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n)), 0n);
      return { data: { earnJournalId: earn?.id ?? null, earnMinor: earn ? earn.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n).toString() : null,
        reversalPostedMinor: reversalPosted.toString(), releaseJournalId: journals.find(j => j.effectKey === `${key}:release`)?.id ?? null }, error: null };
    }
    if (fn === "post_commission_journal") {
      const journal = args?.p_journal as Journal;
      const existing = journals.find(j => j.effectKey === journal.effectKey);
      if (existing) {
        const same = JSON.stringify(existing.lines) === JSON.stringify(journal.lines) && existing.reason === journal.reason;
        return same ? { data: existing.id, error: null } : { data: null, error: { code: "22023" } };
      }
      const id = `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
      journals.push({ ...journal, id });
      return { data: id, error: null };
    }
    return { data: null, error: { code: "42883" } };
  });
  return { client: { rpc } as unknown as PostingClient, journals, rpc };
}

describe("commission posting worker", () => {
  it("rebuilds engine calculations from rows and rejects shape drift", () => {
    const calculation = calculationFromRow(row());
    expect(calculation?.quote.netCommissionMinor).toBe("80");
    expect(calculation?.effectKey).toBe("commission:order:6001:policy:1");
    expect(calculationFromRow(row({ net_minor: "8.5" }))).toBeNull();
    expect(calculationFromRow(row({ qualification: "qualified", unqualified_reason: "not_paid" }))).toBeNull();
    expect(calculationFromRow(row({ hold_until: null }))).toBeNull();
  });

  it("posts the earn journal once and is idempotent on rerun", async () => {
    const { client, journals } = mockClient([row()]);
    const first = await runPostingBatch(client);
    expect(first).toMatchObject({ posted: 1, reversed: 0 });
    expect(first.errors).toHaveLength(0);
    expect(journals).toHaveLength(1);
    expect(journals[0].effectKey).toBe("commission:order:6001:policy:1");
    expect(journals[0].lines).toEqual([
      expect.objectContaining({ accountId: EXPENSE, debitMinor: "80", creditMinor: "0" }),
      expect.objectContaining({ accountId: HELD, debitMinor: "0", creditMinor: "80" }),
    ]);
    const second = await runPostingBatch(client);
    expect(second.posted).toBe(0);
    expect(journals).toHaveLength(1);
  });

  it("never double-counts a refund already netted into the earn posting", async () => {
    const { client, journals } = mockClient([row()]);
    await runPostingBatch(client);
    const rerun = await runPostingBatch(client);
    expect(rerun.reversed).toBe(0);
    expect(journals.filter(j => j.effectKey.includes(":refund:"))).toHaveLength(0);
  });

  it("posts only the delta reversal when credited exceeds the recorded net", async () => {
    const { client, journals, rpc } = mockClient([row()]);
    // Simulate an earn journal posted earlier for the gross amount (100)
    // before the refund state (reversal 20, net 80) was recorded.
    await rpc("post_commission_journal", { p_journal: {
      effectKey: "commission:order:6001:policy:1", currency: "USD", exponent: 2,
      reason: "Commission earned for order 6001 under policy 1",
      lines: [
        { accountId: EXPENSE, currency: "USD", exponent: 2, debitMinor: "100", creditMinor: "0" },
        { accountId: HELD, currency: "USD", exponent: 2, debitMinor: "0", creditMinor: "100" },
      ],
    } });
    const result = await runPostingBatch(client);
    expect(result.posted).toBe(0);
    expect(result.reversed).toBe(1);
    const reversal = journals.find(j => j.effectKey === "commission:order:6001:policy:1:refund:200");
    expect(reversal?.lines).toEqual([
      expect.objectContaining({ accountId: HELD, debitMinor: "20", creditMinor: "0" }),
      expect.objectContaining({ accountId: EXPENSE, debitMinor: "0", creditMinor: "20" }),
    ]);
    const rerun = await runPostingBatch(client);
    expect(rerun.reversed).toBe(0);
    expect(journals).toHaveLength(2);
  });

  it("skips unqualified estimates and zero-net calculations without posting", async () => {
    const { client, journals } = mockClient([
      row({ effect_key: "commission:order:6002:policy:1", order_id: "6002", qualification: "unqualified", unqualified_reason: "not_paid" }),
      row({ effect_key: "commission:order:6003:policy:1", order_id: "6003", basis_minor: "1000", refunded_basis_minor: "1000", gross_minor: "100", reversal_minor: "100", net_minor: "0" }),
    ]);
    const result = await runPostingBatch(client);
    expect(result.posted).toBe(0);
    expect(result.skipped.map(s => s.reason)).toEqual(["unqualified", "zero_amount"]);
    expect(journals).toHaveLength(0);
  });

  it("isolates a failing row so later rows still post", async () => {
    const bad = row({ effect_key: "commission:order:6004:policy:1", order_id: "6004", affiliate_id: "20000000-0000-4000-8000-0000000000ff" });
    const good = row({ effect_key: "commission:order:6005:policy:1", order_id: "6005" });
    const { client, journals, rpc } = mockClient([bad, good]);
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "get_or_create_commission_accounts" && args?.p_affiliate_id === bad.affiliate_id) {
        return { data: null, error: { code: "22023" } };
      }
      return base(fn, args);
    });
    const result = await runPostingBatch(client);
    expect(result.posted).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].effectKey).toBe(bad.effect_key);
    expect(journals).toHaveLength(1);
    expect(journals[0].effectKey).toBe(good.effect_key);
  });
});

describe("commission hold release", () => {
  const now = new Date("2026-02-01T00:00:00.000Z");

  it("releases a matured hold from held to payable exactly once", async () => {
    const { client, journals } = mockClient([row()]);
    await runPostingBatch(client);
    const first = await releaseDue(client, { now });
    expect(first.released).toBe(1);
    const release = journals.find(j => j.effectKey === "commission:order:6001:policy:1:release");
    expect(release?.lines).toEqual([
      expect.objectContaining({ accountId: HELD, debitMinor: "80", creditMinor: "0" }),
      expect.objectContaining({ accountId: PAYABLE, debitMinor: "0", creditMinor: "80" }),
    ]);
    const second = await releaseDue(client, { now });
    expect(second.released).toBe(0);
    expect(second.skipped.map(s => s.reason)).toEqual(["already_released"]);
    expect(journals).toHaveLength(2);
  });

  it("does not release before the hold matures or before posting", async () => {
    const { client, journals } = mockClient([row()]);
    const early = await releaseDue(client, { now: new Date("2026-01-01T00:00:00.000Z") });
    expect(early.released).toBe(0);
    const unposted = await releaseDue(client, { now });
    expect(unposted.released).toBe(0);
    expect(unposted.skipped.map(s => s.reason)).toEqual(["not_posted"]);
    expect(journals).toHaveLength(0);
  });

  it("releases only the credited remainder after a reversal", async () => {
    const { client, journals, rpc } = mockClient([row()]);
    await rpc("post_commission_journal", { p_journal: {
      effectKey: "commission:order:6001:policy:1", currency: "USD", exponent: 2,
      reason: "Commission earned for order 6001 under policy 1",
      lines: [
        { accountId: EXPENSE, currency: "USD", exponent: 2, debitMinor: "100", creditMinor: "0" },
        { accountId: HELD, currency: "USD", exponent: 2, debitMinor: "0", creditMinor: "100" },
      ],
    } });
    await runPostingBatch(client);
    const result = await releaseDue(client, { now });
    expect(result.released).toBe(1);
    const release = journals.find(j => j.effectKey.endsWith(":release"));
    expect(release?.lines[0].debitMinor).toBe("80");
  });
});
