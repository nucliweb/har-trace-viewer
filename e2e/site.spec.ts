import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, join, resolve } from "node:path";

// The build perf.reviews serves (packages/web/dist-site): its reverse proxy asks this deployment
// for /har-trace-viewer and /har-trace-viewer/..., with no trailing slash on the page itself.
const root = resolve(import.meta.dirname, "../packages/web/dist-site");
const PUBLIC_URL = "https://perf.reviews/har-trace-viewer";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};

let server: ReturnType<typeof createServer>;
let baseUrl = "";

test.beforeAll(async () => {
  // As Vercel serves static files: a folder, with or without its trailing slash, is its index.html.
  server = createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
      let file = resolve(root, "." + urlPath);
      if (!file.startsWith(root)) throw new Error("outside root");
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res
        .writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server.close();
});

function watch(page: Page) {
  const errors: string[] = [];
  const requested: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("requestfailed", (req) => errors.push(`failed: ${req.url()}`));
  page.on("response", (res) => res.status() >= 400 && errors.push(`${res.status()}: ${res.url()}`));
  page.on("request", (req) => requested.push(new URL(req.url()).pathname));
  return { errors, requested };
}

test("/har-trace-viewer, with no trailing slash, runs the app from its own path", async ({
  page,
}) => {
  const { errors, requested } = watch(page);
  await page.goto(`${baseUrl}/har-trace-viewer`);
  await page.getByRole("button", { name: "Load demo flow →" }).click();
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText(/^Step 2 \/ \d+$/)).toBeVisible();

  expect(errors).toEqual([]);
  // Everything it loads, the demo chunk and the fonts included, comes from under its path.
  expect(requested.filter((path) => !path.startsWith("/har-trace-viewer"))).toEqual([]);
  expect(requested.some((path) => /demo-flow/.test(path))).toBe(true);
});

test("its head names perf.reviews as the address to share", async ({ page }) => {
  await page.goto(`${baseUrl}/har-trace-viewer`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", PUBLIC_URL);
  for (const meta of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    await expect(page.locator(meta)).toHaveAttribute("content", `${PUBLIC_URL}/og.png`);
  }
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", PUBLIC_URL);
  const og = await page.request.get(`${baseUrl}/har-trace-viewer/og.png`);
  expect(og.status()).toBe(200);
});

test("the deployment's own root sends visitors to perf.reviews and stays out of search", async ({
  request,
}) => {
  const home = await (await request.get(`${baseUrl}/`)).text();
  expect(home).toContain(`<meta http-equiv="refresh" content="0; url=${PUBLIC_URL}"`);
  expect(home).toContain(`<link rel="canonical" href="${PUBLIC_URL}"`);
  expect(home).toContain('<meta name="robots" content="noindex"');
  const robots = await (await request.get(`${baseUrl}/robots.txt`)).text();
  expect(robots).toMatch(/User-agent: \*\s+Disallow: \//);
});
