import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthConfiguration } from "@/lib/config";
import { isSameOrigin } from "@/lib/auth/policy";

export async function requireMutationOrigin() {
  const configuration = getAuthConfiguration(process.env);
  if (!configuration.ready || !isSameOrigin((await headers()).get("origin"), configuration.origin)) {
    redirect("/login?notice=invalid");
  }
}