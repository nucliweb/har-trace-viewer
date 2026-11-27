#!/usr/bin/env node
// Times the main operations of @htv/core on synthetic input: a median and a spread over
// several runs after a warm-up. Results depend on the machine: compare runs from the same one.
//
// Usage (from packages/core, through `npm run bench`):
//   npm run bench -- [--requests 10000] [--large] [--runs 7] [--warmup 2]
//                    [--only parse,flow] [--json [file]] [--cpu-profile file]
//
//   --requests N        requests per synthetic recording (default 10000)
//   --large             use 100000 requests (needs several GB of memory)
//   --runs N            measured runs per operation (default 7, 3 with --large)
//   --warmup N          unmeasured runs before them (default 2, 1 with --large)
//   --only a,b          run only the operations whose key is listed (see OPERATIONS below)
//   --json [file]       print the results as JSON (to stdout) or write them to the file
//   --cpu-profile file  write a V8 .cpuprofile of the measured runs (inputs are built before it
//                       starts); read it with scripts/analyze-cpuprofile.mjs
//
// Core has no build step and imports its own files with ".js" specifiers that name ".ts" files,
// so this script registers a resolve hook for them. Node strips the types, and
// --experimental-transform-types covers the few TypeScript features that need more (parameter
// properties), which the `bench` script passes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { generateTrace } from "./gen-large-trace.mjs";

