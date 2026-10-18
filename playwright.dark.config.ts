import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Reuse existing gameplay scenarios against the system dark preference.
// The system-theme suite separately exercises both themes and live changes.
export default defineConfig({
  ...base,
  outputDir: "test-results-dark",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-dark" }],
  ],
  testMatch: [
    "**/scoring.spec.ts",
    "**/spectator.spec.ts",
    "**/crokinole-ui.spec.ts",
    "**/record-book.spec.ts",
    "**/gym-keyboard-entry.spec.ts",
    "**/gym-status-layout.spec.ts",
    "**/gym-history.spec.ts",
    "**/gym-word-lookup.spec.ts",
    "**/turn-coaching.spec.ts",
    "**/bingo-banner.spec.ts",
    "**/member-permissions.spec.ts",
    "**/game-sounds.spec.ts",
    "**/player-onboarding.spec.ts",
  ],
  projects: base.projects?.map((project) => ({
    ...project,
    use: { ...project.use, colorScheme: "dark" },
  })),
});
