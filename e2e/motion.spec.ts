import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const bundleUrl = pathToFileURL(resolve(import.meta.dirname, ".output/bundle/index.html")).href;

async function openOnStep2(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  await page.goto(bundleUrl);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText(/^Step 2 \/ \d+$/)).toBeVisible();
  return errors;
}

const countAnimateMotion = (page: Page) =>
  page.evaluate(() => document.querySelectorAll("animateMotion").length);

test("reduced motion renders no animateMotion on step 2 without console errors", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await openOnStep2(page);
  expect(await countAnimateMotion(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("default motion renders animateMotion on step 2 without console errors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = await openOnStep2(page);
  expect(await countAnimateMotion(page)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
