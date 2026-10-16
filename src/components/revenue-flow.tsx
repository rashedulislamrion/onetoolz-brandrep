export function RevenueFlow() {
  return <section className="section" id="revenue-flow"><div className="section-heading"><span className="eyebrow">THE REVENUE FLOW</span><h2>Make every<br />referral count.</h2><p>The planned journey. Approval and program activation are required before tracking and earning begin.</p></div><ol className="revenue-steps">{[
    ["Apply to join", "Create an account and submit your promotion plan. Every application is reviewed."],
    ["Get your referral link", "Once approved and tracking is activated, use your assigned referral identity."],
    ["Generate qualified conversions", "Promote relevant tools with clear affiliate disclosures. Only eligible, attributed orders qualify."],
    ["Receive eligible commissions", "Follow validation, holds and payout requirements under the published policy. These rules are not finalized yet."],
  ].map(([title, text], index) => <li className="feature-card" key={title}><span className="step-number">0{index + 1}</span><h3>{title}</h3><p>{text}</p></li>)}</ol></section>;
}