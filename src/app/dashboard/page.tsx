import { requireAccess } from "@/lib/auth/access";
export const metadata = { title: "Partner workspace" };
export default async function Dashboard() {
  await requireAccess("affiliate");
  return <section className="section content-page"><span className="eyebrow">PARTNER WORKSPACE</span><h1>Your partnership overview.</h1><div className="notice"><strong>Reporting is not connected</strong><p>No financial metrics are displayed until verified WooCommerce data and the commission ledger are implemented.</p></div></section>;
}