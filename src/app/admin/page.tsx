import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { percentageFromBasisPoints } from "@/lib/admin/program-settings";
import { mapAdminPayoutQueue } from "@/lib/payouts/overview";
import { mapReconciliationOverview } from "@/lib/ledger/reconciliation";
import { CountUp } from "@/components/count-up";

export const metadata = { title: "Administration" };

export default async function Admin() {
  const { client } = await requireAccess("admin");
  // Every figure on this page is a live read, each failing closed on its own:
  // a failed read renders as unavailable, never as a fabricated zero.
  let pendingCount: number | null = null;
  let pendingPreview: { id: string; display_name: string; promotion_url: string; created_at: string }[] | null = null;
  try {
    const { data, error, count } = await client.from("affiliate_applications")
      .select("id,display_name,promotion_url,created_at", { count: "exact" })
      .eq("status", "pending").order("created_at").limit(5);
    if (!error) { pendingCount = count ?? null; pendingPreview = data ?? []; }
  } catch { pendingCount = null; pendingPreview = null; }
  let affiliateCount: number | null = null;
  try {
    const { count, error } = await client.from("affiliates").select("user_id", { count: "exact", head: true }).eq("status", "approved");
    if (!error) affiliateCount = count ?? null;
  } catch { affiliateCount = null; }
  let queue = null as ReturnType<typeof mapAdminPayoutQueue> | null;
  try {
    const { data, error } = await client.rpc("admin_payout_queue");
    if (!error) queue = mapAdminPayoutQueue(data);
  } catch { queue = null; }
  let policy: { version: number; commission_bps: number; currency: string; effective_at: string } | null = null;
  let policyKnown = false;
  try {
    const { data, error } = await client.from("program_policies")
      .select("version,commission_bps,currency,effective_at").order("version", { ascending: false }).limit(1);
    if (!error) { policyKnown = true; policy = data?.[0] ?? null; }
  } catch { policyKnown = false; }
  let reconciliation = null as ReturnType<typeof mapReconciliationOverview> | null;
  try {
    const { data, error } = await client.rpc("admin_reconciliation_overview");
    if (!error) reconciliation = mapReconciliationOverview(data);
  } catch { reconciliation = null; }
  const cards: { title: string; help: string; value: React.ReactNode }[] = [
    { title: "Pending applications", help: "Applications waiting for a review decision.", value: pendingCount === null ? "—" : <CountUp value={pendingCount} /> },
    { title: "Payouts awaiting action", help: "Requests holding a ledger reservation.", value: queue === null ? "—" : <CountUp value={queue.length} /> },
    { title: "Approved affiliates", help: "Partners who can earn under the program.", value: affiliateCount === null ? "—" : <CountUp value={affiliateCount} /> },
    { title: "Active policy", help: policyKnown && policy ? `Effective ${new Date(policy.effective_at).toISOString().slice(0, 10)} · ${policy.currency}` : "The rules new commissions are calculated under.", value: !policyKnown ? "—" : policy ? `v${policy.version} · ${percentageFromBasisPoints(policy.commission_bps)}%` : "Not published" },
  ];
  return <>
    <div className="page-head"><div><span className="eyebrow">ADMINISTRATION</span><h1>Operations overview.</h1><p className="lead">The whole program at a glance — review queues, money state and the rules in force.</p></div>
      <div className="page-actions"><Link className="button" href="/admin/applications">Review applications →</Link><Link className="button secondary" href="/admin/settings">Program settings</Link></div></div>
    <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>{cards.map(card => <article className="metric-card" key={card.title}><h2>{card.title}</h2><strong>{card.value}</strong><p>{card.help}</p></article>)}</div>
    <div className="dashboard-panels">
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">REVIEW QUEUE</span><h2>Latest pending applications.</h2></div><Link className="text-link" href="/admin/applications">Open queue →</Link></div>
        {pendingPreview === null
          ? <p className="muted">The review queue could not be loaded. No empty-queue assumption should be made.</p>
          : pendingPreview.length === 0
            ? <p className="muted">No applications are waiting. New submissions will appear here.</p>
            : pendingPreview.map(application => <div className="campaign-row" key={application.id}><div className="campaign-main"><strong>{application.display_name}</strong><span className="campaign-link">{application.promotion_url}</span><span className="field-help">Submitted {new Date(application.created_at).toISOString().slice(0, 10)}</span></div><span className="pill-status warn">Pending</span></div>)}
      </article>
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">PAYOUT QUEUE</span><h2>Money waiting on you.</h2></div><Link className="text-link" href="/admin/payouts">Open queue →</Link></div>
        {queue === null
          ? <p className="muted">The payout queue could not be loaded. No empty-queue assumption should be made.</p>
          : queue.length === 0
            ? <p className="muted">No payout requests are awaiting review or settlement.</p>
            : queue.slice(0, 5).map(row => <div className="campaign-row" key={row.id}><div className="campaign-main"><strong>{row.displayName}</strong><span className="field-help">{row.amountMinor} minor units · {row.currency} · Requested {new Date(row.createdAt).toISOString().slice(0, 10)}</span></div><span className="pill-status warn">{row.status}</span></div>)}
      </article>
    </div>
    <div className="dashboard-panels">
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">LEDGER HEALTH</span><h2>Reconciliation.</h2></div><Link className="text-link" href="/admin/reconciliation">Full report →</Link></div>
        {reconciliation === null
          ? <p className="muted">Reconciliation data could not be loaded. No balanced state should be assumed.</p>
          : reconciliation.length === 0
            ? <p className="muted">No ledger activity yet — nothing to reconcile.</p>
            : reconciliation.map(currency => <div className="campaign-row" key={currency.currency}><div className="campaign-main"><strong>{currency.currency}</strong><span className="field-help">Difference: {currency.differenceMinor} minor units</span></div><span className={currency.balanced ? "pill-status ok" : "pill-status bad"}>{currency.balanced ? "Reconciles ✓" : "Mismatch ✗"}</span></div>)}
      </article>
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">PROGRAM RULES</span><h2>Policy in force.</h2></div><Link className="text-link" href="/admin/settings">Manage →</Link></div>
        {!policyKnown
          ? <p className="muted">Policy storage could not be read right now.</p>
          : policy
            ? <><p><strong>Policy v{policy.version}</strong> — {percentageFromBasisPoints(policy.commission_bps)}% commission · {policy.currency} · effective {new Date(policy.effective_at).toISOString().slice(0, 10)}.</p><p className="field-help">Publishing a new version changes the rules for future eligible orders only; published versions are immutable.</p></>
            : <><p className="muted">No commission policy is published yet, so no order can earn. Create a settings draft, then publish it to activate earning under your chosen rate, basis and payout rules.</p><p><Link className="button small" href="/admin/settings">Create &amp; publish the first policy →</Link></p></>}
      </article>
    </div>
    <div className="notice"><strong>Commission posting stays gated</strong><p>Recorded commissions are not posted to affiliate balances until the PipraPay settlement-evidence gate is enabled (COMMISSION_POSTING_ENABLED). Tracking, recording, payout review and manual settlement all work independently of that gate.</p></div>
  </>;
}
