import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  outputDir: "../test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  retries: 0,
  timeout: 30_000,
  fullyParallel: true,
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
