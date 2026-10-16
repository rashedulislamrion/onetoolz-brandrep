import { defineConfig, devices } from "@playwright/test";
import { liveAuthConfiguration } from "./tests/support/live-auth-config";

// Credentials must be injected into this test process, never into browser storage.
liveAuthConfiguration(process.env);

export default defineConfig({
  testDir: "./tests/live-auth",
  workers: 1,
  retries: 0,
  timeout: 120000,
  forbidOnly: true,
  reporter: "list",
  use: { baseURL: "http://localhost:3300", trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "desktop-live-auth", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --port 3300",
    url: "http://localhost:3300",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      AUTH_ENABLED: "true", APP_ENV: "local", SUPABASE_ENVIRONMENT: "nonproduction", APP_ORIGIN: "http://localhost:3300",
      // Explicitly remove the inherited test admin credential from the application process.
      E2E_SUPABASE_SECRET_KEY: "",
    },
  },
});