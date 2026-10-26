import { expect, test } from "@playwright/test";

test("public landing page is responsive and truthful", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const response = await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your Revenue.");
  await expect(page.getByText(/Income is not guaranteed/).first()).toBeVisible();
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
  await page.getByRole("link", { name: "Apply to Earn →", exact: true }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { name: "Your next chapter starts here." })).toBeVisible();
});

test("calculator uses explicit assumptions, not invented program rates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Explore the Rewards" }).click();
  await expect(page).toHaveURL(/#calculator$/);
  const calculator = page.locator("#calculator");
  await expect(calculator.locator("output")).toHaveText("—");
  const commission = calculator.getByLabel("Assumed commission per qualifying sale");
  await expect(commission).toHaveValue("");
  await commission.fill("10");
  await expect(calculator.locator("output")).toHaveText("50.00");
  await calculator.getByLabel("Projection period").selectOption("yearly");
  await expect(calculator.locator("output")).toHaveText("600.00");
  await calculator.getByLabel("Expected monthly referred visitors").fill("-1");
  await expect(calculator.locator("output")).toHaveText("—");
  await calculator.getByLabel("Expected monthly referred visitors").fill("100");
  await commission.fill("");
  await expect(calculator.locator("output")).toHaveText("—");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

for (const route of ["/dashboard", "/dashboard/payouts", "/admin", "/admin/payouts", "/admin/reconciliation", "/application/status", "/reset-password", "/apply", "/account/security", "/admin/applications"]) {
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