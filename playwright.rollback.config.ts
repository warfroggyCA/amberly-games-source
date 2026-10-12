import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/rollback",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "phone-chromium",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    {
      name: "landscape-chromium",
      use: {
        ...devices["iPhone 13 landscape"],
        defaultBrowserType: "chromium",
      },
    },
  ],
});
