import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "packages/cli/dist/index.js");
const fixtures = resolve(root, "packages/core/tests/fixtures");
const recordings = resolve(root, "fixtures");

export const OUTPUT = resolve(root, "e2e/.output");

const HOME_PAGE = [
  "--page",
  "Home",
  "--har",
  resolve(fixtures, "webperf-snippets.har.fixture.json"),
  "--trace",
  resolve(fixtures, "webperf-snippets.trace.fixture.json"),
];

// Redirects, failed requests, mixed content and a duplicate: findings that need fixing.
const PROBLEMS_PAGE = [
  "--page",
  "Problems",
  "--har",
  resolve(fixtures, "network-problems.har.fixture.json"),
];

// A repeat visit recorded with the browser cache enabled: its steps list cache hits.
const CACHED_PAGE = [
  "--page",
  "Cached",
  "--har",
  resolve(recordings, "webperf-snippets.nucliweb.net_Cache-20260519T123746.har"),
];

// The same site recorded with the browser cache disabled (A) and enabled (B), with traces.
const COMPARE_PAGES = [
  "--page",
  "Without cache",
  "--har",
  resolve(recordings, "webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har"),
  "--trace",
  resolve(recordings, "WebPerf-Snippets-Disable-Cache_Trace-20260519T123602.json.gz"),
  "--page",
  "With cache",
  "--har",
  resolve(recordings, "webperf-snippets.nucliweb.net_Cache-20260519T123746.har"),
  "--trace",
  resolve(recordings, "WebPerf-Snippets-Cache_Trace-20260519T123746.json.gz"),
];

function generate(dir: string, extraArgs: string[], page = HOME_PAGE) {
  execFileSync(process.execPath, [cli, ...page, "--output", dir, ...extraArgs], {
    stdio: "pipe",
  });
}

export default function globalSetup() {
  if (!existsSync(cli)) {
    throw new Error(`${cli} not found. Run "npm run build" before "npm run e2e".`);
  }
  rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(OUTPUT, { recursive: true });
  generate(resolve(OUTPUT, "bundle"), ["--bundle"]);
  generate(resolve(OUTPUT, "plain"), []);
  generate(resolve(OUTPUT, "cached"), ["--bundle"], CACHED_PAGE);
  generate(resolve(OUTPUT, "problems"), ["--bundle"], PROBLEMS_PAGE);
  generate(resolve(OUTPUT, "compare"), ["--compare", "--bundle"], COMPARE_PAGES);
}
