// Regenerates src/demo/demo-flow.json from the core test fixtures.
// Run with: npm run demo:build -w @htv/web
import { createServer } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, "../../core");
const fixtures = resolve(core, "tests/fixtures");
const out = resolve(here, "../src/demo/demo-flow.json");

// @htv/core ships TypeScript sources; Vite's SSR loader runs them as they are.
const vite = await createServer({
  configFile: false,
  root: core,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  logLevel: "error",
});

try {
  const { parseHarPagesJson, expandPageFlows, generateFlow } = await vite.ssrLoadModule(
    resolve(core, "src/index.ts")
  );
  const { parseTraceFile } = await vite.ssrLoadModule(
    resolve(core, "src/parsers/trace-parser-node.ts")
  );

  const har = parseHarPagesJson(
    readFileSync(resolve(fixtures, "webperf-snippets.har.fixture.json"), "utf-8")
  );
  const trace = await parseTraceFile(resolve(fixtures, "webperf-snippets.trace.fixture.json"));
  const pages = expandPageFlows({ name: "Home", har, trace });
  const json = JSON.stringify(generateFlow(pages, { clientRegion: "default" }));

  writeFileSync(out, json + "\n");
  console.log(`Wrote ${out} (${(json.length / 1024).toFixed(1)} KB)`);
} finally {
  await vite.close();
}
