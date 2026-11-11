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

// `vite build` makes the app the CLI bundles into its reports, opened from disk: relative URLs.
// `vite build --mode site` makes the public site: every URL under the base path, as the proxy
// requests the page with no trailing slash and a relative URL would resolve against perf.reviews' root.
export default defineConfig(({ mode }) => {
  const site = mode === "site";
  return {
    plugins: [react(), ...(site ? [publicSite()] : [])],
    base: site ? `${BASE_PATH}/` : "./",
    define: { __HTV_VERSION__: JSON.stringify(version) },
    build: site ? { outDir: `dist-site${BASE_PATH}`, emptyOutDir: true } : {},
  };
});
