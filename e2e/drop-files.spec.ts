import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, join, resolve } from "node:path";
import { everythingShown, leaks } from "./secrets";
import { secretHar, secretTrace } from "../packages/core/tests/helpers/secret-har";

// The public site's build: a real drop, with the parse and generation running in the worker.
const root = resolve(import.meta.dirname, "../packages/web/dist-site");
const fixtures = resolve(import.meta.dirname, "../packages/core/tests/fixtures");

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
let har = "";
let trace = "";

test.beforeAll(async () => {
  har = await readFile(resolve(fixtures, "webperf-snippets.har.fixture.json"), "utf8");
  trace = await readFile(resolve(fixtures, "webperf-snippets.trace.fixture.json"), "utf8");
  server = createServer((req, res) => {
    // The try/catch covers the whole body, so this promise cannot reject.
    void (async () => {
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
    })();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/har-trace-viewer/`;
});

test.afterAll(() => {
  server.close();
});

interface Dropped {
  name: string;
  content: string;
}

/** Drags real File objects over the window, then drops them on the element at `selector`. */
async function dropFiles(page: Page, files: Dropped[], selector = "body") {
  await page.evaluate(
    ({ files, selector }) => {
      const data = new DataTransfer();
      for (const { name, content } of files) data.items.add(new File([content], name));
      const target = document.querySelector(selector)!;
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
        );
      }
    },
    { files, selector }
  );
}

test("a HAR and its trace dropped anywhere on the screen land in one row and generate the flow", async ({
  page,
}) => {
  await page.goto(baseUrl);
  await dropFiles(page, [
    { name: "site.trace.json", content: trace },
    { name: "site.har", content: har },
  ]);

  await expect(page.getByRole("button", { name: /site\.har/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trace ✓" })).toBeVisible();
  await expect(page.getByLabel(/^Page \d+ name$/)).toHaveCount(1);

  await page.getByRole("button", { name: "Generate diagram" }).click();
  await expect(page.locator("#diagram-svg")).toBeVisible({ timeout: 90_000 });
});

test.describe("a HAR and a trace that carry secrets", () => {
  // Tall enough for the waterfall drawer to show a request's detail with its copy buttons.
  test.use({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1280, height: 1800 },
  });

  test("show none of them once dropped: in any step, drawer, request or copy", async ({ page }) => {
    await page.goto(baseUrl);
    await dropFiles(page, [
      { name: "secret.har", content: JSON.stringify(secretHar()) },
      { name: "secret.trace.json", content: JSON.stringify(secretTrace()) },
    ]);
    await expect(page.getByRole("button", { name: "Trace ✓" })).toBeVisible();
    await page.getByRole("button", { name: "Generate diagram" }).click();
    await expect(page.locator("#diagram-svg")).toBeVisible({ timeout: 90_000 });

    const { html, clipboard } = await everythingShown(page);

    // The URL and the cURL command of every request.
    expect(clipboard).toHaveLength(secretHar().log.entries.length * 2);

    expect(clipboard).toContain(
      "https://shop.example.com/account?email=[email]&token=[redacted]&lang=en"
    );
    expect(leaks([...html, ...clipboard])).toEqual([]);
  });
});

test("the whole screen shows it takes the drop while files are dragged over it", async ({
  page,
}) => {
  await page.goto(baseUrl);
  const hint = page.getByText("Drop a HAR and its trace here");
  await expect(hint).toHaveCount(0);

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["{}"], "site.har"));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true }));
  });
  await expect(hint).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("two HARs dropped together make two page rows", async ({ page }) => {
  await page.goto(baseUrl);
  await dropFiles(page, [
    { name: "first.har", content: har },
    { name: "second.har", content: har },
  ]);

  await expect(page.getByRole("button", { name: /first\.har/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /second\.har/ })).toBeVisible();
  await expect(page.getByLabel(/^Page \d+ name$/)).toHaveCount(2);
});

test("Home brings the loaded pages back, ready for one more", async ({ page }) => {
  await page.goto(baseUrl);
  await dropFiles(page, [{ name: "first.har", content: har }]);
  await page.getByRole("button", { name: "Generate diagram" }).click();
  await expect(page.locator("#diagram-svg")).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: /first\.har/ })).toBeVisible();

  await dropFiles(page, [{ name: "second.har", content: har }]);
  await expect(page.getByRole("button", { name: /second\.har/ })).toBeVisible();
  await expect(page.getByLabel(/^Page \d+ name$/)).toHaveCount(2);
});

test("Reset empties the loaded pages, from the diagram and from the start screen", async ({
  page,
}) => {
  await page.goto(baseUrl);
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  await expect(reset).toHaveCount(0);

  await dropFiles(page, [{ name: "first.har", content: har }]);
  await page.getByRole("button", { name: "Generate diagram" }).click();
  await expect(page.locator("#diagram-svg")).toBeVisible({ timeout: 90_000 });
  await reset.click();
  await expect(page.getByRole("button", { name: "Generate diagram" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /first\.har/ })).toHaveCount(0);
  await expect(reset).toHaveCount(0);

  await dropFiles(page, [
    { name: "one.har", content: har },
    { name: "two.har", content: har },
  ]);
  await expect(page.getByLabel(/^Page \d+ name$/)).toHaveCount(2);
  await reset.click();
  await expect(page.getByLabel(/^Page \d+ name$/)).toHaveCount(1);
  await expect(page.getByRole("button", { name: /one\.har/ })).toHaveCount(0);
});
