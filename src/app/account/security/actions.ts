"use server";

import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/auth/access";
import { requireMutationOrigin } from "@/lib/auth/mutation";
import { validFactorCode } from "@/lib/admin/validation";

export type EnrollmentState = { error?: string; factorId?: string; secret?: string };

export async function enrollAuthenticator(): Promise<EnrollmentState> {
  await requireMutationOrigin();
  const { client, user } = await requireIdentity();
  if (!user.email_confirmed_at) return { error: "Confirm your email first." };
  const { data: factors, error: listError } = await client.auth.mfa.listFactors();
  if (listError) return { error: "Could not check your authenticators. Try again later." };
  if (factors.totp.some(factor => factor.status === "verified")) return { error: "An authenticator is already verified. Reload this page to verify your session." };
  // Remove only abandoned, unverified TOTP enrollments belonging to this session user.
  for (const factor of factors.all.filter(factor => factor.factor_type === "totp" && factor.status === "unverified")) {
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return { error: "Could not clear an unfinished setup. Try again later." };
  }
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "OneToolz authenticator", issuer: "OneToolz Affiliates" });
  if (error) return { error: "Authenticator setup failed. Try again later." };
  return { factorId: data.id, secret: data.totp.secret };
}

export async function verifyAuthenticator(form: FormData) {
  await requireMutationOrigin();
  const { client } = await requireIdentity();
  const factorId = form.get("factorId");
  const code = form.get("code");
  if (!validFactorCode(factorId, code)) redirect("/account/security?notice=invalid");
  const { data, error: listError } = await client.auth.mfa.listFactors();
  if (listError || !data.all.some(factor => factor.id === factorId && factor.factor_type === "totp")) redirect("/account/security?notice=invalid");
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factorId as string, code: code as string });
  if (error) redirect("/account/security?notice=invalid");
  redirect("/account/security?notice=verified");
}