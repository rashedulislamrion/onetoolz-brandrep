import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { percentageFromBasisPoints } from "@/lib/admin/program-settings";
import { SubmitButton } from "@/components/submit-button";
import { saveProgramSettings } from "./actions";

export const metadata = { title: "Program settings" };

export default async function ProgramSettings({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { client } = await requireAccess("admin");
  const params = await searchParams;
  const { data, error } = await client.from("program_settings_drafts")
    .select("revision,commission_bps,currency,minimum_payout,hold_days,payout_cadence,reason,created_at")
    .order("revision", { ascending: false }).limit(10);
  const latest = data?.[0];
  const notices: Record<string, string> = {
    saved: "Draft saved with an immutable revision. No earning or disbursement rules were activated.",
    invalid: "Check the required fields and confirmation. Percentage must be 0–100, with up to two decimal places.",
    conflict: "Another administrator saved a newer revision. Review the latest values before saving again.",
    failed: "The draft could not be saved. No success is assumed; refresh to check revision history.",
  };
  return <section className="section content-page"><span className="eyebrow">ADMINISTRATION</span>
    <h1>Commission &amp; disbursement settings.</h1>
    <p>Prepare program-wide settings here. Each save creates a new draft revision and records your explanation.</p>
    <div className="notice"><strong>Draft only — earnings and transfers are off</strong>
      <p>Saving does not publish a policy, recalculate past orders, reverse commissions, or send money. Commission basis, refund rules, currency precision and effective dates must be reviewed before future activation.</p></div>
    {params.notice && notices[params.notice] && <p className="notice" role="status">{notices[params.notice]}</p>}
    {error ? <p className="notice" role="alert">Settings storage is unavailable or not installed. Saving is disabled; no default policy is assumed.</p> : <>
      <form action={saveProgramSettings} className="feature-card">
        <input type="hidden" name="requestId" value={randomUUID()} />
        <input type="hidden" name="revision" value={latest?.revision ?? 0} />
        <h2>{latest ? `Edit draft revision ${latest.revision}` : "Create the first draft"}</h2>
        <label>Commission percentage<input name="commissionPercent" type="number" min="0" max="100" step="0.01" required defaultValue={latest ? percentageFromBasisPoints(latest.commission_bps) : ""} /></label>
        <p className="field-help">This is a proposed rate, not an approved calculation basis. No rate is preselected.</p>
        <label>Proposed currency code<input name="currency" pattern="[A-Z]{3}" minLength={3} maxLength={3} placeholder="Three uppercase letters" required defaultValue={latest?.currency ?? ""} /></label>
        <label>Minimum disbursement amount<input name="minimumPayout" type="text" inputMode="decimal" maxLength={16} required defaultValue={latest?.minimum_payout ?? ""} /></label>
        <p className="field-help">Decimal amount in the proposed currency, not minor units. Currency support and precision are checked before publication.</p>
        <label>Proposed hold period (days)<input name="holdDays" type="number" min="0" max="365" step="1" required defaultValue={latest?.hold_days ?? ""} /></label>
        <label>Proposed disbursement cadence<select name="payoutCadence" required defaultValue={latest?.payout_cadence ?? ""}>
          <option value="" disabled>Choose a cadence</option><option value="manual">Manual review</option><option value="weekly">Weekly review</option><option value="monthly">Monthly review</option>
        </select></label>
        <p className="field-help">A cadence is a planning preference. It does not schedule or authorize transfers.</p>
        <label>Reason for this revision<textarea name="reason" minLength={10} maxLength={1000} rows={3} required /></label>
        <label className="check-label"><input type="checkbox" name="confirmed" value="yes" required /> I understand this saves a draft, not an active financial policy.</label>
        <SubmitButton>Save draft revision</SubmitButton>
      </form>
      <h2>Recent draft revisions</h2>
      {!data?.length && <p>No policy draft has been saved.</p>}
      {data?.map(draft => <article className="feature-card" key={draft.revision}>
        <h3>Revision {draft.revision} · Draft</h3>
        <p>{percentageFromBasisPoints(draft.commission_bps)}% proposed commission · {draft.currency} {draft.minimum_payout} minimum · {draft.hold_days}-day hold · {draft.payout_cadence} review</p>
        <p className="review-text">{draft.reason}</p><p className="field-help">{draft.created_at} · UTC timestamp</p>
      </article>)}
      <p className="field-help">Showing the latest 10 revisions. Earlier revisions remain stored.</p>
    </>}
    <Link href="/admin" className="text-link">Back to administration</Link>
  </section>;
}