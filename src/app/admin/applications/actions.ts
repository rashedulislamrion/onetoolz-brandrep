"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth/access";
import { requireMutationOrigin } from "@/lib/auth/mutation";
import { parseReview } from "@/lib/admin/validation";

export async function reviewApplication(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireAccess("admin");
  const input = parseReview(form);
  if (!input) redirect("/admin/applications?notice=invalid");
  const { error } = await client.rpc("review_affiliate_application", { p_application_id: input.id, p_decision: input.decision, p_reason: input.reason });
  if (error) redirect("/admin/applications?notice=failed");
  revalidatePath("/admin/applications");
  redirect("/admin/applications?notice=saved");
}