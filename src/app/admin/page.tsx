import { requireAccess } from "@/lib/auth/access";
import Link from "next/link";
export const metadata = { title: "Administration" };
export default async function Admin() {
  await requireAccess("admin");
  return <section className="section content-page"><span className="eyebrow">ADMINISTRATION</span><h1>Operations workspace.</h1><div className="hero-actions"><Link className="button" href="/admin/applications">Review applications</Link><Link className="button secondary" href="/admin/payouts">Payout queue</Link><Link className="button secondary" href="/admin/reconciliation">Ledger reconciliation</Link><Link className="button secondary" href="/admin/settings">Commission &amp; disbursement settings</Link><Link className="button secondary" href="/account/security">Account security</Link></div><div className="notice"><strong>Financial execution is not enabled</strong><p>Prepare versioned program-setting drafts in the settings screen. Saving a draft does not activate earnings or authorize payouts.</p></div></section>;
}