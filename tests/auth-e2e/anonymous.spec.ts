import { expect, test } from "@playwright/test";

test("configured login is enabled without exposing a session", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

for (const route of ["/dashboard", "/admin", "/admin/applications", "/admin/settings", "/apply", "/application/status", "/account/security", "/reset-password"]) {
  test(`configured authentication rejects anonymous ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL("http://localhost:3200/login?notice=session");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  });
}

test("missing callback code cannot redirect off site", async ({ request }) => {
  const response = await request.get("/auth/callback?next=https://evil.example", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe("http://localhost:3200/login?notice=callback");
});