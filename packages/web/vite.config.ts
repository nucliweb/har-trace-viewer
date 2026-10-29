import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The product version is the CLI package's: it is what npm publishes, and its reports bundle this app.
const { version } = JSON.parse(
  readFileSync(new URL("../cli/package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: { __HTV_VERSION__: JSON.stringify(version) },
});
