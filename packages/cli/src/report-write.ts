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
import { findingsDocument, markdownReport, mermaidReport, requestsCsv } from "@htv/core";
import type { Flow } from "@htv/core";
import { buildFlowInjection } from "./serialize";
import type { TextFormat } from "./args";
import type { OutputTarget } from "./output-target";
import type { Report } from "./report-build";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

/**
 * The report as JSON for other tools: the full flow (or both flows of a comparison), with the
 * htv version that produced it. Each flow carries its own data-model version.
 */
export function reportJson({ flow, compare }: Report, htvVersion: string): string {
  const body = compare
    ? { htvVersion, kind: "comparison", a: flow, b: compare }
    : { htvVersion, kind: "flow", flow };
  return JSON.stringify(body, null, 2);
}

/** Where the JSON schema of the findings document is published: inside this version's package. */
export const findingsSchemaUrl = (htvVersion: string) =>
  `https://unpkg.com/har-trace-viewer@${htvVersion}/dist/findings.schema.json`;

/**
 * The findings of the report as JSON: per page (both sides of a comparison), its metrics
 * summary and its findings, with the htv version and the schema that describes the document.
 */
export function reportFindings(
  { flow, compare }: Report,
  htvVersion: string,
  generatedAt = new Date().toISOString()
): string {
  const flows = compare
    ? [
        { flow, side: "a" as const },
        { flow: compare, side: "b" as const },
      ]
    : [{ flow }];
  const doc = findingsDocument(flows, {
    htvVersion,
    generatedAt,
    schema: findingsSchemaUrl(htvVersion),
  });
  return JSON.stringify(doc, null, 2);
}

/** The report as text, for the Markdown, CSV and Mermaid formats. */
export function reportText(format: TextFormat, { flow, compare }: Report): string {
  switch (format) {
    case "markdown":
      return markdownReport(flow, compare);
    case "csv":
      return requestsCsv(flow, compare);
    case "mermaid":
      return mermaidReport(flow, compare);
  }
}

/** Writes the HTML report and returns the path of its page. */
export function writeHtmlReport(
  { flow, compare }: Report,
  target: Extract<OutputTarget, { kind: "html" }>
): string {
  const path = resolve(target.path);
  const outputDir = target.singleFile ? mkdtempSync(join(tmpdir(), "htv-report-")) : path;
  try {
    return writeReport(
      flow,
      compare,
      outputDir,
      target.bundle,
      target.singleFile ? path : undefined
    );
  } finally {
    if (target.singleFile) rmSync(outputDir, { recursive: true, force: true });
  }
}

function writeReport(
  flow: Flow,
  compare: Flow | undefined,
  outputDir: string,
  bundle: boolean,
  singleFile?: string
): string {
  mkdirSync(outputDir, { recursive: true });

  const webDir = join(__dirname, "web");
  cpSync(webDir, outputDir, { recursive: true });

  const indexPath = join(outputDir, "index.html");
  let html = readFileSync(indexPath, "utf-8");
  const injection = buildFlowInjection(flow, compare);
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
