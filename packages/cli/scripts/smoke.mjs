// Package smoke test: packs the CLI, installs the tarball into a fresh project and runs the
// installed `htv` the way a user would. Run `npm run build` first. The package bundles its
// dependencies, so the install adds nothing but the package itself.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = resolve(cliDir, "../../fixtures");
const { version } = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));
const har = join(fixtures, "webperf-snippets.nucliweb.net_Cache-20260519T123746.har");
const trace = join(fixtures, "WebPerf-Snippets-Cache_Trace-20260519T123746.json.gz");

const MIN_HTML_BYTES = 100_000;
const MIN_JSON_BYTES = 1_000;

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
}

/** Total size in bytes of the files under path, without following links such as .bin/htv. */
function sizeOf(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((total, entry) => total + sizeOf(join(path, entry)), 0);
}

/** The packages installed at the top of node_modules, scoped ones as "@scope/name". */
function installedPackages(nodeModules) {
  return readdirSync(nodeModules)
    .filter((entry) => !entry.startsWith("."))
    .flatMap((entry) =>
      entry.startsWith("@")
        ? readdirSync(join(nodeModules, entry)).map((name) => `${entry}/${name}`)
        : [entry]
    );
}

const work = mkdtempSync(join(tmpdir(), "htv-smoke-"));
try {
  const packDir = join(work, "pack");
  const project = join(work, "project");
  mkdirSync(packDir);
  mkdirSync(project);

  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packDir], cliDir));
  const tarball = join(packDir, packed[0].filename);
  console.log(
    `packed ${packed[0].filename} (${packed[0].size} bytes, ${packed[0].files.length} files)`
  );

  run("npm", ["init", "-y"], project);
  run("npm", ["install", "--no-audit", "--no-fund", tarball], project);

  const nodeModules = join(project, "node_modules");
  const installed = installedPackages(nodeModules);
  assert(
    installed.length === 1 &&
      installed[0] === "har-trace-viewer" &&
      !existsSync(join(nodeModules, "har-trace-viewer", "node_modules")),
    `the install added more than the package itself: ${installed.join(", ")}`
  );
  console.log(`installed: ${installed.join(", ")} (${sizeOf(nodeModules)} bytes)`);

  const printed = run("npx", ["--no-install", "htv", "--version"], project).trim();
  assert(printed.includes(version), `--version printed "${printed}", expected ${version}`);
  const bin = join(nodeModules, ".bin", "htv");
  const runs = 5;
  const start = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) run(bin, ["--version"], project);
  const averageMs = Number(process.hrtime.bigint() - start) / 1e6 / runs;
  console.log(
    `htv --version: ${printed} (${averageMs.toFixed(0)} ms on average over ${runs} runs)`
  );

  const htmlPath = join(project, "report.html");
  const jsonPath = join(project, "report.json");
  run("npx", ["--no-install", "htv", har, trace, "-o", htmlPath], project);
  run("npx", ["--no-install", "htv", har, trace, "-o", jsonPath], project);

  for (const [path, min] of [
    [htmlPath, MIN_HTML_BYTES],
    [jsonPath, MIN_JSON_BYTES],
  ]) {
    assert(existsSync(path), `${path} was not written`);
    const size = statSync(path).size;
    assert(size >= min, `${path} is only ${size} bytes`);
    console.log(`${path.split("/").pop()}: ${size} bytes`);
  }

  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert(json !== null && typeof json === "object", "the JSON report is not an object");

  // A self-contained report must not point at files that are not inside it
  const html = readFileSync(htmlPath, "utf8");
  const missing = [
    ...html.matchAll(/\b(?:src|href)="((?:\.{0,2}\/)[^"]*\.(?:js|css|png|ico|svg|woff2?|txt))"/g),
  ].map((m) => m[1]);
  assert(missing.length === 0, `the HTML references local files: ${missing.join(", ")}`);
  for (const name of ["og.png", "apple-touch-icon", "robots.txt"]) {
    assert(!html.includes(name), `the HTML references ${name}`);
  }
  console.log("smoke test passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
