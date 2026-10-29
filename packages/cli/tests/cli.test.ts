import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, bundleHtml } from "../src/cli";
import { twoPageHar } from "../../core/tests/helpers/firefox-har";
import { wptHar } from "../../core/tests/helpers/wpt-har";

const CLI_ROOT = resolve(__dirname, "..");
const DIST_ENTRY = join(CLI_ROOT, "dist", "index.js");
const FIXTURES = resolve(CLI_ROOT, "..", "core", "tests", "fixtures");
const HAR = join(FIXTURES, "webperf-snippets.har.fixture.json");
const TRACE = join(FIXTURES, "webperf-snippets.trace.fixture.json");

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "htv-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runCli(args: string[]) {
  return spawnSync("node", [DIST_ENTRY, ...args], { encoding: "utf-8" });
}

function extractFlow(html: string): Record<string, unknown> {
  const match = html.match(/window\.__HTV_FLOW__ = (.*?);<\/script>/s);
  if (!match) throw new Error("window.__HTV_FLOW__ not found in index.html");
  return JSON.parse(match[1]);
}

// The end-to-end tests run the built CLI. The build takes ~10 s, so it is not
// triggered here: run `npm run build` before `npm test`.
beforeAll(() => {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(`${DIST_ENTRY} is missing. Run "npm run build" before running the CLI tests.`);
  }
});

describe("parseArgs", () => {
  it("parses a single page with har and trace", () => {
    expect(
      parseArgs(["--page", "Home", "--har", "a.har", "--trace", "t.json", "--output", "out"])
    ).toEqual({
      pages: [{ name: "Home", har: "a.har", trace: "t.json" }],
      output: "out",
      bundle: false,
    });
  });

  it("assigns --har and --trace to the most recent --page", () => {
    const { pages } = parseArgs([
      "--page",
      "A",
      "--har",
      "a",
      "--page",
      "B",
      "--har",
      "b",
      "--trace",
      "t",
    ]);
    expect(pages).toEqual([
      { name: "A", har: "a" },
      { name: "B", har: "b", trace: "t" },
    ]);
  });

  it("attaches --select to the most recent --page", () => {
    const { pages } = parseArgs(["--page", "A", "--har", "a", "--select", "page_2", "--page", "B"]);
    expect(pages).toEqual([
      { name: "A", har: "a", select: "page_2" },
      { name: "B", har: "" },
    ]);
  });

  it("sets listPages with --list-pages", () => {
    expect(parseArgs(["--har", "a", "--list-pages"]).listPages).toBe(true);
    expect(parseArgs(["--har", "a"]).listPages).toBeUndefined();
  });

  it('creates "Page 1" when --har has no preceding --page', () => {
    expect(parseArgs(["--har", "a.har"]).pages).toEqual([{ name: "Page 1", har: "a.har" }]);
  });

  it("accepts -o as an alias of --output", () => {
    expect(parseArgs(["-o", "dir"]).output).toBe("dir");
  });

  it("sets bundle with --bundle", () => {
    expect(parseArgs(["--bundle"]).bundle).toBe(true);
    expect(parseArgs([]).bundle).toBe(false);
  });

  it("parses --region cn and --region default", () => {
    expect(parseArgs(["--har", "a.har", "--region", "cn"]).region).toBe("cn");
    expect(parseArgs(["--region", "default"]).region).toBe("default");
  });

  it("leaves region undefined when --region is absent", () => {
    expect(parseArgs(["--har", "a.har"]).region).toBeUndefined();
  });

  it("rejects an unknown region listing the valid values", () => {
    expect(() => parseArgs(["--region", "eu"])).toThrow(/default, cn/);
    expect(() => parseArgs(["--region"])).toThrow(/region/);
  });

  it("throws the parseArgs error for an unknown option", () => {
    expect(() => parseArgs(["--foo"])).toThrow(/Unknown option '--foo'/);
  });

  it("rejects positional arguments", () => {
    expect(() => parseArgs(["stray"])).toThrow();
  });

  it("sets help and version with long and short flags", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
    expect(parseArgs([]).help).toBeUndefined();
  });
});

