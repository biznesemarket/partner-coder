import { defineConfig, devices } from "@playwright/test";

import e2eEnv from "./e2e/env.json" with { type: "json" };

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://localhost:3001",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node ../api/dist/main.js",
      url: "http://localhost:4000/healthz",
      env: e2eEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm start",
      url: "http://localhost:3001/login",
      env: {
        API_BASE_URL: "http://localhost:4000",
        VENDOR_BASE_URL: "http://localhost:3001",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
