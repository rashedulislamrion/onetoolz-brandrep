// Scenario math only. Never used for ledger postings or policy decisions.
export function earningsProjection(referrals: number, conversion: number, commission: number, yearly: boolean) {
  if (![referrals, conversion, commission].every(Number.isFinite) || referrals < 0 || referrals > 1000000 || conversion < 0 || conversion > 100 || commission < 0 || commission > 100000) return null;
  return Math.round(referrals * conversion / 100 * commission * (yearly ? 12 : 1) * 100) / 100;
}