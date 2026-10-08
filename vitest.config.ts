import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    // Retention regressions assert collection of released history objects.
    execArgv: ["--expose-gc"],
    include: ["tests/**/*.test.ts"],
    coverage: { include: ["src/domain/**", "src/lib/**"] },
  },
});
