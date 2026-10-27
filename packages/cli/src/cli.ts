import { readFileSync, mkdirSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
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

const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": CHROME_UA } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": CHROME_UA } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function bundleHtml(outputDir: string): Promise<void> {
  const indexPath = join(outputDir, "index.html");
  let html = readFileSync(indexPath, "utf-8");

  // Inline local CSS assets
  html = html.replace(
    /<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+\.css)">/g,
    (_, href: string) => {
      const css = readFileSync(join(outputDir, href), "utf-8");
      return `<style>${css}</style>`;
    }
  );

  // Inline local JS assets
  html = html.replace(
    /<script type="module" crossorigin src="(\.\/assets\/[^"]+\.js)"><\/script>/g,
    (_, src: string) => {
      const js = readFileSync(join(outputDir, src), "utf-8");
      return `<script type="module">${js}</script>`;
    }
  );

  // Embed Google Fonts
  const fontLinkMatch = html.match(/<link href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/);
  if (fontLinkMatch) {
    process.stdout.write("Embedding fonts...");
    let fontCss = await fetchText(fontLinkMatch[1]);

    const fontUrls = [...fontCss.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(
      (m) => m[1]
    );
    for (const url of [...new Set(fontUrls)]) {
      const data = await fetchBuffer(url);
      const mime = url.endsWith(".woff2") ? "font/woff2" : "font/woff";
      fontCss = fontCss.replaceAll(url, `data:${mime};base64,${data.toString("base64")}`);
    }
    process.stdout.write(" done\n");

    html = html.replace(/<link rel="preconnect"[^>]+>\s*/g, "");
    html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com\/[^"]*"[^>]*>/g, "");
    html = html.replace("</head>", () => `<style>${fontCss}</style>\n</head>`);
  }

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
    await bundleHtml(outputDir);
  }

  return indexPath;
}
