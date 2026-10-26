import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { reviewPage } from "@/lib/admin/validation";
import { SubmitButton } from "@/components/submit-button";
import { reviewApplication } from "./actions";

export const metadata = { title: "Application review" };
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ page?: string; notice?: string }> }) {
  const { client, user } = await requireAccess("admin");
  const params = await searchParams;
  const page = reviewPage(params.page);
  const { data, error, count } = await client.from("affiliate_applications").select("id,user_id,display_name,promotion_url,promotion_plan,status,created_at", { count: "exact" }).eq("status", "pending").order("created_at").order("id").range((page - 1) * 20, page * 20 - 1);
  const notices: Record<string, string> = { saved: "Decision recorded with its audit history.", failed: "Decision could not be recorded. Refresh to check the latest status; self-review and conflicting decisions are prohibited.", invalid: "A valid decision, reason, and confirmation are required." };
  return <><div className="page-head"><div><span className="eyebrow">ADMINISTRATION / APPLICATIONS</span><h1>Review partner applications.</h1><p className="lead">Decision reasons are visible to applicants. Do not include private investigation notes. Approval grants partner access; earnings follow the published policy.</p></div><span className="queue-count" aria-label="Pending applications">{count ?? "—"}</span></div>
    {params.notice && notices[params.notice] && <p className="notice" role="status">{notices[params.notice]}</p>}
    {error ? <p className="notice" role="alert">The review queue could not be loaded. No empty-queue assumption should be made.</p> : <>
      <p>{count ?? 0} pending applications · Page {page}</p>
      {!data?.length && <p className="notice">No applications on this page.</p>}
      {data?.map(application => <article key={application.id} className="feature-card review-card"><h2>{application.display_name}</h2><p className="review-text">{application.promotion_url}</p><p className="review-text">{application.promotion_plan}</p><p className="field-help">Submitted {new Date(application.created_at).toISOString().slice(0, 10)} UTC</p>
        {application.user_id === user.id ? <p className="notice">You cannot review your own application.</p> : <form action={reviewApplication}><input type="hidden" name="applicationId" value={application.id} /><label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Choose a decision</option><option value="approved">Approve</option><option value="rejected">Reject</option></select></label><label>Reason visible to applicant<textarea name="reason" minLength={3} maxLength={1000} rows={3} required /></label><label className="check-label"><input type="checkbox" name="confirmed" value="yes" required /> I confirm this decision and its explanation.</label><SubmitButton>Record decision</SubmitButton></form>}
      </article>)}
      <nav aria-label="Review pages">{page > 1 && <Link href={`/admin/applications?page=${page - 1}`}>Previous</Link>}{page < 1000 && page * 20 < (count ?? 0) && <Link href={`/admin/applications?page=${page + 1}`}>Next</Link>}</nav>
    </>}</>;
}