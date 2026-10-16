"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/server";
import { getAuthConfiguration } from "@/lib/config";
import { isSameOrigin, validateCredentials } from "@/lib/auth/policy";

async function actionContext() {
  const config = getAuthConfiguration(process.env);
  if (!config.ready) redirect("/login?notice=setup");
  if (!isSameOrigin((await headers()).get("origin"), config.origin)) redirect("/login?notice=invalid");
  const client = await createAuthClient();
  if (!client) redirect("/login?notice=setup");
  return { client, config };
}

export async function signIn(form: FormData) {
  const { client } = await actionContext();
  const credentials = validateCredentials(form);
  if (!credentials) redirect("/login?notice=invalid");
  const { error } = await client.auth.signInWithPassword(credentials);
  if (error) redirect("/login?notice=credentials");
  redirect("/application/status");
}

export async function register(form: FormData) {
  const { client, config } = await actionContext();
  const credentials = validateCredentials(form);
  if (!credentials) redirect("/register?notice=invalid");
  const { error } = await client.auth.signUp({
    ...credentials,
    options: { emailRedirectTo: `${config.origin}/auth/callback` },
  });
  if (error) redirect("/register?notice=unavailable");
  redirect("/login?notice=verify");
}

export async function signOut() {
  const { client } = await actionContext();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) redirect("/application/status?notice=unavailable");
  redirect("/login?notice=signedout");
}

export async function requestPasswordReset(form: FormData) {
  const { client, config } = await actionContext();
  const email = form.get("email");
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) redirect("/forgot-password?notice=invalid");
  await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${config.origin}/auth/callback?next=/reset-password` });
  // Do not disclose whether the account exists.
  redirect("/forgot-password?notice=reset");
}

export async function updatePassword(form: FormData) {
  const { client } = await actionContext();
  const password = form.get("password");
  if (typeof password !== "string" || password.length < 12 || password.length > 128) redirect("/reset-password?notice=invalid");
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) redirect("/login?notice=session");
  const { error } = await client.auth.updateUser({ password });
  if (error) redirect("/reset-password?notice=unavailable");
  redirect("/application/status?notice=password");
}