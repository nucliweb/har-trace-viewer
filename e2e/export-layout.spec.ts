import { expect, test, type Locator, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const output = resolve(import.meta.dirname, ".output");
const reports = {
  diagram: pathToFileURL(resolve(output, "bundle/index.html")).href,
  compare: pathToFileURL(resolve(output, "compare/index.html")).href,
};

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function visibleControls(page: Page, except: Locator[]) {
  const skip = await Promise.all(except.map((locator) => locator.elementHandle()));
  return page.evaluate((skipped) => {
    const controls = document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role="tab"], [role="menuitem"], [role="menuitemradio"]'
    );
    return [...controls]
      .filter((el) => !skipped.some((s) => s === el || (s as Element).contains(el)))
      .map((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const hidden = style.visibility === "hidden" || style.display === "none";
        return { label: el.textContent?.trim().slice(0, 30) || el.id, x, y, width, height, hidden };
      })
      .filter((box) => !box.hidden && box.width > 0 && box.height > 0);
  }, skip);
}

for (const kind of ["diagram", "compare"] as const) {
  for (const width of [360, 400, 640]) {
    test(`the redaction note and the export menu fit a ${width}px screen: ${kind}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.context().setOffline(true);
      await page.goto(reports[kind]);
      await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();

      const exportButton = page.getByRole("button", { name: "Export" });
      await exportButton.click();
      const menu = page.getByRole("menu", { name: "Export report" });
      await menu.getByRole("menuitemradio", { name: "Secrets and third-party hosts" }).click();
      await menu.getByRole("menuitem", { name: "Download CSV" }).click();
      const note = page.getByRole("status").filter({ hasText: "Redacted:" });
      await expect(note).toBeVisible();

      const noteBox = (await note.boundingBox())!;
      expect(noteBox.x).toBeGreaterThanOrEqual(0);
      expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(width);
      for (const other of await visibleControls(page, [exportButton])) {
        expect(overlaps(noteBox, other), `the note covers "${other.label}"`).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );

      await exportButton.click();
      await expect(menu).toBeVisible();
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(800);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );
    });
  }
}

for (const width of [360, 400, 640]) {
  test(`the export failure message fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.context().setOffline(true);
    // The download is the last step of an image export: failing it fails the export.
    await page.addInitScript(() => {
      URL.createObjectURL = () => {
        throw new Error("no object URLs");
      };
    });
    await page.goto(reports.diagram);
    await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();

    const exportButton = page.getByRole("button", { name: "Export" });
    await exportButton.click();
    await page.getByRole("menuitem", { name: "Download SVG" }).click();
    const failure = page.getByRole("alert").filter({ hasText: "Export failed" });
    await expect(failure).toBeVisible();

    const box = (await failure.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    for (const other of await visibleControls(page, [exportButton])) {
      expect(overlaps(box, other), `the message covers "${other.label}"`).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
  });
}
