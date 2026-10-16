"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/access";
import { requireMutationOrigin } from "@/lib/auth/mutation";
import { parseProgramSettings } from "@/lib/admin/program-settings";

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