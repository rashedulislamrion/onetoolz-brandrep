import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { mapAdminPayoutQueue } from "@/lib/payouts/overview";
import { SubmitButton } from "@/components/submit-button";
import { failPayout, reviewPayout, settlePayout } from "./actions";

export const metadata = { title: "Payout queue" };

const notices: Record<string, string> = {
  reviewed: "Review recorded. Approval keeps the funds reserved; rejection released them back to the affiliate.",
  settled: "Settlement recorded with its external reference. The reservation has moved to clearing.",
  "failed-recorded": "Failure recorded. The reservation was released back to the affiliate's available balance.",
  failed: "The payout change could not be recorded. Refresh to check the latest status; self-review and conflicting transitions are prohibited.",
  invalid: "A valid decision, reason or settlement reference, and confirmation are required.",
};

export default async function AdminPayoutsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { client, user } = await requireAccess("admin");
  const params = await searchParams;
  let queue = null;
  try {
    const { data, error } = await client.rpc("admin_payout_queue");
    if (!error) queue = mapAdminPayoutQueue(data);
  } catch { queue = null; }
  return <section className="section content-page"><span className="eyebrow">ADMINISTRATION</span>
    <h1>Payout queue.</h1>
    <p>Every request below already holds a ledger reservation. <strong>Settlement is manual:</strong> send the money outside BrandRep first, then record its external transfer reference here — recording a settlement never moves money by itself, and a request is only settled once a reference is saved. You can never review, settle or fail your own payout request.</p>
    {params.notice && notices[params.notice] && <p className="notice" role="status">{notices[params.notice]}</p>}
    {queue === null
      ? <p className="notice" role="alert">The payout queue could not be loaded. No empty-queue assumption should be made.</p>
      : <>
        <p>{queue.length} payouts awaiting review or settlement</p>
        {queue.length === 0 && <p className="notice">The payout queue is empty.</p>}
        {queue.map(row => <article key={row.id} className="feature-card review-card">
          <h2>{row.displayName} — {row.amountMinor} minor units ({row.currency})</h2>
          <p className="field-help">Requested {new Date(row.createdAt).toISOString().slice(0, 10)} UTC · Status: {row.status} · Request key: {row.requestKey}</p>
          {row.affiliateUserId === user.id
            ? <p className="notice">You cannot review your own payout request.</p>
            : row.status === "requested"
              ? <form action={reviewPayout}><input type="hidden" name="requestId" value={row.id} />
                  <label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Choose a decision</option><option value="approve">Approve (keep reserved)</option><option value="reject">Reject (release reservation)</option></select></label>
                  <label>Reason recorded in the payout audit history<textarea name="reason" minLength={3} maxLength={1000} rows={3} required /></label>
                  <label className="check-label"><input type="checkbox" name="confirmed" value="yes" required /> I confirm this decision.</label>
                  <SubmitButton>Record review</SubmitButton></form>
              : <>
                  <form action={settlePayout}><input type="hidden" name="requestId" value={row.id} />
                    <label>External transfer reference (bKash / bank transaction ID)<input name="externalReference" minLength={4} maxLength={120} required /></label>
                    <label className="check-label"><input type="checkbox" name="confirmed" value="yes" required /> I confirm the money was already sent outside BrandRep with this reference.</label>
                    <SubmitButton>Record settlement</SubmitButton></form>
                  <form action={failPayout}><input type="hidden" name="requestId" value={row.id} />
                    <label>Failure reason (reservation is released)<textarea name="reason" minLength={3} maxLength={1000} rows={2} required /></label>
                    <label className="check-label"><input type="checkbox" name="confirmed" value="yes" required /> I confirm the external transfer failed.</label>
                    <SubmitButton>Record failure</SubmitButton></form>
                </>}
        </article>)}
      </>}
    <div className="hero-actions"><Link href="/admin" className="text-link">Back to administration</Link></div></section>;
}
