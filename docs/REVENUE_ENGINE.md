# Revenue Engine rebrand

## Scope

OneToolz BrandRep remains a separate affiliate application, associated with the OneToolz store. No store code, production orders, database migrations or activation flags were changed for this redesign.

- Dark forest surfaces, lime primary actions, emerald positive accents and gold status accents.
- Build-time self-hosted Space Grotesk, Inter and JetBrains Mono through the existing Next.js font system. No new package dependencies or runtime font-domain CSP exceptions.
- Public hero with explicitly illustrative chart and unconnected financial preview; no sample earnings or partner counts.
- Four-stage planned referral flow, one-shot line/path entrances, viewport section reveals, hover feedback and reduced-motion overrides. Content remains visible without JavaScript. No perpetual particles or heavy 3D.
- Interactive visitor/conversion/commission scenario calculator. Visitor count is pre-conversion traffic, avoiding double-applying conversion to already-qualified sales. Commission is intentionally blank; output uses neutral currency units. Yearly projections assume twelve identical months. This math is never imported into accounting.
- Protected command-center UI retains `requireAccess("affiliate")`. All metrics are unavailable dashes; no synthetic balances, orders, payout records or generated tracking links.
- Existing application submission, validation, storage fields, verification checks and review-status redirect are unchanged. Identity/reach/review grouping improves presentation without pretending extra data is persisted.
- Explicit program-policy publication checklist.

## Integration still required

1. Approve rates, eligible products, currency, attribution/cookie policy, validation holds and reversal rules.
2. Publish affiliate terms/privacy notices, geographic eligibility, promotion restrictions, support and dispute process.
3. Add country and structured channel/niche fields through a tracked schema/RPC migration and validation; add versioned policy acceptance only after policies exist. Current audience/channel details are collected in the existing promotion-plan text. The application currently uses grouped sections, not a new multi-step state machine.
4. Connect authorized affiliate-read interfaces for real metrics, time filters, campaigns and charts. Do not infer zeros from missing integrations.
5. Implement unique links, attribution and marketing resources in phase 3; accounting in phase 4; payment methods/settings/history in phase 5. The dashboard is presentation, not those backends.
6. Run signed-in hosted application/dashboard acceptance after deployment. Local anonymous browser tests do not establish signed-in provider operation.

No legitimate financial statistics are available for count-up animations. None are fabricated to satisfy a visual effect. Payout and earnings claims stay disabled until real integrations and policies are ready.