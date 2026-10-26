import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { formatMinorToDecimal, mapPayoutOverview } from "@/lib/payouts/overview";
import { SubmitButton } from "@/components/submit-button";
import { cancelPayout, requestPayout } from "./actions";

export const metadata = { title: "Payouts" };

const notices: Record<string, string> = {
  requested: "Payout requested. The amount is now reserved from your available balance while an administrator reviews it.",
  cancelled: "Payout cancelled. The reservation was released back to your available balance.",
  failed: "The payout change could not be completed. Refresh to check the latest state before retrying; a duplicate request with the same key is safe.",
  invalid: "Check the amount and currency, and confirm the change. Amounts must be exact and at or above the published minimum.",
};

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { client } = await requireAccess("affiliate");
  const params = await searchParams;
  // Affiliate payout overview is own-rows only. Any failure — including
  // the payouts migration not being installed — fails closed to the
  // unavailable notice; balances are never rendered as zero on error.
  let overview = null;
  try {
    const { data, error } = await client.rpc("affiliate_payout_overview");
    if (!error) overview = mapPayoutOverview(data);
  } catch { overview = null; }
  return <section className="section content-page"><span className="eyebrow">PARTNER / PAYOUTS</span>
    <h1>Request a payout.</h1>
    <p>Requesting a payout reserves the amount from your available balance immediately, so it cannot be requested twice. An administrator reviews every request. <strong>Settlement is manual:</strong> the OneToolz team sends money outside BrandRep and records the transfer reference here — BrandRep never sends money automatically, and an approved request is paid only when a settlement reference appears on it.</p>
    {params.notice && notices[params.notice] && <p className="notice" role="status">{notices[params.notice]}</p>}
    {overview === null
      ? <p className="notice" role="alert"><strong>Payouts are not connected</strong><br />Balances and payout requests are unavailable right now. Nothing shown here should be read as a zero balance.</p>
      : <>
        {overview.currencies.length === 0 && <p className="notice">No payout currencies are connected to your account yet. A currency appears here once commission releases create a balance or a program policy is published.</p>}
        {overview.currencies.map(currency => <article className="feature-card" key={currency.currency}>
          <h2>{currency.currency} balance</h2>
          <p>Available for payout: <strong>{formatMinorToDecimal(currency.payableMinor, currency.exponent)} {currency.currency}</strong> ({currency.payableMinor} minor units)</p>
          <p>Reserved by open requests: <strong>{formatMinorToDecimal(currency.reservedMinor, currency.exponent)} {currency.currency}</strong> ({currency.reservedMinor} minor units)</p>
          {currency.minimumPayoutMinor === null
            ? <p className="field-help">No published program policy covers {currency.currency}; payout requests are not accepted for it.</p>
            : <><p className="field-help">Published minimum payout: {formatMinorToDecimal(currency.minimumPayoutMinor, currency.exponent)} {currency.currency}. Payout cadence: {currency.payoutCadence ?? "not recorded"} — cadence is the program&apos;s review rhythm, not a payment promise.</p>
              <form action={requestPayout}><input type="hidden" name="requestKey" value={randomUUID()} /><input type="hidden" name="currency" value={currency.currency} />
                <label>Payout amount ({currency.currency})<input name="amount" inputMode="decimal" placeholder="0.00" required /></label>
                <SubmitButton>Request payout</SubmitButton></form></>}
        </article>)}
        <article className="feature-card"><h2>Your payout requests</h2>
          {overview.requests.length === 0
            ? <p className="muted">No payout requests yet.</p>
            : <div className="table-scroll"><table><thead><tr><th scope="col">Requested</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Settlement reference</th><th scope="col">Action</th></tr></thead><tbody>
              {overview.requests.map(request => { const exponent = overview.currencies.find(entry => entry.currency === request.currency)?.exponent; return <tr key={request.id}><td>{request.createdAt.slice(0, 10)}</td>
                <td>{exponent !== undefined ? <>{formatMinorToDecimal(request.amountMinor, exponent)} {request.currency} ({request.amountMinor} minor units)</> : <>{request.amountMinor} minor units ({request.currency})</>}</td>
                <td>{request.status}{request.failureReason ? <> — {request.failureReason}</> : null}</td>
                <td>{request.externalReference ?? "—"}</td>
                <td>{request.status === "requested"
                  ? <form action={cancelPayout}><input type="hidden" name="requestId" value={request.id} /><label className="check-label"><input type="checkbox" name="confirmed" value="yes" required /> Release the reservation</label><SubmitButton>Cancel request</SubmitButton></form>
                  : "—"}</td></tr>; })}
            </tbody></table></div>}
        </article>
      </>}
    <div className="hero-actions"><Link className="text-link" href="/dashboard">← Command center</Link></div>
  </section>;
}
