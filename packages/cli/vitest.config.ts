import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    globalSetup: ["tests/global-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/version.d.ts"],
      reporter: ["text", "lcov"],
      // A ratchet. Many tests run the built bundle in dist/ as a child process, which this
      // measurement does not see: cli.ts, index.ts and run.tsx are covered mostly that way.
      thresholds: { statements: 79, branches: 73, functions: 84, lines: 80 },
    },
  },
});
