import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// React reports attribute mismatches in development, not the normal production test server.
process.env.GYM_HYDRATION_DEV = "true";
export default defineConfig({
  ...base,
  testMatch: "hydration.spec.ts",
  projects: base.projects?.filter(
    (project) => project.name === "desktop-chromium",
  ),
  workers: 1,
  use: { ...base.use, baseURL: "http://localhost:4321" },
  webServer: {
    command: "npm run gym:preview",
    url: "http://localhost:4321/gym-lab",
    reuseExistingServer: true,
    timeout: 90000,
  },
});
