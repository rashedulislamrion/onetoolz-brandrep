"use client";

import { useState } from "react";
import { earningsProjection } from "@/lib/earnings-projection";

export function EarningsCalculator() {
  const [referrals, setReferrals] = useState("100");
  const [conversion, setConversion] = useState("5");
  const [commission, setCommission] = useState("");
  const [period, setPeriod] = useState("monthly");
  const result = [referrals, conversion, commission].some(v => v.trim() === "") ? null : earningsProjection(Number(referrals), Number(conversion), Number(commission), period === "yearly");
  return <section className="section" id="calculator" aria-labelledby="calculator-title"><div className="section-heading"><span className="eyebrow">MODEL THE POSSIBILITIES</span><h2 id="calculator-title">Your ambition.<br />Your assumptions.</h2><p>Explore a scenario—not a promise. Official rates are not published, so no program commission is prefilled.</p></div><div className="calculator-grid terminal-panel"><div>
    <label>Expected monthly referred visitors<input type="number" min="0" max="1000000" value={referrals} onChange={e => setReferrals(e.target.value)} /></label>
    <label>Conversion to qualifying sales (%)<input type="range" min="0" max="100" step="0.5" value={conversion} onChange={e => setConversion(e.target.value)} /><span className="field-help">{conversion}% — your assumption, not measured performance</span></label>
    <label>Assumed commission per qualifying sale<input type="number" min="0" max="100000" step="0.01" placeholder="Enter your own assumption" value={commission} onChange={e => setCommission(e.target.value)} /><span className="field-help">Currency-neutral units. This is not an approved OneToolz rate.</span></label>
    <label>Projection period<select value={period} onChange={e => setPeriod(e.target.value)}><option value="monthly">Monthly</option><option value="yearly">Yearly (12 identical months)</option></select></label>
  </div><div className="projection-result"><span className="eyebrow">ILLUSTRATIVE PROJECTION ONLY</span><output aria-live="polite" aria-atomic="true">{result === null ? "—" : result.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</output><span>currency units / {period === "yearly" ? "year" : "month"}</span><p>{result === null ? "Enter a valid commission assumption to calculate a scenario." : "Based only on your inputs. Not an account balance or expected result."}</p><div className="formula">Visitors × conversion % ÷ 100 × commission{period === "yearly" ? " × 12" : ""}</div><p className="field-help">Excludes refunds, rejected orders, holds, taxes and fees. Actual eligibility, attribution and published policies will determine earnings. Income is not guaranteed.</p></div></div></section>;
}