// Segment loading UI: the admin layout (AppShell) stays mounted while the
// page's data loads, so navigation feels responsive instead of frozen on
// the previous page. Static skeleton only — no data, no fabricated zeros.
export default function AdminLoading() {
  return <div role="status" aria-label="Loading administration">
    <div className="page-head"><div><span className="eyebrow">ADMINISTRATION</span><h1>Loading…</h1><p className="lead">Fetching the latest queues, balances and program state.</p></div></div>
    <div className="metric-grid">{["One", "Two", "Three", "Four"].map(label => <article className="metric-card" key={label}><h2>Loading</h2><strong aria-hidden="true">—</strong><p>Loading…</p></article>)}</div>
    <article className="panel"><p className="muted">Loading administration data…</p></article>
  </div>;
}
