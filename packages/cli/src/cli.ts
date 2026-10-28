import {
  readFileSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  rmSync,
  mkdtempSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import {
  parseHarPagesJson,
  expandPageFlows,
  generateFlow,
  isClientRegion,
  CLIENT_REGIONS,
} from "@htv/core";
import type { ClientRegion, PageFlow } from "@htv/core";
import { parseTraceFile, readTextFile } from "@htv/core/node";
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
  help?: boolean;
  version?: boolean;
}

function parseRegion(value: string | undefined): ClientRegion {
  if (isClientRegion(value)) return value;
  throw new Error(`Invalid --region "${value ?? ""}". Valid values: ${CLIENT_REGIONS.join(", ")}.`);
}

export function parseArgs(argv: string[]): Args {
  const { tokens } = nodeParseArgs({
    args: argv,
    options: {
      page: { type: "string", multiple: true },
      har: { type: "string", multiple: true },
      trace: { type: "string", multiple: true },
      output: { type: "string", short: "o" },
      bundle: { type: "boolean" },
      region: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    tokens: true,
    allowPositionals: false,
    strict: true,
  });

  const pages: PageArg[] = [];
  let output = "";
  let bundle = false;
  let help = false;
  let version = false;
  let region: ClientRegion | undefined;
  const lastPage = () => {
    if (pages.length === 0) pages.push({ name: "Page 1", har: "" });
    return pages[pages.length - 1];
  };

  for (const token of tokens ?? []) {
    if (token.kind !== "option") continue;
    const value = token.value as string;
    switch (token.name) {
      case "page":
        pages.push({ name: value, har: "" });
        break;
      case "har":
        lastPage().har = value;
        break;
      case "trace":
        lastPage().trace = value;
        break;
      case "output":
        output = value;
        break;
      case "bundle":
        bundle = true;
        break;
      case "region":
        region = parseRegion(value);
        break;
      case "help":
        help = true;
        break;
      case "version":
        version = true;
        break;
    }
  }

  return {
    pages,
    output,
    bundle,
    ...(region ? { region } : {}),
    ...(help ? { help } : {}),
    ...(version ? { version } : {}),
  };
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

const isHtmlPath = (p: string) => p.toLowerCase().endsWith(".html");

export const USAGE = `Usage: htv --page <name> --har <file.har[.gz]> [--trace <file.json[.gz]>] --output <dir|file.html> [options]`;

export const HELP = `${USAGE}

Generates a self-contained HTML performance report from HAR and Chrome trace files.

Options:
  --page <name>       Start a page in the report; repeat once per page.
                      The following --har and --trace attach to it.
  --har <file>        HAR file for the preceding --page (.har or .har.gz).
                      Without a --page, a page named "Page 1" is created.
  --trace <file>      Chrome trace for the preceding --page (.json or .json.gz).
  -o, --output <path> Directory where the report is written. With --bundle it
                      may also be a .html file path.
  --bundle            Inline all assets (CSS, JS, fonts) into a single
                      self-contained index.html that opens offline.
  --region <id>       Client network region: ${CLIENT_REGIONS.join(" | ")} (default: default).
                      "cn" draws the Great Firewall before the first server.
  -h, --help          Show this help.
  -v, --version       Show the version.

Example (two pages):
  htv --page "Home" --har home.har --trace home.json.gz \
      --page "Checkout" --har checkout.har \
      --output report/ --bundle

Without --bundle the report loads ES modules from assets/, which browsers
block over file://; serve the folder over HTTP (npx serve report/) or use
--bundle for a single file that opens by double-click.`;

export function printUsage() {
  console.error(USAGE);
}

export function validateArgs(args: Args): string | null {
  if (args.pages.length === 0 || !args.output) return "";
  if (isHtmlPath(args.output) && !args.bundle) {
    return "--output must be a directory unless --bundle is set";
  }
  for (const p of args.pages) {
    if (!p.har) return `Missing --har for page "${p.name}"`;
  }
  return null;
}

export async function generateReport(args: Args): Promise<string> {
  const pageFlows: PageFlow[] = [];
  for (const p of args.pages) {
    const har = parseHarPagesJson(await readTextFile(resolve(p.har)));
    if (har.length > 1) {
      console.error(
        `Note: ${p.har} contains ${har.length} pages; expanded into ${har.length} flow pages.`
      );
    }
    pageFlows.push(
      ...expandPageFlows({
        name: p.name,
        har,
        trace: p.trace ? await parseTraceFile(resolve(p.trace)) : undefined,
      })
    );
  }

  const flow = generateFlow(pageFlows, { clientRegion: args.region ?? "default" });

  const suggestion = flow.hints.suggestedClientRegion;
  if (suggestion && args.region === undefined) {
    console.error(
      `Note: latencies look compatible with China/GFW routing (${suggestion.reason}). Re-run with --region ${suggestion.region} to show the GFW topology.`
    );
  }

  const target = resolve(args.output);
  const singleFile = isHtmlPath(target);
  const outputDir = singleFile ? mkdtempSync(join(tmpdir(), "htv-report-")) : target;
  try {
    return writeReport(flow, outputDir, args.bundle, singleFile ? target : undefined);
  } finally {
    if (singleFile) rmSync(outputDir, { recursive: true, force: true });
  }
}

function writeReport(
  flow: ReturnType<typeof generateFlow>,
  outputDir: string,
  bundle: boolean,
  singleFile?: string
): string {
  mkdirSync(outputDir, { recursive: true });

  const webDir = join(__dirname, "web");
  cpSync(webDir, outputDir, { recursive: true });

  const indexPath = join(outputDir, "index.html");
  let html = readFileSync(indexPath, "utf-8");
  const injection = buildFlowInjection(flow);
  // Function replacer: a string replacement would interpret "$&", "$'" etc. found in the payload.
  html = html.replace("</head>", () => `${injection}\n</head>`);
  writeFileSync(indexPath, html);

  if (bundle) {
    bundleHtml(outputDir);
  }

  if (singleFile) {
    mkdirSync(dirname(singleFile), { recursive: true });
    try {
      renameSync(indexPath, singleFile);
    } catch {
      // Cross-device move (temp dir on another filesystem)
      writeFileSync(singleFile, readFileSync(indexPath));
    }
    return singleFile;
  }

  return indexPath;
}
