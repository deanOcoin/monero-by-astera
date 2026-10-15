import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ui",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: {
    channel: "chrome",
    trace: "on-first-retry",
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1180, height: 820 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
  reporter: "list",
});
