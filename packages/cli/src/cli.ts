import { readFileSync, mkdirSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  parseHarPagesJson,
  expandPageFlows,
  parseTraceJson,
  generateFlow,
  isClientRegion,
  CLIENT_REGIONS,
} from "@htv/core";
import type { ClientRegion, PageFlow } from "@htv/core";
import { buildFlowInjection } from "./serialize";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PageArg {
  name: string;
  har: string;
  trace?: string;
}

export interface Args {
  pages: PageArg[];
  output: string;
  bundle: boolean;
  region?: ClientRegion; // undefined when --region is absent
}

function parseRegion(value: string | undefined): ClientRegion {
  if (isClientRegion(value)) return value;
  throw new Error(`Invalid --region "${value ?? ""}". Valid values: ${CLIENT_REGIONS.join(", ")}.`);
}

export function parseArgs(argv: string[]): Args {
  const pages: PageArg[] = [];
  let output = "";
  let bundle = false;
  let region: ClientRegion | undefined;
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--page") {
      pages.push({ name: argv[++i], har: "" });
    } else if (arg === "--har") {
      if (pages.length === 0) pages.push({ name: "Page 1", har: "" });
      pages[pages.length - 1].har = argv[++i];
    } else if (arg === "--trace") {
      if (pages.length === 0) pages.push({ name: "Page 1", har: "" });
      pages[pages.length - 1].trace = argv[++i];
    } else if (arg === "--output" || arg === "-o") {
      output = argv[++i];
    } else if (arg === "--bundle") {
      bundle = true;
    } else if (arg === "--region") {
      region = parseRegion(argv[++i]);
    }
    i++;
  }

  return { pages, output, bundle, ...(region ? { region } : {}) };
}

function readContent(filePath: string): string {
  const raw = readFileSync(filePath);
  return filePath.endsWith(".gz") ? gunzipSync(raw).toString("utf-8") : raw.toString("utf-8");
}

const ASSET_MIME: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Replaces `url(...)` references to local asset files with base64 data URIs. */
function inlineCssUrls(css: string, cssDir: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote, ref: string) => {
    const mime = ASSET_MIME[extname(ref.split(/[?#]/)[0]).toLowerCase()];
    if (!mime || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return match;
    const data = readFileSync(join(cssDir, ref.split(/[?#]/)[0]));
    return `url(data:${mime};base64,${data.toString("base64")})`;
  });
}

/** Inlines the built CSS, JS and the assets they reference into index.html. Works fully offline. */
export function bundleHtml(outputDir: string): void {
  const indexPath = join(outputDir, "index.html");
  let html = readFileSync(indexPath, "utf-8");

  // Font preloads point at files that are inlined into the CSS below
  html = html.replace(/<link\s+rel="preload"[^>]*href="\.\/assets\/[^"]+"[^>]*>\s*/g, "");

  html = html.replace(
    /<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+\.css)">/g,
    (_, href: string) => {
      const cssPath = join(outputDir, href);
      return `<style>${inlineCssUrls(readFileSync(cssPath, "utf-8"), dirname(cssPath))}</style>`;
    }
  );

  html = html.replace(
    /<script type="module" crossorigin src="(\.\/assets\/[^"]+\.js)"><\/script>/g,
    (_, src: string) => {
      const js = readFileSync(join(outputDir, src), "utf-8");
      return `<script type="module">${js}</script>`;
    }
  );

  writeFileSync(indexPath, html);
  rmSync(join(outputDir, "assets"), { recursive: true, force: true });
}

export function printUsage() {
  console.error(
    `Usage: htv --page <name> --har <file.har> [--trace <file.json[.gz]>] --output <dir> [--bundle] [--region ${CLIENT_REGIONS.join("|")}]`
  );
}

export function validateArgs(args: Args): string | null {
  if (args.pages.length === 0 || !args.output) return "";
  for (const p of args.pages) {
    if (!p.har) return `Missing --har for page "${p.name}"`;
  }
  return null;
}

export async function generateReport(args: Args): Promise<string> {
  const pageFlows: PageFlow[] = args.pages.flatMap((p) => {
    const har = parseHarPagesJson(readContent(resolve(p.har)));
    if (har.length > 1) {
      console.error(
        `Note: ${p.har} contains ${har.length} pages; expanded into ${har.length} flow pages.`
      );
    }
    return expandPageFlows({
      name: p.name,
      har,
      trace: p.trace ? parseTraceJson(readContent(resolve(p.trace))) : undefined,
    });
  });

  const flow = generateFlow(pageFlows, { clientRegion: args.region ?? "default" });

  const suggestion = flow.hints.suggestedClientRegion;
  if (suggestion && args.region === undefined) {
    console.error(
      `Note: latencies look compatible with China/GFW routing (${suggestion.reason}). Re-run with --region ${suggestion.region} to show the GFW topology.`
    );
  }

  const outputDir = resolve(args.output);
  mkdirSync(outputDir, { recursive: true });

  const webDir = join(__dirname, "web");
  cpSync(webDir, outputDir, { recursive: true });

  const indexPath = join(outputDir, "index.html");
  let html = readFileSync(indexPath, "utf-8");
  const injection = buildFlowInjection(flow);
  // Function replacer: a string replacement would interpret "$&", "$'" etc. found in the payload.
  html = html.replace("</head>", () => `${injection}\n</head>`);
  writeFileSync(indexPath, html);

  if (args.bundle) {
    bundleHtml(outputDir);
  }

  return indexPath;
}
