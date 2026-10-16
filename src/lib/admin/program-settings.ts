export function parseProgramSettings(form: FormData) {
  const text = (name: string) => typeof form.get(name) === "string" ? (form.get(name) as string).trim() : "";
  const rate = text("commissionPercent");
  const currency = text("currency");
  const minimum = text("minimumPayout");
  const hold = text("holdDays");
  const cadence = text("payoutCadence");
  const reason = text("reason");
  const revision = text("revision");
  const requestId = text("requestId");
  if (form.get("confirmed") !== "yes" || !/^(0|[1-9]\d?|100)(\.\d{1,2})?$/.test(rate) ||
    !/^[A-Z]{3}$/.test(currency) || !/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(minimum) ||
    !/^(0|[1-9]\d{0,2})$/.test(hold) || Number(hold) > 365 ||
    !["manual", "weekly", "monthly"].includes(cadence) || reason.length < 10 || reason.length > 1000 ||
    !/^(0|[1-9]\d{0,8})$/.test(revision) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return null;
  const [whole, fraction = ""] = rate.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (basisPoints > 10000) return null;
  // Decimal string only; currency precision and commercial approval are publication gates.
  const [minimumWhole, minimumFraction = ""] = minimum.split(".");
  const normalizedFraction = minimumFraction.replace(/0+$/, "");
  return { basisPoints, currency, minimumPayout: minimumWhole + (normalizedFraction ? `.${normalizedFraction}` : ""),
    holdDays: Number(hold), payoutCadence: cadence, reason, revision: Number(revision), requestId: requestId.toLowerCase() };
}

export function percentageFromBasisPoints(value: number) {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}