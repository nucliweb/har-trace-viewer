import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { secretHar, secretTrace } from "../packages/core/tests/helpers/secret-har";

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

// Three CDNs over HTTP/2 and HTTP/3, without a trace: the HAR's initiators say what blocks rendering.
const MULTI_CDN_PAGE = [
  "--page",
  "Multi CDN",
  "--har",
  resolve(fixtures, "multi-cdn.har.fixture.json"),
];

// A repeat visit recorded with the browser cache enabled: its steps list cache hits.
const CACHED_PAGE = [
  "--page",
  "Cached",
  "--har",
  resolve(recordings, "webperf-snippets.nucliweb.net_Cache-20260519T123746.har.gz"),
];

// The same site recorded with the browser cache disabled (A) and enabled (B), with traces.
const COMPARE_PAGES = [
  "--page",
  "Without cache",
  "--har",
  resolve(recordings, "webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har.gz"),
  "--trace",
  resolve(recordings, "WebPerf-Snippets-Disable-Cache_Trace-20260519T123602.json.gz"),
  "--page",
  "With cache",
  "--har",
  resolve(recordings, "webperf-snippets.nucliweb.net_Cache-20260519T123746.har.gz"),
  "--trace",
  resolve(recordings, "WebPerf-Snippets-Cache_Trace-20260519T123746.json.gz"),
];

// Ten thousand synthetic requests on one page: the waterfall renders the rows near its view only.
const LARGE_HAR = resolve(OUTPUT, "large.har.json.gz");
const LARGE_PAGE = ["--page", "Large", "--har", LARGE_HAR];

// A synthetic HAR and trace with a secret in every header and URL that can carry one: the
// report shows them masked.
const SECRET_HAR = resolve(OUTPUT, "secret.har");
const SECRET_TRACE = resolve(OUTPUT, "secret.trace.json");
const SECRET_PAGE = ["--page", "Secrets", "--har", SECRET_HAR, "--trace", SECRET_TRACE];

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
  // Two pages: a link to a later step opens on the second one.
  generate(resolve(OUTPUT, "two-pages"), ["--bundle"], [...HOME_PAGE, ...PROBLEMS_PAGE]);
  generate(resolve(OUTPUT, "multi-cdn"), ["--bundle"], MULTI_CDN_PAGE);
  generate(resolve(OUTPUT, "compare"), ["--compare", "--bundle"], COMPARE_PAGES);
  execFileSync(
    process.execPath,
    [resolve(root, "packages/core/scripts/gen-large-har.mjs"), LARGE_HAR, "10000"],
    { stdio: "pipe" }
  );
  generate(resolve(OUTPUT, "large"), ["--bundle"], LARGE_PAGE);
  // The large page against itself: a comparison of ten thousand pairs of requests.
  generate(resolve(OUTPUT, "large-compare"), ["--bundle", "--compare-with", LARGE_HAR], LARGE_PAGE);
  writeFileSync(SECRET_HAR, JSON.stringify(secretHar()));
  writeFileSync(SECRET_TRACE, JSON.stringify(secretTrace()));
  generate(resolve(OUTPUT, "secrets"), ["--bundle"], SECRET_PAGE);
}
