import "server-only";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/server";
import { mayAccessAdmin, mayAccessAffiliate } from "@/lib/auth/policy";

export async function requireIdentity() {
  const client = await createAuthClient();
  if (!client) redirect("/login?notice=setup");
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?notice=session");
  return { client, user: data.user };
}

export async function requireAccess(kind: "affiliate" | "admin") {
  const { client, user } = await requireIdentity();
  // Missing schema/network failures deny access.
  // Never derive privileges from editable user_metadata.
  const { data: roles, error } = await client.from("user_roles").select("role").eq("user_id", user.id);
  if (error || !roles) redirect("/application/status?notice=access");
  if (kind === "admin") {
    if (!roles.some(r => r.role === "admin")) redirect("/application/status?notice=access");
    const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError || !mayAccessAdmin({ roles: roles.map((r) => r.role), affiliateStatus: null, aal: assurance?.currentLevel ?? null })) {
      redirect("/account/security");
    }
  } else {
    const { data: affiliate, error: affiliateError } = await client.from("affiliates").select("status").eq("user_id", user.id).maybeSingle();
    if (affiliateError || !mayAccessAffiliate({ roles: roles.map((r) => r.role), affiliateStatus: affiliate?.status ?? null, aal: null })) {
      redirect("/application/status?notice=access");
    }
  }
  return { user, client };
}