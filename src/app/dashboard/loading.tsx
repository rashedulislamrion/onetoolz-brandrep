// Segment loading UI: the dashboard layout (AppShell) stays mounted while
// the page's data loads, so navigation feels responsive instead of frozen
// on the previous page. Static skeleton only — no data, no fabricated zeros.
export default function DashboardLoading() {
  return <div role="status" aria-label="Loading your workspace">
    <div className="page-head"><div><span className="eyebrow">PARTNER WORKSPACE</span><h1>Loading…</h1><p className="lead">Fetching your latest referrals, commissions and balances.</p></div></div>
    <div className="metric-grid">{["One", "Two", "Three", "Four"].map(label => <article className="metric-card" key={label}><h2>{label === "One" ? "Available payout balance" : "Loading"}</h2><strong aria-hidden="true">—</strong><p>Loading…</p></article>)}</div>
    <article className="panel"><p className="muted">Loading your workspace data…</p></article>
  </div>;
}
