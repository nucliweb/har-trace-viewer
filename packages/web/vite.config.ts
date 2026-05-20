import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@htv/core/types.js",                      replacement: resolve(__dirname, "../core/src/types.ts") },
      { find: "@htv/core/parsers/har-parser.js",         replacement: resolve(__dirname, "../core/src/parsers/har-parser.ts") },
      { find: "@htv/core/parsers/trace-parser.js",       replacement: resolve(__dirname, "../core/src/parsers/trace-parser.ts") },
      { find: "@htv/core/inference/node-detector.js",    replacement: resolve(__dirname, "../core/src/inference/node-detector.ts") },
      { find: "@htv/core/steps/step-generator.js",       replacement: resolve(__dirname, "../core/src/steps/step-generator.ts") },
      { find: "@htv/core",                               replacement: resolve(__dirname, "../core/src/index.ts") },
    ],
  },
});
