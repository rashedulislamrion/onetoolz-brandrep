import { defineConfig, devices } from "@playwright/test";

// Separate from auth-disabled foundation tests. No account mutations or credentials.
export default defineConfig({
  testDir: "./tests/auth-e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3200", trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run start -- --port 3200",
    url: "http://localhost:3200",
    reuseExistingServer: false,
    env: { AUTH_ENABLED: "true", APP_ENV: "local", APP_ORIGIN: "http://localhost:3200", SUPABASE_ENVIRONMENT: "nonproduction" },
    timeout: 120000,
  },
});