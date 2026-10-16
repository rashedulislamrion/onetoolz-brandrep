import Link from "next/link";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/auth/access";
import { SubmitButton } from "@/components/submit-button";
import { submitApplication } from "./actions";

export const metadata = { title: "Affiliate application" };
const notices: Record<string, string> = {
  invalid: "Check your name, public HTTPS website, and promotion plan (30–2,000 characters).",
  verify: "Confirm your email before submitting an application.",
  unavailable: "Your application could not be submitted. Please try again later; do not assume it was saved.",
};

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { client, user } = await requireIdentity();
  const { data, error } = await client.from("affiliate_applications").select("id").eq("user_id", user.id).maybeSingle();
  if (data) redirect("/application/status");
  const notice = (await searchParams).notice;
  const ready = !error && !!user.email_confirmed_at;
  return <section className="section content-page"><span className="eyebrow">BECOME A PARTNER</span><h1>Tell us about your community.</h1><p className="lead">Share where and how you intend to recommend OneToolz. Submitting an application does not activate commissions.</p>
    {!ready && <div className="notice" role="status">{error ? "Application storage is unavailable. Setup or connection verification is required before submissions can open." : "Please confirm your email first."}</div>}
    {notice && notices[notice] && <p className="notice" role="status">{notices[notice]}</p>}
    <form action={submitApplication}>
      <label>Your name<input name="displayName" minLength={2} maxLength={100} autoComplete="name" required disabled={!ready} /></label>
      <label>Website or public social profile<input name="promotionUrl" type="url" placeholder="https://" maxLength={2048} required disabled={!ready} /><span className="field-help">Use an HTTPS URL. Do not include passwords, access tokens, or private links.</span></label>
      <label>How will you promote OneToolz?<textarea name="promotionPlan" rows={6} minLength={30} maxLength={2000} required disabled={!ready} /><span className="field-help">30–2,000 characters. Describe your audience and promotion methods without sensitive personal information.</span></label>
      <SubmitButton disabled={!ready}>Submit for review</SubmitButton>
    </form><p className="field-help">One application per account in this release. Program commercial terms must be finalized before earning is activated.</p><Link href="/application/status" className="text-link">Back to account status</Link>
  </section>;
}