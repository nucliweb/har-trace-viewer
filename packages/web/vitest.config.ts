import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

// The app's Vite config, as the tests see it: the relative build, not the public site's.
export default mergeConfig(
  viteConfig({ command: "serve", mode: "test" }),
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
        include: ["src/hooks/**", "src/lib/**", "src/components/**"],
        // export-browser.ts needs a real browser: covered by e2e/export.spec.ts.
        exclude: ["src/lib/parse-protocol.ts", "src/lib/export-browser.ts"],
        reporter: ["text", "lcov"],
        thresholds: {
          lines: 80,
          "src/hooks/**": { lines: 100 },
          // A ratchet a few points under what the component tests reach.
          "src/components/**": { statements: 94, branches: 87, functions: 94, lines: 95 },
        },
      },
    },
  })
);
