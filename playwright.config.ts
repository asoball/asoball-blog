import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  workers: 2,
  webServer: [
    {
      command: "pnpm --filter cms start",
      url: "http://127.0.0.1:3000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: "pnpm preview:static",
      url: "http://127.0.0.1:4322",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm exec tsx scripts/preview-publishing.ts",
      url: "http://127.0.0.1:4330",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
  snapshotPathTemplate:
    "{testDir}/../../apps/blog/tests/visual/baseline/{platform}/{arg}{ext}",
  use: {
    baseURL: process.env.BLOG_TEST_URL || "http://127.0.0.1:4322",
    locale: "zh-TW",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
