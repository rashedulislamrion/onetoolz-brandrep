import { expect, test } from "@playwright/test";

test("public landing page is responsive and truthful", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const response = await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("earning opportunity.");
  await expect(page.getByText(/Income is not guaranteed/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore the OneToolz store" })).toHaveAttribute("href", "https://cu.onetoolz.com");
  await expect(page.getByText("Pre-launch", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(errors).toEqual([]);
});

test("opportunity journey supports registration, FAQs and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(await page.locator(".opportunity-art").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.getByText("Can I start earning today?", { exact: true }).click();
  await expect(page.getByText(/Not yet. The program is in pre-launch/)).toBeVisible();
  await page.getByRole("link", { name: "Start my partner journey" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { name: "Your next chapter starts here." })).toBeVisible();
});

test("navigation and disabled auth make setup state clear", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
  await expect(page.getByLabel("Email address")).toBeDisabled();
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const route of ["/dashboard", "/admin", "/application/status", "/reset-password", "/apply", "/account/security", "/admin/applications"]) {
  test(`anonymous access to ${route} fails closed`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login\?notice=setup$/);
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  });
}

test("callback cannot redirect to an attacker when unconfigured", async ({ request }) => {
  const response = await request.get("/auth/callback?code=fake&next=https://evil.example");
  expect(response.status()).toBe(503);
  expect(response.headers().location).toBeUndefined();
});

test("program and unknown route have useful states", async ({ page }) => {
  await page.goto("/program");
  await expect(page.getByText("Not yet open for earning or payouts")).toBeVisible();
  const response = await page.goto("/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
});