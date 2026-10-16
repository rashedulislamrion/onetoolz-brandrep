"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/access";
import { requireMutationOrigin } from "@/lib/auth/mutation";
import { parseProgramSettings } from "@/lib/admin/program-settings";
import { parsePolicyPublication } from "@/lib/admin/policy-publication";

export async function saveProgramSettings(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("admin");
  const input = parseProgramSettings(form);
  if (!input) redirect("/admin/settings?notice=invalid");
  const { error } = await client.rpc("save_program_settings_draft", {
    p_request_id: input.requestId, p_expected_revision: input.revision,
    p_commission_bps: input.basisPoints, p_currency: input.currency, p_minimum_payout: input.minimumPayout,
    p_hold_days: input.holdDays, p_payout_cadence: input.payoutCadence, p_reason: input.reason,
  });
  if (error) redirect(error.code === "40001" ? "/admin/settings?notice=conflict" : "/admin/settings?notice=failed");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?notice=saved");
}

export async function publishProgramPolicy(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("admin");
  const input = parsePolicyPublication(form);
  if (!input) redirect("/admin/settings?notice=publicationInvalid");
  const { error } = await client.rpc("publish_program_policy", {
    p_request_id: input.requestId, p_draft_revision: input.draftRevision, p_expected_version: input.expectedVersion,
    p_currency_decimals: input.currencyDecimals, p_basis: input.basis, p_refund_rule: input.refundRule, p_reason: input.reason,
  });
  if (error) redirect(error.code === "40001" ? "/admin/settings?notice=conflict" : "/admin/settings?notice=publicationFailed");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?notice=published");
}