import { expect, test } from "@playwright/test";

test("referral management requires identity", async ({ page }) => {
  await page.goto("/dashboard/referrals");
  await expect(page).toHaveURL(/\/login\?notice=setup/);
});

// A successful redirect (302 to https://cu.onetoolz.com<path>?br_ref=<code>)
// cannot be exercised here: this suite runs with authentication/storage
// disabled, so every well-formed code takes the 503 path below. The exact
// Location, including the br_ref handoff parameter, is asserted in
// tests/unit/referral-route.test.ts.
test("public referrals fail closed without configured storage", async ({ request }) => {
  const malformed = await request.get("/r/invalid", { maxRedirects: 0 });
  expect(malformed.status()).toBe(404);
  const disabled = await request.get(`/r/${"a".repeat(32)}?redirect=https://evil.test`, { maxRedirects: 0 });
  expect(disabled.status()).toBe(503);
  expect(disabled.headers()["location"]).toBeUndefined();
  expect(disabled.headers()["set-cookie"]).toBeUndefined();
  expect(disabled.headers()["cache-control"]).toContain("no-store");
});

test("approved referral rules are public without implying live tracking", async ({ page, request }) => {
  await page.goto("/program");
  await expect(page.getByText(/Approved attribution rules: first-click credit within 7 days/)).toBeVisible();
  await expect(page.getByText(/self-referrals are not allowed/)).toBeVisible();
  const response = await request.post("/api/referrals/bridge", { data: { kind: "capture" } });
  expect(response.status()).toBe(503);
  expect(response.headers()["set-cookie"]).toBeUndefined();
});