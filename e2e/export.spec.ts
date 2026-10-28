import { expect, test, type Page } from "@playwright/test";
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
