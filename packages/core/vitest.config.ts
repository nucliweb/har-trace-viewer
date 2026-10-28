import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/parsers/trace-parser-node.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 100,
        branches: 90,
      },
    },
  },
});
