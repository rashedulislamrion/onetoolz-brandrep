"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/access";
import { requireMutationOrigin } from "@/lib/auth/mutation";
import { parsePayoutCancel, parsePayoutRequest, payoutAmountMinor } from "@/lib/payouts/validation";
import { mapPayoutOverview } from "@/lib/payouts/overview";

export async function requestPayout(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("affiliate");
  const input = parsePayoutRequest(form);
  if (!input) redirect("/dashboard/payouts?notice=invalid");
  // The currency exponent is authoritative only in the overview the RPC
  // derives from the published policy and ledger — never from the form.
  const { data, error: overviewError } = await client.rpc("affiliate_payout_overview");
  const overview = overviewError ? null : mapPayoutOverview(data);
  const currency = overview?.currencies.find(entry => entry.currency === input.currency);
  if (!currency) redirect("/dashboard/payouts?notice=failed");
  const amountMinor = payoutAmountMinor(input.amountDecimal, currency.exponent);
  if (amountMinor === null) redirect("/dashboard/payouts?notice=invalid");
  const { error } = await client.rpc("request_payout", {
    p_request_key: input.requestKey, p_currency: input.currency, p_amount_minor: amountMinor,
  });
  if (error) redirect("/dashboard/payouts?notice=failed");
  revalidatePath("/dashboard/payouts");
  redirect("/dashboard/payouts?notice=requested");
}

export async function cancelPayout(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("affiliate");
  const input = parsePayoutCancel(form);
  if (!input) redirect("/dashboard/payouts?notice=invalid");
  const { error } = await client.rpc("cancel_payout", { p_request_id: input.requestId });
  if (error) redirect("/dashboard/payouts?notice=failed");
  revalidatePath("/dashboard/payouts");
  redirect("/dashboard/payouts?notice=cancelled");
}
