#!/usr/bin/env node
import { readFileSync, mkdirSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseHarJson, parseTraceJson, generateFlow } from "@htv/core";
import type { PageFlow } from "@htv/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface PageArg {
  name: string;
  har: string;
  trace?: string;
}

interface Args {
  pages: PageArg[];
  output: string;
  bundle: boolean;
}

function parseArgs(argv: string[]): Args {
  const pages: PageArg[] = [];
  let output = "";
  let bundle = false;
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
    }
    i++;
  }

  return { pages, output, bundle };
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

async function bundleHtml(outputDir: string): Promise<void> {
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
    html = html.replace("</head>", `<style>${fontCss}</style>\n</head>`);
  }

  writeFileSync(indexPath, html);
  rmSync(join(outputDir, "assets"), { recursive: true, force: true });
}

function printUsage() {
  console.error(
    "Usage: htv --page <name> --har <file.har> [--trace <file.json[.gz]>] --output <dir> [--bundle]"
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.pages.length === 0 || !args.output) {
    printUsage();
    process.exit(1);
  }

  for (const p of args.pages) {
    if (!p.har) {
      console.error(`Missing --har for page "${p.name}"`);
      printUsage();
      process.exit(1);
    }
  }

  const pageFlows: PageFlow[] = args.pages.map((p) => ({
    name: p.name,
    har: parseHarJson(readContent(resolve(p.har))),
    trace: p.trace ? parseTraceJson(readContent(resolve(p.trace))) : undefined,
  }));

  const flow = generateFlow(pageFlows);

  const outputDir = resolve(args.output);
  mkdirSync(outputDir, { recursive: true });

  const webDir = join(__dirname, "web");
  cpSync(webDir, outputDir, { recursive: true });

  const indexPath = join(outputDir, "index.html");
  let html = readFileSync(indexPath, "utf-8");
  const injection = `<script>window.__HTV_FLOW__ = ${JSON.stringify(flow)};</script>`;
  html = html.replace("</head>", `${injection}\n</head>`);
  writeFileSync(indexPath, html);

  if (args.bundle) {
    await bundleHtml(outputDir);
  }

  console.log(`Report generated: ${indexPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
