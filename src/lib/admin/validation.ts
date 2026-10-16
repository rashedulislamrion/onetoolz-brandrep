export function validFactorCode(factorId: unknown, code: unknown): boolean {
  return typeof factorId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(factorId)
    && typeof code === "string" && /^\d{6}$/.test(code);
}

export function parseReview(form: FormData) {
  const id = form.get("applicationId");
  const decision = form.get("decision");
  const reason = form.get("reason");
  if (typeof id !== "string" || !validFactorCode(id, "000000") || (decision !== "approved" && decision !== "rejected") || typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 1000 || form.get("confirmed") !== "yes") return null;
  return { id, decision, reason: reason.trim() };
}

export function reviewPage(value: string | undefined): number {
  if (!value || !/^[1-9]\d{0,3}$/.test(value)) return 1;
  return Math.min(Number(value), 1000);
}