import Link from "next/link";
import { requireIdentity } from "@/lib/auth/access";
import { signOut } from "@/app/auth/actions";
import { SubmitButton } from "@/components/submit-button";
export const metadata = { title: "Account status" };
export default async function ApplicationStatus() {
  const { client, user } = await requireIdentity();
  const { data: application, error } = await client.from("affiliate_applications").select("id,status,created_at,reviewed_at").eq("user_id", user.id).maybeSingle();
  const history = application ? await client.from("application_events").select("id,event_type,reason,created_at").eq("application_id", application.id).order("created_at", { ascending: false }).limit(20) : null;
  const messages: Record<string, string> = {
    pending: "Your application is awaiting administrator review. No affiliate privileges have been granted yet.",
    approved: "Your application has been approved. Dashboard access also depends on your current affiliate status. Financial integrations are not active yet.",
    rejected: "Your application was not approved. Review the decision history below.",
  };
  return <section className="section content-page"><span className="eyebrow">YOUR PARTNER ACCOUNT</span><h1>Your application status.</h1>
    <div className="notice" role="status"><strong>{error ? "Application storage unavailable" : application ? `Application: ${application.status}` : "No application submitted"}</strong><p>{error ? "Database setup or connection verification is still required. Your registration is separate and remains intact." : application ? messages[application.status] ?? "Please contact program support." : "You can now tell us about your community and submit an application for review."}</p></div>
    {!error && !application && <Link href="/apply" className="button">Start application</Link>}
    {application?.status === "approved" && <Link href="/dashboard" className="button">Open partner workspace</Link>}
    {history?.error && <p className="notice">Decision history could not be loaded. Please try again later.</p>}
    {history?.data && history.data.length > 0 && <section aria-label="Application history"><h2>Application history</h2><ol className="steps">{history.data.map(event => <li key={event.id}><div><h3>{event.event_type}</h3><p>{event.reason}</p><time dateTime={event.created_at}>{new Date(event.created_at).toISOString().slice(0, 10)} UTC</time></div></li>)}</ol></section>}
    <p>No earnings, referrals, or payouts have been activated.</p><div className="hero-actions"><Link href="/program" className="button secondary">Program details</Link><form action={signOut}><SubmitButton>Sign out</SubmitButton></form></div></section>;
}