describe("--help, --version and --output (built CLI)", () => {
  const pkgVersion = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf-8")).version;

  it("prints the usage to stdout and exits 0 with --help", () => {
    const res = runCli(["--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage");
    expect(res.stdout).toContain("--bundle");
    expect(res.stdout).toContain("Example");
  });

  it("prints the package.json version and exits 0 with --version", () => {
    const res = runCli(["--version"]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(pkgVersion);
  });

  it("exits 1 with Unknown option and the usage for an unknown flag", () => {
    const res = runCli(["--foo"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option '--foo'");
    expect(res.stderr).toContain("Usage");
  });

  it("writes a single file to a .html output path with --bundle", () => {
    const target = join(makeTempDir(), "out.html");
    const res = runCli(["--har", HAR, "--output", target, "--bundle"]);
    expect(res.status).toBe(0);
    expect(readFileSync(target, "utf-8")).toContain("window.__HTV_FLOW__");
    expect(readdirSync(join(target, ".."))).toEqual(["out.html"]);
  });

  it("exits 1 when --output is a .html path without --bundle", () => {
    const target = join(makeTempDir(), "out.html");
    const res = runCli(["--har", HAR, "--output", target]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--output must be a directory unless --bundle is set");
    expect(existsSync(target)).toBe(false);
  });

  it("reads a gzipped HAR", () => {
    const dir = makeTempDir();
    const gz = join(dir, "a.har.gz");
    writeFileSync(gz, gzipSync(readFileSync(HAR)));
    const res = runCli(["--har", gz, "--output", join(dir, "out")]);
    expect(res.status).toBe(0);
  });
});

describe("usage errors (built CLI)", () => {
  it("exits 1 and prints usage without arguments", () => {
    const res = runCli([]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage:");
  });

  it("exits 1 listing the valid values when --region is unknown", () => {
    const res = runCli(["--har", HAR, "--region", "mars", "--output", join(makeTempDir(), "out")]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Invalid --region "mars"');
    expect(res.stderr).toContain("default, cn");
  });

  it("exits 1 with a Missing --har message when a page has no har", () => {
    const res = runCli(["--page", "X", "--output", join(makeTempDir(), "out")]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Missing --har for page "X"');
  });
});

describe("end to end without --bundle (built CLI)", () => {
  it("generates index.html and assets with the flow injected safely", () => {
    const dir = makeTempDir();
    const hostileHar = JSON.parse(readFileSync(HAR, "utf-8"));
    hostileHar.log.entries[0].request.url += "?q=</script><script>alert(1)</script>";
    const harPath = join(dir, "hostile.har");
    writeFileSync(harPath, JSON.stringify(hostileHar));
    const out = join(dir, "report");

    const res = runCli(["--page", "My Page", "--har", harPath, "--trace", TRACE, "--output", out]);
    expect(res.status, res.stderr).toBe(0);

    const assets = readdirSync(join(out, "assets"));
    expect(assets.filter((f) => /^index-.*\.js$/.test(f))).toHaveLength(1);
    expect(assets.filter((f) => /^parse\.worker-.*\.js$/.test(f)).length).toBeLessThanOrEqual(1);
    expect(assets.filter((f) => f.endsWith(".css"))).toHaveLength(1);

    const html = readFileSync(join(out, "index.html"), "utf-8");
    const flow = extractFlow(html) as { pages: { name: string }[] };
    for (const key of ["pages", "steps", "nodes", "paths", "cacheReport"]) {
      expect(flow).toHaveProperty(key);
    }
    expect(flow.pages[0].name).toBe("My Page");

    const payload = html.match(/window\.__HTV_FLOW__ = (.*?);<\/script>/s)![1];
    expect(payload.toLowerCase()).not.toContain("</script");
    expect(JSON.stringify(flow)).toContain("</script><script>alert(1)</script>");
  });
});

describe("embedded flow size (built CLI)", () => {
  interface EmbeddedEntry {
    url: string;
    responseHeaders: Record<string, string>;
  }
  interface EmbeddedFlow {
    pages: { har: { entries: EmbeddedEntry[] } }[];
    steps: Record<string, unknown>[];
  }

  function generate(): EmbeddedFlow {
    const out = join(makeTempDir(), "report");
    const res = runCli(["--page", "Home", "--har", HAR, "--trace", TRACE, "--output", out]);
    expect(res.status, res.stderr).toBe(0);
    return extractFlow(readFileSync(join(out, "index.html"), "utf-8")) as unknown as EmbeddedFlow;
  }

  it("steps reference the page entries by index instead of embedding copies", () => {
    const flow = generate();
    const { entries } = flow.pages[0].har;

    const refs = flow.steps.flatMap((step) => [
      ...((step.resourceRefs as number[] | undefined) ?? []),
      ...((step.cacheResourceRefs as number[] | undefined) ?? []),
    ]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(entries[ref]).toBeDefined();
    for (const step of flow.steps) {
      expect(step).not.toHaveProperty("resources");
      expect(step).not.toHaveProperty("cacheResources");
    }
  });

  it("embeds only the allow-listed response headers", () => {
    const names = new Set(
      generate().pages[0].har.entries.flatMap((e) => Object.keys(e.responseHeaders))
    );

    expect(names.has("cache-control")).toBe(true);
    expect(names.has("x-matched-path")).toBe(false);
    expect(names.has("content-disposition")).toBe(false);
  });
});

describe("client region (built CLI)", () => {
  // Same HAR with a 350 ms document connection: latency compatible with GFW routing.
  function writeSlowHar(dir: string): string {
    const har = JSON.parse(readFileSync(HAR, "utf-8"));
    har.log.entries[0].timings.connect = 350;
    const harPath = join(dir, "slow.har");
    writeFileSync(harPath, JSON.stringify(har));
    return harPath;
  }

  interface EmbeddedFlow {
    version: number;
    clientRegion: string;
    hints: { suggestedClientRegion?: { region: string; reason: string } };
    nodes: { id: string }[];
  }

  it("keeps the default topology and prints a note when latencies suggest China", () => {
    const dir = makeTempDir();
    const out = join(dir, "report");

    const res = runCli(["--har", writeSlowHar(dir), "--output", out]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toContain(
      "Note: latencies look compatible with China/GFW routing (max TCP connect 350ms > 300ms). Re-run with --region cn to show the GFW topology."
    );

    const flow = extractFlow(
      readFileSync(join(out, "index.html"), "utf-8")
    ) as unknown as EmbeddedFlow;
    expect(flow.version).toBe(3);
    expect(flow.clientRegion).toBe("default");
    expect(flow.hints.suggestedClientRegion?.region).toBe("cn");
    expect(flow.nodes.map((n) => n.id)).not.toContain("gfw");
  });

  it("builds the GFW topology with --region cn and prints no note", () => {
    const dir = makeTempDir();
    const out = join(dir, "report");

    const res = runCli(["--har", writeSlowHar(dir), "--region", "cn", "--output", out]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).not.toContain("Note:");

    const flow = extractFlow(
      readFileSync(join(out, "index.html"), "utf-8")
    ) as unknown as EmbeddedFlow;
    expect(flow.clientRegion).toBe("cn");
    expect(flow.nodes.map((n) => n.id)).toContain("gfw");
  });

  it("prints no note when --region default is explicit", () => {
    const dir = makeTempDir();
    const res = runCli([
      "--har",
      writeSlowHar(dir),
      "--region",
      "default",
      "--output",
      join(dir, "report"),
    ]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).not.toContain("Note:");
  });
});

describe("bundleHtml local inlining", () => {
  it("inlines CSS, JS and CSS font assets and removes the assets directory", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "assets"));
    const font = Buffer.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]);
    writeFileSync(join(dir, "assets", "f-abc.woff2"), font);
    writeFileSync(
      join(dir, "assets", "x.css"),
      '@font-face{font-family:F;src:url(./f-abc.woff2) format("woff2")}body{color:red}'
    );
    writeFileSync(join(dir, "assets", "x.js"), "console.log('inlined')");
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head>
<link
  rel="preload"
  as="font"
  href="./assets/f-abc.woff2"
/>
<script type="module" crossorigin src="./assets/x.js"></script>
<link rel="stylesheet" crossorigin href="./assets/x.css">
</head><body></body></html>`
    );

    bundleHtml(dir);

    const html = readFileSync(join(dir, "index.html"), "utf-8");
    expect(existsSync(join(dir, "assets"))).toBe(false);
    expect(html).toContain(`url(data:font/woff2;base64,${font.toString("base64")})`);
    expect(html).toContain("body{color:red}");
    expect(html).toContain("console.log('inlined')");
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toContain("./assets/");
    expect(html).not.toContain("src=");
  });

  it("leaves no network call in the CLI sources", () => {
    const srcDir = join(CLI_ROOT, "src");
    for (const file of readdirSync(srcDir)) {
      expect(readFileSync(join(srcDir, file), "utf-8"), file).not.toMatch(/\bfetch\(/);
    }
  });
});

describe("--bundle end to end (built CLI)", () => {
  it("produces a self-contained index.html with embedded fonts and no external URLs", () => {
    const out = join(makeTempDir(), "report");
    const res = runCli([
      "--page",
      "P",
      "--har",
      HAR,
      "--trace",
      TRACE,
      "--output",
      out,
      "--bundle",
    ]);
    expect(res.status, res.stderr).toBe(0);

    const html = readFileSync(join(out, "index.html"), "utf-8");
    // The HAR payload and React's error-decoder string legitimately contain "https://", so check loads, not text.
    const styles = [...html.matchAll(/<style>(.*?)<\/style>/gs)].map((m) => m[1]).join("");
    expect(styles).not.toMatch(/https?:|@import/);
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toContain("fonts.googleapis");
    expect(html).not.toContain("./assets/");
    expect(html).not.toContain('rel="preload"');
    expect(html).toContain("@font-face");
    expect(html).toContain("data:font/woff2;base64");
    expect(existsSync(join(out, "assets"))).toBe(false);
  });
});

describe("multi-page HAR (built CLI)", () => {
  interface EmbeddedFlow {
    pages: { name: string }[];
    steps: { title: string }[];
  }

  function generate(extraArgs: string[]) {
    const dir = makeTempDir();
    const harPath = join(dir, "journey.har");
    writeFileSync(harPath, JSON.stringify(twoPageHar()));
    const out = join(dir, "report");
    const res = runCli([...extraArgs, "--har", harPath, "--output", out]);
    expect(res.status, res.stderr).toBe(0);
    const flow = extractFlow(
      readFileSync(join(out, "index.html"), "utf-8")
    ) as unknown as EmbeddedFlow;
    return { res, flow, harPath };
  }

  it("expands a HAR with two pages into two flow pages named after their titles", () => {
    const { res, flow, harPath } = generate([]);

    expect(flow.pages.map((p) => p.name)).toEqual(["Home", "Checkout"]);
    expect(flow.steps.filter((s) => s.title.startsWith("→ User navigates to ")).length).toBe(1);
    expect(res.stderr).toContain(`Note: ${harPath} contains 2 pages; expanded into 2 flow pages.`);
  });

  it("prefixes an explicit --page name", () => {
    const { flow } = generate(["--page", "Shop"]);
    expect(flow.pages.map((p) => p.name)).toEqual(["Shop · Home", "Shop · Checkout"]);
  });

  it("prints no note for a single-page HAR", () => {
    const res = runCli(["--har", HAR, "--output", join(makeTempDir(), "out")]);
    expect(res.stderr).not.toContain("expanded into");
  });
});

describe("selecting pages of a multi-page HAR (built CLI)", () => {
  function writeWptHar() {
    const dir = makeTempDir();
    const harPath = join(dir, "wpt.har");
    writeFileSync(harPath, JSON.stringify(wptHar()));
    return { dir, harPath };
  }

  function pageNames(out: string): string[] {
    const flow = extractFlow(readFileSync(join(out, "index.html"), "utf-8")) as unknown as {
      pages: { name: string }[];
    };
    return flow.pages.map((p) => p.name);
  }

  it("generates only the page selected by id", () => {
    const { dir, harPath } = writeWptHar();
    const out = join(dir, "report");
    const res = runCli(["--har", harPath, "--select", "page_2", "--output", out]);
    expect(res.status, res.stderr).toBe(0);
    expect(pageNames(out)).toEqual(["Run 2 · First view"]);
    expect(res.stderr).toContain("expanded into 1 flow page.");
  });

  it("selects several pages with a comma-separated list or a title match", () => {
    const { dir, harPath } = writeWptHar();
    const byIds = join(dir, "ids");
    expect(
      runCli(["--har", harPath, "--select", "page_1_0_1,page_2_0_1", "--output", byIds]).status
    ).toBe(0);
    expect(pageNames(byIds)).toEqual(["Run 1 · First view", "Run 2 · First view"]);

    const byTitle = join(dir, "title");
    expect(
      runCli(["--har", harPath, "--select", "Run 1, Repeat", "--output", byTitle]).status
    ).toBe(0);
    expect(pageNames(byTitle)).toEqual(["Run 1 · Repeat view"]);
  });

  it("prints the pages with --list-pages and generates nothing", () => {
    const { dir, harPath } = writeWptHar();
    const res = runCli(["--har", harPath, "--list-pages"]);
    expect(res.status, res.stderr).toBe(0);
    for (const id of ["page_1_0_1", "page_1_1_1", "page_2_0_1"]) expect(res.stdout).toContain(id);
    expect(res.stdout).toContain("4 entries");
    expect(readdirSync(dir)).toEqual(["wpt.har"]);
  });

  it("exits 1 listing the available pages when the selection is unknown", () => {
    const { dir, harPath } = writeWptHar();
    const out = join(dir, "report");
    const res = runCli(["--har", harPath, "--select", "page_9_9_9", "--output", out]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("No page matches the selection");
    expect(res.stderr).toContain("page_1_1_1");
    expect(existsSync(out)).toBe(false);
  });
});
