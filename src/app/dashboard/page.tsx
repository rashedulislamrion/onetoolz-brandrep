import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { getAuthConfiguration } from "@/lib/config";
import { LEDGER_BUCKETS, mapLedgerBalances } from "@/lib/ledger/balances";
import { mapCommissionTotals, type CurrencyTotals } from "@/lib/ledger/totals";
import { referralLink } from "@/lib/referrals/campaigns";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Revenue command center" };

type CampaignRow = { id: string; code: string; name: string; destination_path: string; active: boolean };

export default async function Dashboard() {
  const { client } = await requireAccess("affiliate");
  // Commission calculation totals are a real read (affiliate_commission_totals,
  // own rows only), and ledger balances are another (affiliate_ledger_balances,
  // own accounts only, derived from journal lines). Any failure — including a
  // migration not being installed — fails closed to the honest unavailable
  // placeholders below; nothing is ever rendered as zero on error.
  // All four reads are independent, so they run in parallel (Promise.all)
  // instead of four sequential round-trips. Each read keeps its own
  // try/catch and still fails closed independently of the others.
  const config = getAuthConfiguration(process.env);
  const [totals, balances, campaigns, storeLinkActive] = await Promise.all([
    (async (): Promise<readonly CurrencyTotals[] | null> => {
      try {
        const { data, error } = await client.rpc("affiliate_commission_totals");
        return !error ? mapCommissionTotals(data) : null;
      } catch { return null; }
    })(),
    (async (): Promise<ReturnType<typeof mapLedgerBalances>> => {
      try {
        const { data, error } = await client.rpc("affiliate_ledger_balances");
        return !error ? mapLedgerBalances(data) : null;
      } catch { return null; }
    })(),
    (async (): Promise<CampaignRow[] | null> => {
      try {
        const { data, error } = await client.from("referral_campaigns")
          .select("id,code,name,destination_path,active").order("created_at", { ascending: false }).limit(5);
        return !error && Array.isArray(data) ? (data as CampaignRow[]) : null;
      } catch { return null; }
    })(),
    (async (): Promise<boolean | null> => {
      try {
        const { data, error } = await client.rpc("store_link_status");
        if (error) return null;
        const row = Array.isArray(data) ? data[0] : data;
        return row && typeof row.active === "boolean" ? row.active : null;
      } catch { return null; }
    })(),
  ]);
  const payableParts: string[] = [];
  if (balances !== null) {
    for (const currency of balances) {
      const payable = currency.buckets.payable;
      if (payable !== null) payableParts.push(`${payable.decimal} ${currency.currency}`);
    }
  }
  const cards: readonly { title: string; help: string; value: string | null; hero?: boolean }[] = [
    { title: "Available payout balance", help: "Released eligible earnings; not yet paid.", value: payableParts.length > 0 ? payableParts.join(" · ") : null, hero: true },
    { title: "Total confirmed earnings", help: "Approved commissions over your account lifetime.", value: null },
    { title: "Pending commissions", help: "Awaiting validation; not available for payout.", value: null },
    { title: "Paid commissions", help: "Completed disbursements only.", value: null },
    { title: "Referral clicks", help: "Recorded visits from attributed referral links.", value: null },
    { title: "Qualified conversions", help: "Eligible verified orders, not raw checkouts.", value: null },
    { title: "Conversion rate", help: "Qualified conversions divided by recorded clicks.", value: null },
    { title: "Rejected commissions", help: "Ineligible or rejected entries, with reasons.", value: null },
  ];
  return <>
    <div className="page-head"><div><span className="eyebrow">PARTNER / COMMAND CENTER</span><h1>Your performance.<br />In full perspective.</h1><p className="lead">Your workspace for referrals, commissions and growth.</p></div>
      <div className="page-actions"><Link className="button" href="/dashboard/referrals">Create a campaign →</Link><Link className="button secondary" href="/dashboard/payouts">Request a payout</Link></div></div>
    {totals === null && balances === null
      ? <div className="notice" role="status"><strong>Reporting is not connected</strong><p>Every dash means unavailable—not a zero balance. Tracking, accounting and payouts must be integrated before verified account activity can appear.</p></div>
      : <div className="notice" role="status"><strong>Commission records connected</strong><p>{totals !== null && <>Your recorded commission calculation totals appear below. </>}{balances !== null && <>Your ledger balances appear below. </>}Referral tracking is live — first-click, 7-day window, no self-referrals. Every remaining dash still means unavailable, not a zero balance.</p></div>}
    <div className="metric-grid">{cards.map(card => <article className={card.hero ? "metric-card hero-stat" : "metric-card"} key={card.title}><h2>{card.title}</h2>{card.value === null
      ? <strong aria-label="Not connected">—</strong>
      : <strong>{card.value}</strong>}<p>{card.help}</p></article>)}</div>
    {totals !== null && <article className="panel dash-table"><div className="panel-head"><div><span className="eyebrow">RECORDED COMMISSION CALCULATIONS</span><h2>Your recorded commissions.</h2></div></div>{totals.length === 0
      ? <p className="muted">No commission calculations have been recorded for your account yet.</p>
      : <div className="table-scroll"><table><caption className="field-help">Recorded calculation totals in exact minor units (the totals source carries no currency exponent, so no decimal placement is invented). Qualified amounts are in the hold / available pipeline; they are recorded calculations, not a ledger balance or a payout promise.</caption><thead><tr><th scope="col">Currency</th><th scope="col">Qualified recorded (minor units)</th><th scope="col">Pending qualification estimates (minor units) — NOT earnings</th></tr></thead><tbody>{totals.map(total => <tr key={total.currency}><td>{total.currency}</td><td>{total.qualified.netMinor} ({total.qualified.count} calculations)</td><td>{total.unqualified.netMinor} ({total.unqualified.count} calculations)</td></tr>)}</tbody></table></div>}</article>}
    {balances !== null && <article className="panel dash-table"><div className="panel-head"><div><span className="eyebrow">LEDGER BALANCES</span><h2>Your money, bucket by bucket.</h2></div></div>{balances.length === 0
      ? <p className="muted">No ledger accounts exist for your affiliate yet. Balances appear here once commission holds are posted to your accounts.</p>
      : <div className="table-scroll"><table><caption className="field-help">Balances derived from your own ledger journal lines (credits minus debits) per bucket, formatted with each currency&apos;s recorded exponent. A dash means no ledger account exists in that bucket for the currency yet.</caption><thead><tr><th scope="col">Currency</th><th scope="col">On hold</th><th scope="col">Available for payout</th><th scope="col">Reserved for payouts</th><th scope="col">Disputed</th><th scope="col">Recovery</th></tr></thead><tbody>{balances.map(currency => <tr key={currency.currency}><td>{currency.currency}</td>{LEDGER_BUCKETS.map(bucket => { const balance = currency.buckets[bucket]; return <td key={bucket}>{balance ? `${balance.decimal} ${currency.currency} (${balance.minor} minor units)` : "—"}</td>; })}</tr>)}</tbody></table></div>}</article>}
    <div className="dashboard-panels">
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">YOUR CAMPAIGNS</span><h2>Your live links.</h2></div><Link className="text-link" href="/dashboard/referrals">Manage →</Link></div>
        {campaigns === null
          ? <p className="muted">Campaign data is unavailable right now.</p>
          : campaigns.length === 0
            ? <><p className="muted">No campaigns yet. Create your first campaign link and share it with your audience — clicks and orders are tracked from the moment it is live.</p><p><Link className="button small" href="/dashboard/referrals">Create a campaign →</Link></p></>
            : campaigns.map(campaign => { const link = config.ready ? referralLink(config.origin, campaign.code) : null; return <div className="campaign-row" key={campaign.id}><div className="campaign-main"><strong>{campaign.name}</strong>{link ? <a className="campaign-link" href={link}>{link}</a> : <span className="campaign-link">Origin unavailable</span>}</div><span className={campaign.active ? "pill-status ok" : "pill-status warn"}>{campaign.active ? "Live" : "Paused"}</span>{link && <CopyButton value={link} />}</div>; })}
      </article>
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">YOUR REFERRAL TOOLKIT</span><h2>How your credit works.</h2></div></div>
        <p className="muted">Referral tracking is live: first-click credit, a 7-day window, and no self-referrals — later clicks do not reset the window. Capture on the store activates automatically when a referral link is clicked, so there is no popup or extra step for the visitor.</p>
        <p className="field-help">Store account link: {storeLinkActive === null ? "status unavailable" : storeLinkActive ? "active — your store purchases can be identity-checked by the bridge." : "not linked yet — link your store account so the bridge can check your orders for self-referrals."}</p>
        <Link className="text-link" href="/dashboard/referrals">Manage campaign links &amp; store account →</Link>
      </article>
    </div>
    <article className="panel"><div className="panel-head"><div><span className="eyebrow">PAYOUT HISTORY</span><h2>Every payment, accounted for.</h2></div><Link className="text-link" href="/dashboard/payouts">Open payouts →</Link></div>
      {totals === null && balances === null
        ? <><p className="muted">Payout processing and history are not connected. No payment records or available balances are shown.</p><p className="field-help">Pending → approved → available → paid is the planned progression. Rejected entries and refund reversals will be shown separately once implemented. Approved does not mean immediately withdrawable.</p></>
        : <p className="muted">Request payouts from your available balance, follow each request through review, and see the settlement reference once the OneToolz team has paid it. Settlement is manual — BrandRep records it, it never sends money automatically.</p>}
    </article>
    <div className="quick-grid" style={{ marginTop: 20 }}>
      <Link className="quick-tile" href="/dashboard/payouts"><strong>Request a payout →</strong><span>Reserve from your available balance for admin review.</span></Link>
      <Link className="quick-tile" href="/dashboard/referrals"><strong>Link your store account →</strong><span>Connect your OneToolz store identity for order checks.</span></Link>
      <Link className="quick-tile" href="/account/security"><strong>Account &amp; security →</strong><span>Password, authenticator and sign-in protection.</span></Link>
      <Link className="quick-tile" href="/program"><strong>Commission &amp; payment policy →</strong><span>The published rules your earnings follow.</span></Link>
    </div>
  </>;
}
