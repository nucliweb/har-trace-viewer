import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Serves the built web app (packages/web/dist), as Vercel does, to test the public entry page.
const root = resolve(import.meta.dirname, "../packages/web/dist");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

let server: ReturnType<typeof createServer>;
let baseUrl = "";

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
      const file = resolve(root, "." + (urlPath === "/" ? "/index.html" : urlPath));
      if (!file.startsWith(root)) throw new Error("outside root");
      const body = await readFile(file);
      res
        .writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

test.afterAll(() => {
  server.close();
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("head carries the description, social card, theme color and icon", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page).toHaveTitle("HTV · HAR Trace Viewer");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const meta = (selector: string) => page.locator(`head ${selector}`).getAttribute("content");
  expect(await meta('meta[name="description"]')).toMatch(/HAR/);
  expect(await meta('meta[property="og:title"]')).toBe("HTV · HAR Trace Viewer");
  expect(await meta('meta[property="og:image"]')).toMatch(/^\.?\/og\.png$/);
  expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
  await expect(page.locator('head meta[name="theme-color"]')).toHaveCount(2);
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute("href", /^data:image\/svg/);

  const og = await page.request.get(new URL("og.png", baseUrl).href);
  expect(og.ok()).toBe(true);
  expect((await og.body()).length).toBeLessThan(150 * 1024);
});

test("the empty state explains where the files come from", async ({ page }) => {
  await page.goto(baseUrl);
  const guide = page.getByRole("region", { name: /where do the files come from/i });
  await expect(guide.getByText(/preserve log/i)).toBeVisible();
  await expect(guide.getByText(/save profile/i)).toBeVisible();
});

test("one click on the demo button shows the diagram", async ({ page }) => {
  const errors = collectErrors(page);
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));
  await page.goto(baseUrl);
  // The demo flow is a separate chunk, downloaded only on demand.
  expect(requested.some((url) => /demo-flow/.test(url))).toBe(false);

  await page.getByRole("button", { name: "Load demo flow →" }).click();
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  expect(requested.some((url) => /demo-flow/.test(url))).toBe(true);
  await expect(page.locator("#diagram-svg")).toBeVisible();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText(/^Step 2 \/ \d+$/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("dropping a JSON file that is not a HAR shows why it cannot be read", async ({ page }) => {
  const errors = collectErrors(page);
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));
  await page.goto(baseUrl);

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['{"hello":"world"}'], "notes.har", { type: "application/json" }));
    return transfer;
  });
  const row = page.getByLabel("Page 1 name").locator("xpath=..");
  await row.dispatchEvent("drop", { dataTransfer });

  await expect(
    page.getByText(
      "This JSON is neither a HAR (log.entries) nor a Chrome trace (traceEvents or an event array)."
    )
  ).toBeVisible();
  // The message came back from the parse worker.
  expect(requested.some((url) => /parse\.worker/.test(url))).toBe(true);
  await expect(page.getByRole("button", { name: /Generate diagram/ })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("a gzipped HAR loads like a plain one", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(baseUrl);
  const har = await readFile(
    resolve(
      import.meta.dirname,
      "../packages/core/tests/fixtures/webperf-snippets.har.fixture.json"
    )
  );

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "site.har.gz", mimeType: "application/gzip", buffer: gzipSync(har) });

  await expect(page.getByText("site.har.gz")).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate diagram/ })).toBeEnabled();
  expect(errors).toEqual([]);
});

test.describe("mobile 360x740", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test("the empty state and the demo diagram fit the viewport", async ({ page }) => {
    await page.goto(baseUrl);
    const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect(await scrollWidth()).toBeLessThanOrEqual(360);

    const demo = page.getByRole("button", { name: "Load demo flow →" });
    const box = await demo.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await demo.click();
    await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
    expect(await scrollWidth()).toBeLessThanOrEqual(360);
    const svg = await page.locator("#diagram-svg").boundingBox();
    expect(svg!.width).toBeLessThanOrEqual(360);
  });
});
