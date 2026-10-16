import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";

export const metadata = { title: "Revenue command center" };

export default async function Dashboard() {
  await requireAccess("affiliate");
  return <section className="section dashboard-page"><span className="eyebrow">PARTNER / COMMAND CENTER</span><h1>Your performance.<br />In full perspective.</h1><p className="lead">Your workspace for referrals, commissions and growth.</p><div className="notice" role="status"><strong>Reporting is not connected</strong><p>Every dash means unavailable—not a zero balance. Tracking, accounting and payouts must be integrated before verified account activity can appear.</p></div>
    <div className="metric-grid">{[
      ["Total confirmed earnings", "Approved commissions over your account lifetime."],
      ["Pending commissions", "Awaiting validation; not available for payout."],
      ["Available payout balance", "Released eligible earnings; not yet paid."],
      ["Paid commissions", "Completed disbursements only."],
      ["Referral clicks", "Recorded visits from attributed referral links."],
      ["Qualified conversions", "Eligible verified orders, not raw checkouts."],
      ["Conversion rate", "Qualified conversions divided by recorded clicks."],
      ["Rejected commissions", "Ineligible or rejected entries, with reasons."],
    ].map(([title, help]) => <article className="metric-card" key={title}><h2>{title}</h2><strong aria-label="Not connected">—</strong><p>{help}</p></article>)}</div>
    <div className="dashboard-panels"><article className="terminal-panel"><span className="eyebrow">EARNINGS OVER TIME</span><h2>Your next growth story.</h2><div className="empty-chart">No verified earnings series is available.<br />A chart will appear when reporting is connected.</div></article><article className="terminal-panel"><span className="eyebrow">YOUR REFERRAL TOOLKIT</span><h2>Build your campaign toolkit.</h2><p className="muted">Create and manage unique store-routing links. Referral tracking and order credit are not activated yet.</p><p className="field-help">Marketing resources are not published yet. Neither campaign links nor the public store URL currently establish tracked earnings.</p><Link className="text-link" href="/dashboard/referrals">Manage campaign links →</Link></article></div>
    <article className="terminal-panel dashboard-table"><span className="eyebrow">CAMPAIGN PERFORMANCE</span><h2>Know what drives results.</h2><div className="table-scroll"><table><caption className="field-help">Campaign reporting is not connected.</caption><thead><tr><th scope="col">Campaign</th><th scope="col">Clicks</th><th scope="col">Qualified conversions</th><th scope="col">Confirmed commission</th></tr></thead><tbody><tr><td colSpan={4}>No campaign data is available. This is not evidence of zero activity.</td></tr></tbody></table></div></article>
    <article className="terminal-panel dashboard-table"><span className="eyebrow">PAYOUT HISTORY</span><h2>Every payment, accounted for.</h2><p className="muted">Payout processing and history are not connected. No payment records or available balances are shown.</p><p className="field-help">Pending → approved → available → paid is the planned progression. Rejected entries and refund reversals will be shown separately once implemented. Approved does not mean immediately withdrawable.</p></article>
    <div className="hero-actions"><Link className="button secondary" href="/dashboard/referrals">Manage campaign links →</Link><Link className="button secondary" href="/account/security">Account & security →</Link><Link className="button secondary" href="/program">Commission & payment policy →</Link></div><p className="field-help">Campaign links currently provide store routing only, not tracked earnings. Payment settings for affiliates are not available in this release. Commercial policies must be published before activation.</p>
  </section>;
}