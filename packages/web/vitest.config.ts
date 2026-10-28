import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      // Node 25 ships an experimental global localStorage that shadows jsdom's.
      execArgv: ["--no-experimental-webstorage"],
      setupFiles: ["tests/setup.ts"],
      include: ["tests/**/*.test.{ts,tsx}"],
      css: { modules: { classNameStrategy: "non-scoped" } },
      coverage: {
        provider: "v8",
        include: ["src/hooks/**", "src/lib/**"],
        exclude: ["src/lib/parse-protocol.ts"],
        reporter: ["text", "lcov"],
        thresholds: {
          lines: 80,
          "src/hooks/**": { lines: 100 },
        },
      },
    },
  })
);
