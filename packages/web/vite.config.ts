import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The product version is the CLI package's: it is what npm publishes, and its reports bundle this app.
const { version } = JSON.parse(
  readFileSync(new URL("../cli/package.json", import.meta.url), "utf8")
) as { version: string };

// The public site lives at perf.reviews/har-trace-viewer: perf.reviews' reverse proxy forwards that
// path, unchanged, to this app's Vercel deployment.
const BASE_PATH = "/har-trace-viewer";
const PUBLIC_URL = `https://perf.reviews${BASE_PATH}`;
const SITE_ROOT = new URL("./dist-site/", import.meta.url);
const CORE_SOURCES = /[\\/]packages[\\/]core[\\/]src[\\/]/;

/**
 * What the site build adds around the app. Its head names perf.reviews as the address to share,
 * the social image included (crawlers need absolute URLs). The deployment's own root, which only
 * the vercel.app address reaches, sends visitors there and keeps search engines away.
 */
function publicSite(): Plugin {
  return {
    name: "htv-public-site",
    apply: "build",
    transformIndexHtml: {
      // After Vite's own pass, which has put the base path in front of the social image.
      order: "post",
      handler: (html) => ({
        html: html.replaceAll(`content="${BASE_PATH}/og.png"`, `content="${PUBLIC_URL}/og.png"`),
        tags: [
          { tag: "link", attrs: { rel: "canonical", href: PUBLIC_URL }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:url", content: PUBLIC_URL }, injectTo: "head" },
        ],
      }),
    },
    closeBundle() {
      mkdirSync(SITE_ROOT, { recursive: true });
      writeFileSync(
        new URL("index.html", SITE_ROOT),
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=${PUBLIC_URL}" />
    <link rel="canonical" href="${PUBLIC_URL}" />
    <meta name="robots" content="noindex" />
    <title>HTV · HAR Trace Viewer</title>
  </head>
  <body>
    <p>HTV lives at <a href="${PUBLIC_URL}">${PUBLIC_URL}</a>.</p>
  </body>
</html>
`
      );
      writeFileSync(new URL("robots.txt", SITE_ROOT), "User-agent: *\nDisallow: /\n");
    },
  };
}

/**
 * Reports never offer the demo flow (the app passes FlowBuilder no onLoadFlow when a flow is
 * embedded), so their build reads the demo as empty JSON: its 48 kB stay out of every report.
 */
function withoutDemoFlow(): Plugin {
  return {
    name: "htv-without-demo-flow",
    apply: "build",
    enforce: "pre",
    load: (id) => (id.endsWith("/src/demo/demo-flow.json") ? "null" : undefined),
  };
}

/**
 * In the report build, each `import("./…")` of the app's own modules becomes a static import that
 * resolves at once. Left to `codeSplitting: false`, Rolldown would inline them too, but wrapped in
 * lazy module initializers (and Vite's preload helper) that add about 7 kB gzip to every report.
 */
function staticDynamicImports(): Plugin {
  return {
    name: "htv-static-dynamic-imports",
    apply: "build",
    enforce: "pre",
    transform: {
      filter: { id: /[\\/]packages[\\/]web[\\/]src[\\/].*\.tsx?$/ },
      handler(code) {
        const imports: string[] = [];
        const rewritten = code.replace(
          /\bimport\(\s*(["'])(\.{1,2}\/[^"']+)\1\s*\)/g,
          (_, _quote, specifier: string) => {
            const name = `__htvStatic${imports.length}`;
            imports.push(`import * as ${name} from ${JSON.stringify(specifier)};`);
            return `Promise.resolve(${name})`;
          }
        );
        return imports.length > 0 ? `${imports.join("\n")}\n${rewritten}` : undefined;
      },
    },
  };
}

// `vite build` makes the app the CLI bundles into its reports, opened from disk: relative URLs,
// and a single entry script, since a single-file report inlines only that one. `codeSplitting:
// false` inlines every dynamic import into it (the parse worker stays a file of its own).
// `vite build --mode site` makes the public site: every URL under the base path, as the proxy
// requests the page with no trailing slash and a relative URL would resolve against perf.reviews'
// root, and the views, drawers, dialogs and languages a first visit does not need in chunks.
export default defineConfig(({ command, mode }) => {
  const site = mode === "site";
  const report = command === "build" && !site;
  return {
    plugins: [
      react(),
      ...(site ? [publicSite()] : []),
      ...(report ? [withoutDemoFlow(), staticDynamicImports()] : []),
    ],
    base: site ? `${BASE_PATH}/` : "./",
    define: { __HTV_VERSION__: JSON.stringify(version) },
    build: {
      ...(site ? { outDir: `dist-site${BASE_PATH}`, emptyOutDir: true } : {}),
      rolldownOptions: {
        ...(site ? {} : { output: { codeSplitting: false } }),
        // @htv/core runs nothing on import but fills module-local tables: what the app does not
        // use of it is left out, so the start screen does not carry the analysis.
        treeshake: { moduleSideEffects: (id) => (CORE_SOURCES.test(id) ? false : undefined) },
      },
    },
  };
});
