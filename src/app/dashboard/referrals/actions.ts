"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/access";
import { requireMutationOrigin } from "@/lib/auth/mutation";
import { parseCampaign, validReferralCode } from "@/lib/referrals/campaigns";

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