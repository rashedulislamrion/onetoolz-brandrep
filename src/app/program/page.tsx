export const metadata = { title: "Program details" };

const policies = [
  ["Commission structure", "Rates, calculation basis, currency and recurring-commission eligibility are not published. Calculator inputs are personal assumptions only."],
  ["Eligible products", "The main store is available to explore; the affiliate-eligible product and subscription list is not finalized."],
  ["Attribution & cookies", "Referral tracking is not active. Attribution model, cookie duration, consent requirements and competing-referral rules await publication."],
  ["Validation & reversals", "Verified payment and order completion are planned eligibility checks. Validation holds, refund adjustments and reversal rules still require approved policy and implementation."],
  ["Payment methods & timing", "Payout methods, supported currencies, thresholds, fees and schedules are not approved. No withdrawals or payment dates are available."],
  ["Geographic eligibility", "Supported countries, residency requirements and tax documentation have not been finalized. Application review does not guarantee eligibility."],
  ["Promotion restrictions", "Final channel restrictions, advertising rules and disclosure requirements must be published. Do not make unsupported earnings or product claims."],
  ["Support & disputes", "An affiliate support channel, commission-dispute process and response expectations must be published before activation. No service-level promise is made yet."],
  ["Terms & privacy", "Final affiliate terms and privacy notices are not published. Policy acceptance and any additional application fields require a tracked implementation before public launch."],
];
export default function ProgramPage() {
  return <section className="section content-page"><span className="eyebrow">TRANSPARENCY FIRST</span><h1>Clear rules.<br />Stronger partnerships.</h1><p className="lead">A readiness checklist—not an active financial offer. Unknown policies are labeled, never filled with invented rates or payment promises.</p><div className="notice"><strong>Not yet open for earning or payouts</strong><p>Commercial rates, payout details, program terms and privacy notices must be approved before public launch. Applications require review; approval alone does not activate earnings.</p></div><div className="policy-grid">{policies.map(([title, copy]) => <article className="feature-card" key={title}><span className="eyebrow">AWAITING PUBLICATION / ACTIVATION</span><h2>{title}</h2><p>{copy}</p></article>)}</div></section>;
}