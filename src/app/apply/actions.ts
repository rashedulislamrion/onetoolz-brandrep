"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/auth/access";
import { isSameOrigin } from "@/lib/auth/policy";
import { getAuthConfiguration } from "@/lib/config";
import { validateApplication } from "@/lib/applications/validation";

export async function submitApplication(form: FormData) {
  const config = getAuthConfiguration(process.env);
  if (!config.ready || !isSameOrigin((await headers()).get("origin"), config.origin)) redirect("/apply?notice=invalid");
  const { client, user } = await requireIdentity();
  if (!user.email_confirmed_at) redirect("/apply?notice=verify");
  const input = validateApplication(form);
  if (!input) redirect("/apply?notice=invalid");
  const { error } = await client.rpc("submit_affiliate_application", {
    p_display_name: input.displayName,
    p_promotion_url: input.promotionUrl,
    p_promotion_plan: input.promotionPlan,
  });
  if (error) redirect("/apply?notice=unavailable");
  redirect("/application/status?notice=submitted");
}