const here = dirname(fileURLToPath(import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js")) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

const core = await import(pathToFileURL(join(here, "..", "src", "index.ts")).href);

// ── Options ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = { requests: 10_000, large: false, only: null, json: null, cpuProfile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === "--requests") options.requests = Number(value());
    else if (arg === "--large") options.large = true;
    else if (arg === "--runs") options.runs = Number(value());
    else if (arg === "--warmup") options.warmup = Number(value());
    else if (arg === "--only") options.only = value().split(",");
    else if (arg === "--cpu-profile") options.cpuProfile = value();
    else if (arg === "--json") {
      const next = argv[i + 1];
      options.json = next === undefined || next.startsWith("--") ? "-" : value();
    } else throw new Error(`Unknown option ${arg}`);
  }
  if (options.large) options.requests = 100_000;
  options.runs ??= options.large ? 3 : 7;
  options.warmup ??= options.large ? 1 : 2;
  if (!Number.isInteger(options.requests) || options.requests < 1) {
    throw new Error("--requests needs a positive integer");
  }
  return options;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

// The large HAR comes from gen-large-har.mjs (deterministic), read back from a temporary file.
function generateRawHar(requests) {
  const dir = mkdtempSync(join(tmpdir(), "htv-bench-"));
  try {
    const file = join(dir, "large.har.gz");
    execFileSync(process.execPath, [join(here, "gen-large-har.mjs"), file, String(requests)], {
      stdio: "ignore",
      maxBuffer: 1 << 30,
    });
    return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A variant of the recording to compare against: slower responses and 5% of the requests gone.
function variantOf(raw) {
  const copy = structuredClone(raw);
  copy.log.entries = copy.log.entries.filter((_, i) => i === 0 || i % 20 !== 0);
  for (const entry of copy.log.entries) {
    entry.timings.wait = Math.round(entry.timings.wait * 1.1);
    entry.time = entry.timings.wait + 20;
  }
  return copy;
}

const pageFlowsOf = (pages, trace) =>
  pages.map((har, i) => ({
    name: core.defaultPageName(har.pages[0], i, har.documentEntry.url),
    har,
    ...(trace ? { trace } : {}),
  }));

function buildInputs(requests) {
  const raw = generateRawHar(requests);
  const urls = raw.log.entries.map((e) => e.request.url);
  const rawTrace = generateTrace({ requests, urls });
  const pages = core.parseHarPages(raw);
  const trace = core.parseTrace(rawTrace);
  const flow = core.generateFlow(pageFlowsOf(pages, trace));
  const variant = core.generateFlow(pageFlowsOf(core.parseHarPages(variantOf(raw)), trace));
  const [har] = pages;
  // The inputs must make the parsers do real work: fail loudly if a change of the generators
  // leaves the trace without requests or a main-thread profile.
  if (!trace.mainThread || !trace.lcpCandidate || (trace.requests?.length ?? 0) < requests * 0.9) {
    throw new Error("The synthetic trace did not parse into requests, an LCP and a main thread");
  }
  const json = JSON.stringify(raw);
  return { raw, json, rawTrace, pages, trace, flow, variant, har };
}

// ── Operations ───────────────────────────────────────────────────────────────

const OPERATIONS = [
  ["json", "JSON.parse (reference)", (i) => JSON.parse(i.json)],
  ["parse", "parseHarPages", (i) => core.parseHarPages(i.raw)],
  ["trace", "parseTrace", (i) => core.parseTrace(i.rawTrace)],
  ["flow", "generateFlow", (i) => core.generateFlow(pageFlowsOf(i.pages, i.trace))],
  ["findings", "collectFindings", (i) => core.collectFindings(i.flow)],
  ["report", "markdownReport", (i) => core.markdownReport(i.flow)],
  ["compare", "compareFlows", (i) => core.compareFlows(i.flow, i.variant)],
  ["report-compare", "markdownReport (compare)", (i) => core.markdownReport(i.flow, i.variant)],
  ["redact", "redactFlows", (i) => core.redactFlows([i.flow])],
  [
    "redact-mask",
    "redactFlows (hosts: mask)",
    (i) => core.redactFlows([i.flow], { hosts: "mask" }),
  ],
  ["waterfall", "buildWaterfall", (i) => core.buildWaterfall(i.har, i.trace)],
];

// ── Measuring ────────────────────────────────────────────────────────────────

const median = (sorted) => {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function measure(run, { runs, warmup }) {
  for (let i = 0; i < warmup; i++) run();
  const times = [];
  for (let i = 0; i < runs; i++) {
    globalThis.gc?.();
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { medianMs: median(sorted), minMs: sorted[0], maxMs: sorted.at(-1), runsMs: times };
}

const ms = (value) => (value >= 100 ? value.toFixed(0) : value.toFixed(1));

function printTable(results, options) {
  const header = ["operation", "requests", "median ms", "min ms", "max ms", "spread"];
  const rows = results.map((r) => [
    r.operation,
    String(options.requests),
    ms(r.medianMs),
    ms(r.minMs),
    ms(r.maxMs),
    `${(((r.maxMs - r.minMs) / r.medianMs) * 100).toFixed(0)}%`,
  ]);
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((row) => row[c].length)));
  const line = (cells) =>
    cells
      .map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c])))
      .join("  ");
  console.error(line(header));
  console.error(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.error(line(row));
  console.error(
    `\n${options.runs} runs after ${options.warmup} warm-up, spread = (max - min) / median`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selected = OPERATIONS.filter(
    ([key]) => options.only === null || options.only.includes(key)
  );
  if (selected.length === 0) throw new Error("--only matches no operation");

  console.error(`Building inputs for ${options.requests} requests...`);
  const inputs = buildInputs(options.requests);

  let session = null;
  if (options.cpuProfile !== null) {
    const { Session } = await import("node:inspector/promises");
    session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    // A fine sampling interval (100 µs) so short functions still show up.
    await session.post("Profiler.setSamplingInterval", { interval: 100 });
    await session.post("Profiler.start");
  }

  const results = selected.map(([key, operation, run]) => {
    console.error(`  ${operation}`);
    return { key, operation, requests: options.requests, ...measure(() => run(inputs), options) };
  });

  if (session !== null) {
    const { profile } = await session.post("Profiler.stop");
    writeFileSync(options.cpuProfile, JSON.stringify(profile));
    console.error(`CPU profile written to ${options.cpuProfile}`);
  }

  printTable(results, options);
  if (options.json !== null) {
    const report = {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      requests: options.requests,
      runs: options.runs,
      warmup: options.warmup,
      results: results.map(({ key, operation, requests, medianMs, minMs, maxMs, runsMs }) => ({
        key,
        operation,
        requests,
        medianMs,
        minMs,
        maxMs,
        runsMs,
      })),
    };
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (options.json === "-") process.stdout.write(text);
    else writeFileSync(options.json, text);
  }
}

await main();
