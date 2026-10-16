import Link from "next/link";
import { requireIdentity } from "@/lib/auth/access";
import { MfaEnrollment } from "@/components/mfa-enrollment";
import { SubmitButton } from "@/components/submit-button";
import { verifyAuthenticator } from "./actions";

export const metadata = { title: "Account security" };
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { client } = await requireIdentity();
  const [{ data: factors, error }, { data: assurance, error: assuranceError }, { data: roles }] = await Promise.all([
    client.auth.mfa.listFactors(), client.auth.mfa.getAuthenticatorAssuranceLevel(), client.from("user_roles").select("role"),
  ]);
  const notice = (await searchParams).notice;
  const verified = factors?.totp.filter(f => f.status === "verified") ?? [];
  return <section className="section content-page"><span className="eyebrow">ACCOUNT SECURITY</span><h1>Protect your account.</h1>
    <p>MFA is required for administrative review. Enrolling an authenticator does not grant an administrator role.</p>
    {notice === "invalid" && <p className="notice" role="alert">Verification failed. Use a fresh six-digit code, or restart an unfinished setup.</p>}
    {error || assuranceError ? <p className="notice" role="alert">Security settings could not be loaded. Try again later.</p> : assurance?.currentLevel === "aal2" ? <div className="notice" role="status">Your current session is MFA verified.</div> : verified.length ? <form action={verifyAuthenticator}><label>Authenticator<select name="factorId">{verified.map(f => <option key={f.id} value={f.id}>{f.friendly_name ?? "Authenticator"}</option>)}</select></label><label>Six-digit code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label><SubmitButton>Verify session</SubmitButton></form> : <MfaEnrollment />}
    <p className="field-help">Self-service factor removal and recovery are not implemented. Do not delete your authenticator account; a verified operator recovery process is required if access is lost.</p>
    <div className="hero-actions"><Link href="/application/status" className="button secondary">Account status</Link>{roles?.some(r => r.role === "admin") && <Link href="/admin" className="button">Administration</Link>}</div>
  </section>;
}