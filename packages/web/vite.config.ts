import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: [
      {
        find: "@htv/core/types.js",
        replacement: resolve(import.meta.dirname, "../core/src/types.ts"),
      },
      {
        find: "@htv/core/parsers/har-parser.js",
        replacement: resolve(import.meta.dirname, "../core/src/parsers/har-parser.ts"),
      },
      {
        find: "@htv/core/parsers/trace-parser.js",
        replacement: resolve(import.meta.dirname, "../core/src/parsers/trace-parser.ts"),
      },
      {
        find: "@htv/core/inference/node-detector.js",
        replacement: resolve(import.meta.dirname, "../core/src/inference/node-detector.ts"),
      },
      {
        find: "@htv/core/steps/step-generator.js",
        replacement: resolve(import.meta.dirname, "../core/src/steps/step-generator.ts"),
      },
      { find: "@htv/core", replacement: resolve(import.meta.dirname, "../core/src/index.ts") },
    ],
  },
});
