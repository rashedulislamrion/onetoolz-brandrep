export function parsePolicyPublication(form: FormData) {
  const text = (name: string) => typeof form.get(name) === "string" ? (form.get(name) as string).trim() : "";
  const requestId = text("requestId");
  const draftRevision = text("draftRevision");
  const expectedVersion = text("expectedVersion");
  const currencyDecimals = text("currencyDecimals");
  const basis = text("basis");
  const refundRule = text("refundRule");
  const rounding = text("rounding");
  const qualification = text("qualification");
  const reason = text("reason");
  if (form.get("publishConfirmed") !== "yes" || requestId.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId) ||
    !/^[1-9][0-9]{0,8}$/.test(draftRevision) || !/^(0|[1-9][0-9]{0,8})$/.test(expectedVersion) ||
    !/^[0-6]$/.test(currencyDecimals) || !["net_items", "order_total"].includes(basis) ||
    !["proportional", "full_on_any_refund"].includes(refundRule) ||
    !["half_up", "down"].includes(rounding) || qualification !== "paid_completed" ||
    reason.length < 10 || reason.length > 1000) return null;
  return { requestId: requestId.toLowerCase(), draftRevision: Number(draftRevision), expectedVersion: Number(expectedVersion),
    currencyDecimals: Number(currencyDecimals), basis, refundRule, rounding, qualification, reason };
}