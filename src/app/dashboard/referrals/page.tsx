import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/access";
import { getAuthConfiguration } from "@/lib/config";
import { referralLink } from "@/lib/referrals/campaigns";
import { SubmitButton } from "@/components/submit-button";
import { createCampaign, setCampaignActive } from "./actions";

export const metadata = { title: "Referral campaigns" };

export default async function Referrals({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { client } = await requireAccess("affiliate");
  const params = await searchParams;
  const config = getAuthConfiguration(process.env);
  const { data, error } = await client.from("referral_campaigns")
    .select("id,code,name,destination_path,active,created_at").order("created_at", { ascending: false }).limit(50);
  const notices: Record<string, string> = {
    saved: "Campaign saved. This link routes visitors but does not yet track orders or earn commissions.",
    updated: "Campaign availability updated.", invalid: "Check the campaign name and store path.",
    limit: "The account limit is 50 campaigns. Pause campaigns you no longer use.",
    failed: "The change could not be confirmed. Refresh before retrying.",
  };
  return <section className="section content-page"><span className="eyebrow">PARTNER / REFERRALS</span>
    <h1>Your campaign links.</h1>
    <p className="field-help">Approved rules: first-click credit, a 7-day window, and no self-referrals. Later clicks do not reset the window. These rules do not activate tracking or commissions by themselves.</p>
    <div className="notice"><strong>Link routing only — attribution is not activated</strong><p>Links open the OneToolz store. No referral cookies, click counts, order credit or commissions are recorded yet. Do not advertise these as earning links until the store integration and attribution policy are activated.</p></div>
    {params.notice && notices[params.notice] && <p className="notice" role="status">{notices[params.notice]}</p>}
    {error ? <p className="notice" role="alert">Campaign storage is unavailable or the referral migration is not installed. Creation is disabled.</p> : <>
      <form action={createCampaign} className="feature-card">
        <h2>Create a campaign</h2><input type="hidden" name="requestId" value={randomUUID()} />
        <label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" name="name" required minLength={2} maxLength={80} />
        <label htmlFor="campaign-destination">Store destination path</label><input id="campaign-destination" name="destination" required maxLength={500} defaultValue="/" />
        <p className="field-help">For example / or /shop/. Only paths on cu.onetoolz.com are allowed; no query strings, fragments or external URLs.</p>
        <SubmitButton>Create campaign</SubmitButton>
      </form>
      <div className="table-scroll"><table><caption>Saved campaigns — performance tracking is unavailable</caption><thead><tr><th scope="col">Campaign</th><th scope="col">Link</th><th scope="col">Destination</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>
        {data?.length ? data.map(campaign => {
          const link = config.ready ? referralLink(config.origin, campaign.code) : null;
          return <tr key={campaign.id}><td>{campaign.name}</td><td>{link ? <a href={link}>{link}</a> : "Origin unavailable"}</td><td>{campaign.destination_path}</td><td>{campaign.active ? "Routing enabled" : "Paused"}</td><td><form action={setCampaignActive}><input type="hidden" name="code" value={campaign.code} /><input type="hidden" name="active" value={String(!campaign.active)} /><SubmitButton>{campaign.active ? "Pause" : "Resume"}</SubmitButton></form></td></tr>;
        }) : <tr><td colSpan={5}>No campaigns created.</td></tr>}
      </tbody></table></div>
    </>}
    <Link className="text-link" href="/dashboard">← Command center</Link>
  </section>;
}