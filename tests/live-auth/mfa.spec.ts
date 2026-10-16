import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";
import { liveAuthConfiguration } from "../support/live-auth-config";
import { totp } from "../support/totp";

test("disposable account signs in, enrolls MFA, challenges a new session and signs out", async ({ page }) => {
  const configuration = liveAuthConfiguration(process.env);
  const admin = createClient(configuration.url, configuration.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const runId = randomUUID();
  const email = `onetoolz-e2e-${runId}@example.invalid`;
  const password = randomBytes(32).toString("base64url");
  const manifest = resolve(".local", `live-auth-${runId}.json`);
  mkdirSync(resolve(".local"), { recursive: true });
  // Record non-secret identity before the request, allowing recovery after a process crash.
  writeFileSync(manifest, JSON.stringify({ runId, email, project: configuration.url, state: "creation_requested" }));
  let userId: string | undefined;
  async function signIn(browserPage: Page) {
    await browserPage.goto("/login");
    await browserPage.getByLabel("Email address").fill(email);
    await browserPage.getByLabel("Password", { exact: true }).fill(password);
    await browserPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(browserPage).toHaveURL(/\/application\/status$/);
  }
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { onetoolz_e2e_run: runId } });
    if (created.error || !created.data.user) throw new Error("Disposable Auth creation failed; inspect the local run manifest before retrying.");
    userId = created.data.user.id;
    writeFileSync(manifest, JSON.stringify({ runId, email, userId, project: configuration.url, state: "created" }));
    await signIn(page);
    await expect(page.getByText("No application submitted", { exact: true })).toBeVisible();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/application\/status\?notice=access$/);
    await page.goto("/account/security");
    await page.getByRole("button", { name: "Set up authenticator", exact: true }).click();
    const key = page.locator(".mfa-key");
    await expect(key).toBeVisible();
    const secret = (await key.textContent())?.trim();
    if (!secret) throw new Error("MFA setup key was not available.");
    // Avoid a code expiring in transit. No arbitrary wrong-code guesses or account lockout.
    if (Date.now() % 30000 > 25000) await new Promise(resolve => setTimeout(resolve, 6000));
    await page.getByLabel("Six-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify authenticator", exact: true }).click();
    await expect(page.getByText("Your current session is MFA verified.", { exact: true })).toBeVisible();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/application\/status\?notice=access$/);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?notice=signedout$/);
    await signIn(page);
    await page.goto("/account/security");
    await expect(page.getByRole("button", { name: "Verify session", exact: true })).toBeVisible();
    // Use a fresh time step rather than replaying the enrollment code.
    await new Promise(resolve => setTimeout(resolve, 30000 - Date.now() % 30000 + 1000));
    await page.getByLabel("Six-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify session", exact: true }).click();
    await expect(page.getByText("Your current session is MFA verified.", { exact: true })).toBeVisible();
    await page.goto("/application/status");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.goto("/account/security");
    await expect(page).toHaveURL(/\/login\?notice=session$/);
  } finally {
    if (userId) {
      const result = await admin.auth.admin.getUserById(userId);
      if (result.error || result.data.user?.app_metadata.onetoolz_e2e_run !== runId || result.data.user.email !== email) {
        throw new Error("Fixture identity verification failed; run manifest retained for operator cleanup.");
      }
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) throw new Error("Fixture cleanup failed; run manifest retained for operator cleanup.");
      const remaining = await admin.auth.admin.getUserById(userId);
      if (remaining.data.user || remaining.error?.status !== 404) throw new Error("Fixture deletion could not be verified; run manifest retained.");
      unlinkSync(manifest);
    }
  }
});