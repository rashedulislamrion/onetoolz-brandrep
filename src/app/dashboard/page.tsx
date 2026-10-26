import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { LEDGER_BUCKETS, mapLedgerBalances } from "@/lib/ledger/balances";
import { mapCommissionTotals, type CurrencyTotals } from "@/lib/ledger/totals";

export const metadata = { title: "Revenue command center" };

export default async function Dashboard() {
  const { client } = await requireAccess("affiliate");
  // Commission calculation totals are a real read (affiliate_commission_totals,
  // own rows only), and ledger balances are another (affiliate_ledger_balances,
  // own accounts only, derived from journal lines). Any failure — including a
  // migration not being installed — fails closed to the honest unavailable
  // placeholders below; nothing is ever rendered as zero on error.
  let totals: readonly CurrencyTotals[] | null = null;
  try {
    const { data, error } = await client.rpc("affiliate_commission_totals");
    if (!error) totals = mapCommissionTotals(data);
  } catch { totals = null; }
  let balances = null as ReturnType<typeof mapLedgerBalances>;
  try {
    const { data, error } = await client.rpc("affiliate_ledger_balances");
    if (!error) balances = mapLedgerBalances(data);
  } catch { balances = null; }
  const payableParts: string[] = [];
  if (balances !== null) {
    for (const currency of balances) {
      const payable = currency.buckets.payable;
      if (payable !== null) payableParts.push(`${payable.decimal} ${currency.currency}`);
    }
  }
  const cards: readonly { title: string; help: string; value: string | null }[] = [
    { title: "Total confirmed earnings", help: "Approved commissions over your account lifetime.", value: null },
    { title: "Pending commissions", help: "Awaiting validation; not available for payout.", value: null },
    { title: "Available payout balance", help: "Released eligible earnings; not yet paid.", value: payableParts.length > 0 ? payableParts.join(" · ") : null },
    { title: "Paid commissions", help: "Completed disbursements only.", value: null },
    { title: "Referral clicks", help: "Recorded visits from attributed referral links.", value: null },
    { title: "Qualified conversions", help: "Eligible verified orders, not raw checkouts.", value: null },
    { title: "Conversion rate", help: "Qualified conversions divided by recorded clicks.", value: null },
    { title: "Rejected commissions", help: "Ineligible or rejected entries, with reasons.", value: null },
  ];
  return <section className="section dashboard-page"><span className="eyebrow">PARTNER / COMMAND CENTER</span><h1>Your performance.<br />In full perspective.</h1><p className="lead">Your workspace for referrals, commissions and growth.</p>{totals === null && balances === null
    ? <div className="notice" role="status"><strong>Reporting is not connected</strong><p>Every dash means unavailable—not a zero balance. Tracking, accounting and payouts must be integrated before verified account activity can appear.</p></div>
    : <div className="notice" role="status"><strong>Commission records connected</strong><p>{totals !== null && <>Your recorded commission calculation totals appear below. </>}{balances !== null && <>Your ledger balances appear below. </>}Referral tracking is not connected yet—every remaining dash still means unavailable, not a zero balance.</p></div>}
    <div className="metric-grid">{cards.map(card => <article className="metric-card" key={card.title}><h2>{card.title}</h2>{card.value === null
      ? <strong aria-label="Not connected">—</strong>
      : <strong>{card.value}</strong>}<p>{card.help}</p></article>)}</div>
    {totals !== null && <article className="terminal-panel dashboard-table"><span className="eyebrow">RECORDED COMMISSION CALCULATIONS</span><h2>Your recorded commissions.</h2>{totals.length === 0
      ? <p className="muted">No commission calculations have been recorded for your account yet.</p>
      : <div className="table-scroll"><table><caption className="field-help">Recorded calculation totals in exact minor units (the totals source carries no currency exponent, so no decimal placement is invented). Qualified amounts are in the hold / available pipeline; they are recorded calculations, not a ledger balance or a payout promise.</caption><thead><tr><th scope="col">Currency</th><th scope="col">Qualified recorded (minor units)</th><th scope="col">Pending qualification estimates (minor units) — NOT earnings</th></tr></thead><tbody>{totals.map(total => <tr key={total.currency}><td>{total.currency}</td><td>{total.qualified.netMinor} ({total.qualified.count} calculations)</td><td>{total.unqualified.netMinor} ({total.unqualified.count} calculations)</td></tr>)}</tbody></table></div>}</article>}
    {balances !== null && <article className="terminal-panel dashboard-table"><span className="eyebrow">LEDGER BALANCES</span><h2>Your money, bucket by bucket.</h2>{balances.length === 0
      ? <p className="muted">No ledger accounts exist for your affiliate yet. Balances appear here once commission holds are posted to your accounts.</p>
      : <div className="table-scroll"><table><caption className="field-help">Balances derived from your own ledger journal lines (credits minus debits) per bucket, formatted with each currency&apos;s recorded exponent. A dash means no ledger account exists in that bucket for the currency yet.</caption><thead><tr><th scope="col">Currency</th><th scope="col">On hold</th><th scope="col">Available for payout</th><th scope="col">Reserved for payouts</th><th scope="col">Disputed</th><th scope="col">Recovery</th></tr></thead><tbody>{balances.map(currency => <tr key={currency.currency}><td>{currency.currency}</td>{LEDGER_BUCKETS.map(bucket => { const balance = currency.buckets[bucket]; return <td key={bucket}>{balance ? `${balance.decimal} ${currency.currency} (${balance.minor} minor units)` : "—"}</td>; })}</tr>)}</tbody></table></div>}</article>}
    <div className="dashboard-panels"><article className="terminal-panel"><span className="eyebrow">EARNINGS OVER TIME</span><h2>Your next growth story.</h2><div className="empty-chart">No verified earnings series is available.<br />A chart will appear when reporting is connected.</div></article><article className="terminal-panel"><span className="eyebrow">YOUR REFERRAL TOOLKIT</span><h2>Build your campaign toolkit.</h2><p className="muted">Create and manage unique store-routing links. Referral tracking and order credit are not activated yet.</p><p className="field-help">Marketing resources are not published yet. Neither campaign links nor the public store URL currently establish tracked earnings.</p><Link className="text-link" href="/dashboard/referrals">Manage campaign links →</Link></article></div>
    <article className="terminal-panel dashboard-table"><span className="eyebrow">CAMPAIGN PERFORMANCE</span><h2>Know what drives results.</h2><div className="table-scroll"><table><caption className="field-help">Campaign reporting is not connected.</caption><thead><tr><th scope="col">Campaign</th><th scope="col">Clicks</th><th scope="col">Qualified conversions</th><th scope="col">Confirmed commission</th></tr></thead><tbody><tr><td colSpan={4}>No campaign data is available. This is not evidence of zero activity.</td></tr></tbody></table></div></article>
    <article className="terminal-panel dashboard-table"><span className="eyebrow">PAYOUT HISTORY</span><h2>Every payment, accounted for.</h2><p className="muted">Payout processing and history are not connected. No payment records or available balances are shown.</p><p className="field-help">Pending → approved → available → paid is the planned progression. Rejected entries and refund reversals will be shown separately once implemented. Approved does not mean immediately withdrawable.</p></article>
    <div className="hero-actions"><Link className="button secondary" href="/dashboard/payouts">Request a payout →</Link><Link className="button secondary" href="/dashboard/referrals">Manage campaign links →</Link><Link className="button secondary" href="/account/security">Account & security →</Link><Link className="button secondary" href="/program">Commission & payment policy →</Link></div><p className="field-help">Campaign links currently provide store routing only, not tracked earnings. Payment settings for affiliates are not available in this release. Commercial policies must be published before activation.</p>
  </section>;
}
