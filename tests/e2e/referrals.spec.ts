import { expect, test } from "@playwright/test";

test("referral management requires identity", async ({ page }) => {
  await page.goto("/dashboard/referrals");
  await expect(page).toHaveURL(/\/login\?notice=setup/);
});

test("public referrals fail closed without configured storage", async ({ request }) => {
  const malformed = await request.get("/r/invalid", { maxRedirects: 0 });
  expect(malformed.status()).toBe(404);
  const disabled = await request.get(`/r/${"a".repeat(32)}?redirect=https://evil.test`, { maxRedirects: 0 });
  expect(disabled.status()).toBe(503);
  expect(disabled.headers()["location"]).toBeUndefined();
  expect(disabled.headers()["set-cookie"]).toBeUndefined();
  expect(disabled.headers()["cache-control"]).toContain("no-store");
});