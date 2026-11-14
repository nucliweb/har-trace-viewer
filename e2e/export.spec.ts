import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const output = resolve(import.meta.dirname, ".output");
const bundleUrl = pathToFileURL(resolve(output, "bundle/index.html")).href;

async function openAtFcp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  await page.context().setOffline(true);
  await page.goto(bundleUrl);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  // Walk forward to the step that reveals the FCP badge.
  const active = page.locator('[data-badge-state="active"]');
  const next = page.getByRole("button", { name: "Next →" });
  for (let i = 0; i < 40 && !(await active.filter({ hasText: "FCP" }).count()); i++) {
    await next.click();
  }
  await expect(active).toContainText("FCP");
  return errors;
}

async function viewBoxWidth(page: Page): Promise<number> {
  const viewBox = await page.locator("#diagram-svg").getAttribute("viewBox");
  return Number(viewBox!.split(/\s+/)[2]);
}

async function exportAs(page: Page, item: string, testInfo: { outputPath: (n: string) => string }) {
  await page.getByRole("button", { name: "Export" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: item }).click();
  const download = await downloading;
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { path, filename: download.suggestedFilename() };
}

test("exports the FCP step as a 2x PNG with fonts and badge", async ({ page }, testInfo) => {
  const errors = await openAtFcp(page);
  const width = await viewBoxWidth(page);
  const { path, filename } = await exportAs(page, "Download PNG (2x)", testInfo);

  expect(filename).toMatch(/^htv-home-step-\d+\.png$/);
  const bytes = await readFile(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(bytes.length).toBeGreaterThan(10 * 1024);
  expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(width * 2);
  expect(errors).toEqual([]);
});

test("exports a self-contained SVG without animation", async ({ page }, testInfo) => {
  const errors = await openAtFcp(page);
  const { path, filename } = await exportAs(page, "Download SVG", testInfo);

  expect(filename).toMatch(/^htv-home-step-\d+\.svg$/);
  const svg = await readFile(path, "utf8");
  expect(svg).toContain("@font-face");
  expect(svg).toContain("data:font/woff2");
  expect(svg).toContain("FCP");
  expect(svg).not.toContain("animateMotion");
  expect(svg).not.toContain("var(--");
  expect(errors).toEqual([]);
});

test("the export menu closes with Escape and returns focus", async ({ page }) => {
  await openAtFcp(page);
  const button = page.getByRole("button", { name: "Export" });
  await button.click();
  await expect(page.getByRole("menuitem", { name: "Download SVG" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(button).toBeFocused();
});

test("exports the requests as a CSV with every request of the page", async ({ page }, testInfo) => {
  const errors = await openAtFcp(page);
  const { path, filename } = await exportAs(page, "Download CSV", testInfo);

  expect(filename).toMatch(/^htv-[a-z0-9-]+\.csv$/);
  const csv = await readFile(path, "utf8");
  expect(csv.endsWith("\r\n")).toBe(true);
  const lines = csv.split("\r\n").filter(Boolean);
  expect(lines[0]).toMatch(/^page,side,url,/);
  expect(lines.length).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test("exports the Markdown report and the Mermaid diagrams", async ({ page }, testInfo) => {
  await openAtFcp(page);
  const markdown = await exportAs(page, "Download Markdown", testInfo);
  expect(markdown.filename).toMatch(/\.md$/);
  expect(await readFile(markdown.path, "utf8")).toMatch(/^# HAR Trace Viewer report/);

  const mermaid = await exportAs(page, "Download Mermaid", testInfo);
  expect(mermaid.filename).toMatch(/\.mmd$/);
  expect(await readFile(mermaid.path, "utf8")).toContain("sequenceDiagram");
});

test("the compare report exports both sides as text only", async ({ page }, testInfo) => {
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve(output, "compare/index.html")).href);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  await page.keyboard.press("Escape");

  const { path, filename } = await exportAs(page, "Download CSV", testInfo);
  expect(filename).toMatch(/-vs-.*\.csv$/);
  const rows = (await readFile(path, "utf8")).split("\r\n").filter(Boolean).slice(1);
  const sides = new Set(rows.map((row) => row.split(",")[1]));
  expect(sides).toEqual(new Set(["a", "b"]));
});

test("redacts the text exports, says what changed and leaves the images alone", async ({
  page,
}, testInfo) => {
  const errors = await openAtFcp(page);
  const analyticsId = "1403848601.1770921786";

  const plain = await exportAs(page, "Download CSV", testInfo);
  expect(await readFile(plain.path, "utf8")).toContain(analyticsId);
  await expect(page.getByRole("status")).toHaveCount(0);

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitemradio", { name: "Secrets", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Secrets", exact: true })).toBeChecked();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download CSV" }).click();
  const download = await downloading;
  const path = testInfo.outputPath("redacted.csv");
  await download.saveAs(path);
  const redacted = await readFile(path, "utf8");
  expect(redacted).not.toContain(analyticsId);
  expect(redacted).toContain("[redacted-1]");
  expect(redacted).toContain("region1.google-analytics.com");
  await expect(page.getByRole("status")).toContainText(/^Redacted: \d+ query values?/);

  const svg = await exportAs(page, "Download SVG", testInfo);
  expect(await readFile(svg.path, "utf8")).toContain("<svg");
  await expect(page.getByRole("status")).toHaveText("");
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the open export menu and the redaction note have no axe violations: ${scheme} theme`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await openAtFcp(page);
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitemradio", { name: "Secrets", exact: true }).click();
    await page.getByRole("menuitem", { name: "Download CSV" }).click();
    await expect(page.getByRole("status")).toContainText("Redacted:");
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitemradio", { name: "Secrets", exact: true }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) }))
    ).toEqual([]);
    await context.close();
  });
}

test("the second redaction level also masks third-party hosts", async ({ page }, testInfo) => {
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve(output, "problems/index.html")).href);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitemradio", { name: "Secrets and third-party hosts" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download CSV" }).click();
  const path = testInfo.outputPath("masked.csv");
  await (await downloading).saveAs(path);
  const csv = await readFile(path, "utf8");
  expect(csv).not.toContain("example-cdn.net");
  expect(csv).toContain("host-1.redacted");
  expect(csv).toContain("www.example.com");
  await expect(page.getByRole("status")).toContainText("1 host masked");
});
