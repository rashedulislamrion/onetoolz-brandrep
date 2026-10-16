export type OrderSnapshot = {
  id: string; status: string; currency: string; total: string;
  paymentMethod: string; paidAt: string | null; modifiedAt: string;
  refunds: { id: string; total: string }[];
  commissionEnabled: false;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}Z`));
}
export function orderSnapshot(value: unknown): OrderSnapshot {
  if (!record(value) || !id(value.id) || typeof value.status !== "string" || !/^[a-z][a-z0-9-]{0,49}$/.test(value.status) ||
    typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) ||
    typeof value.total !== "string" || !/^\d{1,18}(\.\d{1,8})?$/.test(value.total) ||
    typeof value.payment_method !== "string" || value.payment_method.length > 100 ||
    !date(value.date_modified_gmt) || (value.date_paid_gmt !== null && !date(value.date_paid_gmt)) ||
    !Array.isArray(value.refunds) || value.refunds.length > 10000) throw new Error("INVALID_ORDER");
  const refunds = value.refunds.map(refund => {
    if (!record(refund) || !id(refund.id) || typeof refund.total !== "string" || !/^-?\d{1,18}(\.\d{1,8})?$/.test(refund.total)) throw new Error("INVALID_REFUND");
    return { id: String(refund.id), total: refund.total };
  });
  if (new Set(refunds.map(refund => refund.id)).size !== refunds.length) throw new Error("DUPLICATE_REFUND");
  // Woo's paid timestamp is recorded, NOT interpreted as verified PipraPay settlement.
  // No product-name heuristics, recurrence classification or eligibility awards.
  return { id: String(value.id), status: value.status, currency: value.currency, total: value.total,
    paymentMethod: value.payment_method, paidAt: value.date_paid_gmt === null ? null : `${value.date_paid_gmt}Z`,
    modifiedAt: `${value.date_modified_gmt}Z`, refunds, commissionEnabled: false };
}

export type RefreshJob = { id: string; orderId: string; lease: string };
export type RefreshRepository = {
  claim(): Promise<RefreshJob | null>;
  complete(job: RefreshJob, snapshot: OrderSnapshot): Promise<void>;
  fail(job: RefreshJob, code: string): Promise<void>;
};

// Dependencies are injected so tests never contact the live store.
export async function refreshOne(repository: RefreshRepository, fetchOrder: (id: string) => Promise<unknown>) {
  const job = await repository.claim();
  if (!job) return false;
  try {
    const snapshot = orderSnapshot(await fetchOrder(job.orderId));
    if (snapshot.id !== job.orderId) throw new Error("ORDER_MISMATCH");
    await repository.complete(job, snapshot);
  } catch {
    // An outage/404/deletion notification must not silently erase payment or refund state.
    await repository.fail(job, "ORDER_REFRESH_FAILED");
  }
  return true;
}