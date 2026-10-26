import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { percentageFromBasisPoints } from "@/lib/admin/program-settings";
import { SubmitButton } from "@/components/submit-button";
import { publishProgramPolicy, saveProgramSettings } from "./actions";

export const metadata = { title: "Program settings" };

export default async function ProgramSettings({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { client } = await requireAccess("admin");
  const params = await searchParams;
  const { data, error } = await client.from("program_settings_drafts")
    .select("revision,commission_bps,currency,minimum_payout,hold_days,payout_cadence,reason,created_at")
    .order("revision", { ascending: false }).limit(10);
  const latest = data?.[0];
  const { data: policies, error: policyError } = await client.from("program_policies")
    .select("version,draft_revision,commission_bps,currency,currency_decimals,minimum_payout,hold_days,payout_cadence,basis,refund_rule,rounding,qualification,scope,effective_at,reason")
    .order("version", { ascending: false }).limit(10);
  const published = policies?.[0];
  const notices: Record<string, string> = {
    saved: "Draft saved with an immutable revision. No earning or disbursement rules were activated.",
    invalid: "Check the required fields and confirmation. Percentage must be 0–100, with up to two decimal places.",
    conflict: "Another administrator saved a newer revision. Review the latest values before saving again.",
    failed: "The draft could not be saved. No success is assumed; refresh to check revision history.",
    published: "Policy published as a new immutable version, effective from its server publication time. No transfers or historical recalculations occurred.",
    publicationInvalid: "Choose a saved draft, currency precision, calculation basis, refund rule and explicit publication confirmation.",
    publicationFailed: "Publication could not be confirmed. Check storage availability and currency precision, then refresh before retrying.",
  };
  return <section className="section content-page"><span className="eyebrow">ADMINISTRATION</span>
    <h1>Commission &amp; disbursement settings.</h1>
    <p>Configure commission and payout rules here. Save a draft, then explicitly publish the latest revision below.</p>
    <div className="notice"><strong>Admin-controlled rules — no automatic transfers</strong>
      <p>Draft saves are inactive. Publishing preserves an immutable policy effective from publication, without rewriting older rules. Order calculation, settlement validation and payout execution must be integrated separately; publishing alone does not create earnings or send money.</p></div>
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
    <h2>Publish commission policy</h2>
    {policyError ? <p className="notice" role="alert">Policy publication storage is unavailable or not installed. Publishing is disabled; draft editing remains separate.</p> : <>
      {!error && latest && published?.draft_revision !== latest.revision ? <form action={publishProgramPolicy} className="feature-card">
        <input type="hidden" name="requestId" value={randomUUID()} />
        <input type="hidden" name="draftRevision" value={latest.revision} />
        <input type="hidden" name="expectedVersion" value={published?.version ?? 0} />
        <h3>Publish draft {latest.revision} as policy {(published?.version ?? 0) + 1}</h3>
        <p>{percentageFromBasisPoints(latest.commission_bps)}% commission · {latest.currency} {latest.minimum_payout} minimum · {latest.hold_days}-day hold · {latest.payout_cadence} payout review.</p>
        <label>Currency decimal places<input name="currencyDecimals" type="number" min="0" max="6" step="1" required /></label>
        <p className="field-help">Select the actual currency precision, not an invented exchange rate. The minimum payout must fit that precision.</p>
        <label>Calculation basis<select name="basis" required defaultValue=""><option value="" disabled>Choose a basis</option><option value="net_items">Item totals after discounts, excluding tax and shipping</option><option value="order_total">Full order total, including tax and shipping</option></select></label>
        <label>Refund treatment<select name="refundRule" required defaultValue=""><option value="" disabled>Choose a refund rule</option><option value="proportional">Proportional reversal against the chosen basis</option><option value="full_on_any_refund">Reverse the entire commission on any refund</option></select></label>
        <label>Rounding<select name="rounding" required defaultValue=""><option value="" disabled>Choose a rounding mode</option><option value="half_up">Half up (standard)</option><option value="down">Down (truncate)</option></select></label>
        <label>Qualification<select name="qualification" required defaultValue=""><option value="" disabled>Choose a qualification rule</option><option value="paid_completed">Verified paid + completed order</option></select></label>
        <p className="field-help">A completed order status alone never earns commission: qualification requires verified payment as well as completion, and PipraPay settlement evidence remains a separate gate before any amount can be released.</p>
        <p className="field-help">This release supports percentage commissions on all products, one commission per eligible order; no recurring renewal awards or product overrides. Effective immediately on publication; no backdating. Payout cadence is review timing, not transfer authorization.</p>
        <label>Publication reason<textarea name="reason" minLength={10} maxLength={1000} rows={3} required /></label>
        <label className="check-label"><input type="checkbox" name="publishConfirmed" value="yes" required /> I approve the displayed draft, calculation/refund choices, currency precision and all-products one-time scope for future eligible orders.</label>
        <SubmitButton>Publish policy version</SubmitButton>
      </form> : <p>{error ? "Draft storage must be available before publication." : latest ? "The latest draft is already published. Save a new draft to change the rules." : "Save a draft before publishing a policy."}</p>}
      <h2>Published policy history</h2>
      {!policies?.length && <p>No policy is published. No commission rate is assumed.</p>}
      {policies?.map(policy => <article className="feature-card" key={policy.version}><h3>Policy {policy.version} · Draft {policy.draft_revision}</h3>
        <p>{percentageFromBasisPoints(policy.commission_bps)}% · {policy.currency} ({policy.currency_decimals} decimal places) · {policy.basis} basis · {policy.refund_rule} refunds</p>
        <p>Rounding {policy.rounding ?? "not recorded"} · Qualification {policy.qualification ?? "not recorded"}</p>
        <p>{policy.currency} {policy.minimum_payout} minimum · {policy.hold_days}-day hold · {policy.payout_cadence} review · All products, one-time order scope</p>
        <p className="review-text">{policy.reason}</p><p className="field-help">Effective {policy.effective_at} · UTC server timestamp</p>
      </article>)}
      <p className="field-help">Showing the latest 10 published versions. Prior versions remain stored and cannot be edited through the application.</p>
    </>}
    <Link href="/admin" className="text-link">Back to administration</Link>
  </section>;
}