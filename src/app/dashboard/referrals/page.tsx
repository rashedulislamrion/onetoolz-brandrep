import { randomUUID } from "node:crypto";
import { requireAccess } from "@/lib/auth/access";
import { getAuthConfiguration } from "@/lib/config";
import { referralLink } from "@/lib/referrals/campaigns";
import { isStoreLinkToken } from "@/lib/referrals/link-token";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";
import { createCampaign, generateStoreLink, revokeStoreLink, setCampaignActive } from "./actions";

export const metadata = { title: "Referral campaigns" };

export default async function Referrals({ searchParams }: { searchParams: Promise<{ notice?: string; token?: string }> }) {
  const { client, user } = await requireAccess("affiliate");
  const params = await searchParams;
  const config = getAuthConfiguration(process.env);
  const { data, error } = await client.from("referral_campaigns")
    .select("id,code,name,destination_path,active,created_at").order("created_at", { ascending: false }).limit(50);
  // Store-link status comes from an RPC; the private referral schema is
  // never exposed to the browser client. Missing storage fails closed.
  let storeLink: { active: boolean; created_at: string | null } | null = null;
  let storeLinkError = false;
  try {
    const { data: status, error: statusError } = await client.rpc("store_link_status");
    if (statusError) storeLinkError = true;
    else {
      const row = Array.isArray(status) ? status[0] : status;
      if (row && typeof row.active === "boolean") storeLink = { active: row.active, created_at: row.created_at ?? null };
      else storeLinkError = true;
    }
  } catch { storeLinkError = true; }
  const shownToken = isStoreLinkToken(params.token) ? params.token : null;
  const notices: Record<string, string> = {
    saved: "Campaign saved. Share the link — clicks and eligible orders are tracked from now on.",
    updated: "Campaign availability updated.", invalid: "Check the campaign name and store path.",
    limit: "The account limit is 50 campaigns. Pause campaigns you no longer use.",
    failed: "The change could not be confirmed. Refresh before retrying.",
    linkRevoked: "Store link revoked. Orders can no longer be linked to your account until you generate a new token and paste it into the store.",
    linkFailed: "The store link could not be updated. Refresh before retrying; do not assume it was saved.",
  };
  return <>
    <div className="page-head"><div><span className="eyebrow">PARTNER / REFERRALS</span>
      <h1>Your campaign links.</h1>
      <p className="lead">Approved rules: first-click credit, a 7-day window, and no self-referrals. Later clicks do not reset the window.</p></div></div>
    <div className="notice"><strong>Referral tracking is live</strong><p>Links open the OneToolz store with your campaign code. With the visitor&apos;s consent, the store records the click, and eligible paid orders are attributed back to your campaign under the rules above.</p></div>
    {params.notice && notices[params.notice] && <p className="notice" role="status">{notices[params.notice]}</p>}
    {error ? <p className="notice" role="alert">Campaign storage is unavailable or the referral migration is not installed. Creation is disabled.</p> : <>
      <form action={createCampaign} className="form-panel">
        <span className="eyebrow">NEW CAMPAIGN</span>
        <h2>Create a campaign</h2><input type="hidden" name="requestId" value={randomUUID()} />
        <label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" name="name" required minLength={2} maxLength={80} />
        <label htmlFor="campaign-destination">Store destination path</label><input id="campaign-destination" name="destination" required maxLength={500} defaultValue="/" />
        <p className="field-help">For example / or /shop/. Only paths on cu.onetoolz.com are allowed; no query strings, fragments or external URLs.</p>
        <SubmitButton>Create campaign</SubmitButton>
      </form>
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">SAVED CAMPAIGNS</span><h2>Your links.</h2></div><span className="muted">{data?.length ?? 0} of 50</span></div>
        {data?.length ? data.map(campaign => {
          const link = config.ready ? referralLink(config.origin, campaign.code) : null;
          return <div className="campaign-row" key={campaign.id}><div className="campaign-main"><strong>{campaign.name}</strong>
            {link ? <a className="campaign-link" href={link}>{link}</a> : <span className="campaign-link">Origin unavailable</span>}
            <span className="field-help">Destination: {campaign.destination_path}{(() => { const created = campaign.created_at ? new Date(campaign.created_at) : null; return created && !Number.isNaN(created.getTime()) ? ` · Created ${created.toISOString().slice(0, 10)}` : ""; })()}</span></div>
            <span className={campaign.active ? "pill-status ok" : "pill-status warn"}>{campaign.active ? "Live" : "Paused"}</span>
            {link && <CopyButton value={link} />}
            <form action={setCampaignActive}><input type="hidden" name="code" value={campaign.code} /><input type="hidden" name="active" value={String(!campaign.active)} /><SubmitButton>{campaign.active ? "Pause" : "Resume"}</SubmitButton></form></div>;
        }) : <p className="muted">No campaigns created.</p>}
      </article>
    </>}
    <article className="panel">
      <div className="panel-head"><div><span className="eyebrow">STORE ACCOUNT LINK</span><h2>Link your OneToolz store account</h2></div>{storeLink?.active ? <span className="pill-status ok">Linked</span> : <span className="pill-status warn">Not linked</span>}</div>
      <p>Referral credit for your own purchases is never allowed, and the bridge must know which BrandRep account a store buyer belongs to before any order can be checked for self-referrals. A store-link token makes that connection:</p>
      <ol>
        <li>Generate a token here — it is shown <strong>once</strong> and only its hash is stored.</li>
        <li>In the OneToolz store, open <strong>My Account → BrandRep</strong> and paste the token together with your BrandRep User ID below. The store keeps the token server-side and never displays it again.</li>
        <li>At order time the store presents the token to BrandRep instead of a live login session. Revoke it here at any time; generating a new one revokes the old one.</li>
      </ol>
      <p>Your BrandRep User ID: <code className="mfa-key">{user.id}</code></p>
      <p className="field-help">Treat the token like a password. Anyone holding it can present it as your buyer identity to the store connector. If it may have leaked, revoke it and generate a new one.</p>
      {shownToken && <div className="notice" role="status"><strong>Your store-link token — copy it now, it will not be shown again</strong><p><code className="mfa-key">{shownToken}</code></p><p>Paste it in the store under My Account → BrandRep, then reload this page: the token disappears and only the link status remains.</p></div>}
      {storeLinkError ? <p className="notice" role="alert">Store-link storage is unavailable or the store-link migration is not installed. Linking is disabled.</p> : storeLink?.active ? <>
        <p>Store account link is <strong>active</strong>{storeLink.created_at ? <> — created {new Date(storeLink.created_at).toISOString().slice(0, 10)} UTC</> : null}. If the store does not have your current token, generate a new one (this revokes the active link).</p>
        <div className="hero-actions"><form action={generateStoreLink}><SubmitButton>Generate a new token</SubmitButton></form><form action={revokeStoreLink}><SubmitButton>Revoke store link</SubmitButton></form></div>
      </> : <>
        <p>No active store link. Until a link exists, your store orders cannot be identity-checked by the bridge and guest/unlinked purchases are denied attribution processing.</p>
        <form action={generateStoreLink}><SubmitButton>Generate store-link token</SubmitButton></form>
      </>}
    </article>
  </>;
}
