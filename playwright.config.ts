import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Keep Linux WebKit from competing for the shared runner's CPU.
  workers: process.env.CI ? 1 : undefined,
  timeout: process.env.CI ? 90_000 : 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4319",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } },
    { name: "ipad-webkit", use: { ...devices["iPad Pro 11"] } },
    { name: "iphone-landscape", use: { ...devices["iPhone 13 landscape"] } },
  ],
  webServer: {
    command: "node scripts/start-browser-tests.mjs",
    url: "http://127.0.0.1:4319",
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
