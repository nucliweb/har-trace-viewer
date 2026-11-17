import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { animationsSettled } from "./animations";

// A generated report opened from file://, where the clipboard needs a secure context and a grant.
const reportUrl = pathToFileURL(resolve(import.meta.dirname, ".output/bundle/index.html")).href;

async function open(page: Page) {
  await page.goto(reportUrl);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
}

const drawerButton = (page: Page, drawer: string) => page.locator(`[data-drawer="${drawer}"]`);
const filter = (page: Page) => page.getByRole("searchbox", { name: "Filter requests" });

test.describe("copying a request", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("the URL and a cURL command reach the real clipboard", async ({ page }) => {
    await open(page);
    await page.keyboard.press("2");
    const rows = page.getByRole("list", { name: /^Requests/ });
    const row = rows.getByRole("listitem").nth(1).getByRole("button").first();
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("button", { name: "Copy URL" }).click();
    await expect(page.getByText("URL copied")).toBeVisible();
    const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedUrl).toMatch(/^https?:\/\/\S+$/);

    await page.getByRole("button", { name: "Copy cURL" }).click();
    await expect(page.getByText("cURL command copied")).toBeVisible();
    const curl = await page.evaluate(() => navigator.clipboard.readText());
    expect(curl).toBe(`curl '${copiedUrl.replaceAll("'", "'\\''")}'`);
  });

  test("a polite live region announces the copy, and the actions pass axe", async ({ page }) => {
    await open(page);
    await page.keyboard.press("2");
    await page
      .getByRole("list", { name: /^Requests/ })
      .getByRole("listitem")
      .nth(1)
      .getByRole("button")
      .first()
      .click();
    await page.getByRole("button", { name: "Copy URL" }).click();

    const message = page.getByText("URL copied");
    await expect(message).toHaveAttribute("aria-live", "polite");
    await animationsSettled(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test("a clipboard the browser refuses says so instead of failing silently", async ({ page }) => {
  // No permission is granted, and the page's own write is rejected as in a locked-down browser.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
      configurable: true,
    });
  });
  await open(page);
  await page.keyboard.press("2");
  await page
    .getByRole("list", { name: /^Requests/ })
    .getByRole("listitem")
    .nth(1)
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("button", { name: "Copy cURL" }).click();

  await expect(page.getByText(/Could not copy/)).toBeVisible();
});

test.describe("drawer shortcuts", () => {
  test("digits toggle the drawers", async ({ page }) => {
    await open(page);
    for (const [key, drawer] of [
      ["1", "findings"],
      ["2", "waterfall"],
      ["3", "hops"],
      ["4", "metrics"],
      ["5", "cache"],
      ["6", "analysis"],
      ["7", "analysis"],
      ["8", "analysis"],
      ["9", "analysis"],
    ]) {
      await page.keyboard.press(key);
      await expect(drawerButton(page, drawer)).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press(key);
      await expect(drawerButton(page, drawer)).toHaveAttribute("aria-expanded", "false");
    }
  });

  test("/ opens the waterfall with its filter focused, and typing in it leaves the keys alone", async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press("/");
    await expect(filter(page)).toBeFocused();

    await page.keyboard.type("12/");
    await expect(filter(page)).toHaveValue("12/");
    await expect(drawerButton(page, "findings")).toHaveAttribute("aria-expanded", "false");
    await expect(drawerButton(page, "waterfall")).toHaveAttribute("aria-expanded", "true");
  });

  test("the keys are the dialog's while one is open", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
    await page.keyboard.press("2");
    await page.keyboard.press("/");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(drawerButton(page, "waterfall")).toHaveAttribute("aria-expanded", "false");
  });

  test("the help lists them", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Help" });
    await expect(help.getByRole("region", { name: "Panels" })).toContainText(
      "Filter the waterfall requests"
    );
  });
});
