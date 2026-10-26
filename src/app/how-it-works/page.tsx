import Link from "next/link";
export const metadata = { title: "How it works" };
export default function HowItWorks() {
  return <section className="section content-page"><span className="eyebrow">YOUR ROAD TO AN EARNING OPPORTUNITY</span><h1>A simple start.<br />A partnership worth building.</h1><p className="lead">Bring your recommendations to OneToolz. Here’s the path from your first account to eligible earnings.</p><ol className="steps">{[
    ["Create your account", "Verify your email and submit an affiliate application — applications are open now."],
    ["Get approved", "Your application is reviewed before your referral links and earning privileges switch on."],
    ["Share your referral link", "Introduce OneToolz to your community. Attribution depends on eligible referrals and the published tracking policy."],
    ["Follow verified conversions", "A click or placed order alone does not earn a commission. Payment and order eligibility must be verified."],
    ["Request eligible payouts", "Released earnings become eligible under the approved holding period, minimum, and payout policy."],
  ].map(([title, description], i) => <li key={title}><span className="step-number">0{i + 1}</span><div><h2>{title}</h2><p>{description}</p></div></li>)}</ol><div className="hero-actions"><Link className="button" href="/register">Start my partner journey ↗</Link><Link className="button secondary" href="/program">Read the program details →</Link></div></section>;
}