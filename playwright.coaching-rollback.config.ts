import { defineConfig } from "@playwright/test";
import base from "./playwright.rollback.config";
export default defineConfig({ ...base, testDir: "./tests/coaching-rollback" });
