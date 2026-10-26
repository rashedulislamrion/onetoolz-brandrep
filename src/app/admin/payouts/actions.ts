"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/access";
import { requireMutationOrigin } from "@/lib/auth/mutation";
import { parsePayoutFail, parsePayoutReview, parsePayoutSettle } from "@/lib/payouts/validation";

export async function reviewPayout(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("admin");
  const input = parsePayoutReview(form);
  if (!input) redirect("/admin/payouts?notice=invalid");
  const { error } = await client.rpc("review_payout", {
    p_request_id: input.requestId, p_decision: input.decision, p_reason: input.reason,
  });
  if (error) redirect("/admin/payouts?notice=failed");
  revalidatePath("/admin/payouts");
  redirect("/admin/payouts?notice=reviewed");
}

export async function settlePayout(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("admin");
  const input = parsePayoutSettle(form);
  if (!input) redirect("/admin/payouts?notice=invalid");
  const { error } = await client.rpc("settle_payout", {
    p_request_id: input.requestId, p_external_reference: input.externalReference,
  });
  if (error) redirect("/admin/payouts?notice=failed");
  revalidatePath("/admin/payouts");
  redirect("/admin/payouts?notice=settled");
}

export async function failPayout(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("admin");
  const input = parsePayoutFail(form);
  if (!input) redirect("/admin/payouts?notice=invalid");
  const { error } = await client.rpc("fail_payout", {
    p_request_id: input.requestId, p_reason: input.reason,
  });
  if (error) redirect("/admin/payouts?notice=failed");
  revalidatePath("/admin/payouts");
  redirect("/admin/payouts?notice=failed-recorded");
}
