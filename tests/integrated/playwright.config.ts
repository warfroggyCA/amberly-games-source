import { defineConfig, devices } from "@playwright/test";

const origin = process.env.AMBERLY_INTEGRATED_ORIGIN;
if (!origin || new URL(origin).hostname !== "127.0.0.1")
  throw new Error("Run integrated checks through scripts/test-integrated.mjs.");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  outputDir: "../../output/integrated-tests",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: origin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
});
