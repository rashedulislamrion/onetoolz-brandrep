"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/access";
import { requireMutationOrigin } from "@/lib/auth/mutation";
import { parseCampaign, validReferralCode } from "@/lib/referrals/campaigns";
import { generateStoreLinkToken, hashToken } from "@/lib/referrals/link-token";

export async function createCampaign(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("affiliate");
  const input = parseCampaign(form);
  if (!input) redirect("/dashboard/referrals?notice=invalid");
  const { error } = await client.rpc("create_referral_campaign", {
    p_request_id: input.requestId, p_name: input.name, p_destination_path: input.destination,
  });
  if (error) redirect(`/dashboard/referrals?notice=${error.code === "54000" ? "limit" : "failed"}`);
  revalidatePath("/dashboard/referrals");
  redirect("/dashboard/referrals?notice=saved");
}

// Generates the buyer's store-link token. Only its SHA-256 hash is stored;
// the plaintext travels once, in the redirect to this protected no-store
// page, and is never retrievable afterwards. Generating a replacement
// revokes the previous link inside the create_store_link RPC.
export async function generateStoreLink() {
  await requireMutationOrigin();
  const { client } = await requireAccess("affiliate");
  const token = generateStoreLinkToken();
  const tokenHash = hashToken(token);
  if (!tokenHash) redirect("/dashboard/referrals?notice=linkFailed");
  const { error } = await client.rpc("create_store_link", { p_token_hash: tokenHash });
  if (error) redirect("/dashboard/referrals?notice=linkFailed");
  revalidatePath("/dashboard/referrals");
  redirect(`/dashboard/referrals?token=${token}`);
}

export async function revokeStoreLink() {
  await requireMutationOrigin();
  const { client } = await requireAccess("affiliate");
  const { error } = await client.rpc("revoke_store_link");
  if (error) redirect("/dashboard/referrals?notice=linkFailed");
  revalidatePath("/dashboard/referrals");
  redirect("/dashboard/referrals?notice=linkRevoked");
}

export async function setCampaignActive(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("affiliate");
  const code = form.get("code");
  const active = form.get("active");
  if (typeof code !== "string" || !validReferralCode(code) || !["true", "false"].includes(String(active))) {
    redirect("/dashboard/referrals?notice=invalid");
  }
  const { error } = await client.rpc("set_referral_campaign_active", { p_code: code, p_active: active === "true" });
  if (error) redirect("/dashboard/referrals?notice=failed");
  revalidatePath("/dashboard/referrals");
  redirect("/dashboard/referrals?notice=updated");
}