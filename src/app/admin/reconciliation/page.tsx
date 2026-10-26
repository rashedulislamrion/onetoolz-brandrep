import { requireAccess } from "@/lib/auth/access";
import { formatReconciliationMinor, mapReconciliationOverview } from "@/lib/ledger/reconciliation";

export const metadata = { title: "Reconciliation" };

export default async function AdminReconciliationPage() {
  const { client } = await requireAccess("admin");
  // Reconciliation reads admin_reconciliation_overview() (administrator +
  // AAL2 in the RPC). Any failure — including the migration not being
  // installed — fails closed: a missing reading must never be presented
  // as a balanced ledger.
  let overview = null;
  try {
    const { data, error } = await client.rpc("admin_reconciliation_overview");
    if (!error) overview = mapReconciliationOverview(data);
  } catch { overview = null; }
  return <><div className="page-head"><div><span className="eyebrow">ADMINISTRATION / RECONCILIATION</span>
    <h1>Ledger reconciliation.</h1>
    <p className="lead">Every commission journal in the system moves value out of the platform expense source into affiliate buckets or clearing: earnings credit <em>held</em>, hold releases move <em>held → payable</em>, payout requests reserve <em>payable → reserved</em>, recorded settlements move <em>reserved → clearing</em>, and refund reversals return value to expense. So per currency, the debits accumulated on expense must equal the balances still sitting in held + payable + reserved + disputed + recovery + clearing. A mismatch means a journal outside those flows touched the ledger — investigate before any payout is settled.</p></div></div>
    {overview === null
      ? <p className="notice" role="alert"><strong>Reconciliation data could not be loaded.</strong><br />No balanced state should be assumed. The ledger may be fine; this page simply has no verified reading right now.</p>
      : overview.length === 0
        ? <p className="notice" role="status">No ledger accounts, commission calculations or payout requests exist yet, so there is nothing to reconcile.</p>
        : overview.map(currency => <article className="panel dash-table" key={currency.currency}>
          <h2>{currency.currency} — {currency.balanced
            ? <>reconciles <span aria-label="Reconciled">✓</span></>
            : <>MISMATCH <span aria-label="Mismatch">✗</span></>}</h2>
          <p>Commission expense posted: <strong>{formatReconciliationMinor(currency.expenseDebitsMinor, currency.exponent)} {currency.currency}</strong> ({currency.expenseDebitsMinor} minor units)<br />
          Sitting in destination buckets: <strong>{formatReconciliationMinor(currency.destinationTotalMinor, currency.exponent)} {currency.currency}</strong> ({currency.destinationTotalMinor} minor units)<br />
          Difference: <strong>{formatReconciliationMinor(currency.differenceMinor, currency.exponent)} {currency.currency}</strong> ({currency.differenceMinor} minor units) — {currency.balanced ? "the ledger reconciles for this currency." : "the ledger does NOT reconcile for this currency; do not settle payouts until the difference is explained."}</p>
          <div className="table-scroll"><table><caption className="field-help">Balances are credits minus debits over all ledger journal lines for the bucket, across every affiliate (platform buckets have no affiliate).</caption><thead><tr><th scope="col">Bucket</th><th scope="col">Balance</th></tr></thead><tbody>
            <tr><td>Held (in hold period)</td><td>{formatReconciliationMinor(currency.heldMinor, currency.exponent)} {currency.currency} ({currency.heldMinor} minor units)</td></tr>
            <tr><td>Payable (available)</td><td>{formatReconciliationMinor(currency.payableMinor, currency.exponent)} {currency.currency} ({currency.payableMinor} minor units)</td></tr>
            <tr><td>Reserved (open payouts)</td><td>{formatReconciliationMinor(currency.reservedMinor, currency.exponent)} {currency.currency} ({currency.reservedMinor} minor units)</td></tr>
            <tr><td>Disputed</td><td>{formatReconciliationMinor(currency.disputedMinor, currency.exponent)} {currency.currency} ({currency.disputedMinor} minor units)</td></tr>
            <tr><td>Recovery</td><td>{formatReconciliationMinor(currency.recoveryMinor, currency.exponent)} {currency.currency} ({currency.recoveryMinor} minor units)</td></tr>
            <tr><td>Clearing (settled payouts)</td><td>{formatReconciliationMinor(currency.clearingMinor, currency.exponent)} {currency.currency} ({currency.clearingMinor} minor units)</td></tr>
          </tbody></table></div>
          {currency.calculations.length > 0 && <div className="table-scroll"><table><caption className="field-help">Recorded commission calculations, current (head) revisions only; superseded revisions are history.</caption><thead><tr><th scope="col">Qualification</th><th scope="col">Calculations</th><th scope="col">Net (minor units)</th></tr></thead><tbody>{currency.calculations.map(entry => <tr key={entry.qualification}><td>{entry.qualification}</td><td>{entry.count}</td><td>{entry.netMinor}</td></tr>)}</tbody></table></div>}
          {currency.payouts.length > 0 && <div className="table-scroll"><table><caption className="field-help">Payout requests by status for this currency.</caption><thead><tr><th scope="col">Payout status</th><th scope="col">Requests</th><th scope="col">Amount (minor units)</th></tr></thead><tbody>{currency.payouts.map(entry => <tr key={entry.status}><td>{entry.status}</td><td>{entry.count}</td><td>{entry.amountMinor}</td></tr>)}</tbody></table></div>}
        </article>)}
    </>;
}
