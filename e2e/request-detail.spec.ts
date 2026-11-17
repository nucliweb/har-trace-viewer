import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { animationsSettled } from "./animations";
import { everythingShown, leaks } from "./secrets";
import { secretHar } from "../packages/core/tests/helpers/secret-har";

// A report of a synthetic HAR and trace with a secret in every header and URL that can carry one
// (global-setup.ts).
const reportUrl = pathToFileURL(resolve(import.meta.dirname, ".output/secrets/index.html")).href;

const region = (page: Page) => page.getByRole("region", { name: "Waterfall details" });
const list = (page: Page) => region(page).getByRole("list", { name: /^Requests/ });
const rows = (page: Page) => list(page).locator(":scope > li");
const detail = (page: Page) => page.getByRole("region", { name: "Request details" });

async function openDocument(page: Page, hash = "") {
  await page.goto(`${reportUrl}${hash}`);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press("2");
  await expect(rows(page).first()).toBeVisible();
  // The second request is the document, after the login redirect.
  const button = rows(page).nth(1).getByRole("button").first();
  await button.click();
  await expect(detail(page)).toBeVisible();
  return button;
}

async function axe(page: Page) {
  await animationsSettled(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
  }));
}

test.describe("the detail of a request", () => {
  test("shows the headers with the secrets masked, and none of them anywhere in the page", async ({
    page,
  }) => {
    await openDocument(page);
    const request = detail(page).getByRole("group", { name: /^Request headers \(\d+\)$/ });
    const value = (name: string) =>
      request
        .locator("dt")
        .filter({ hasText: new RegExp(`^${name}$`) })
        .locator("+ dd");

    await expect(value("authorization")).toHaveText(/^\[redacted\]\s*masked$/);
    await expect(value("cookie")).toContainText("sid=[redacted]");
    await expect(value("cookie").getByText("masked")).toBeVisible();
    await expect(value("accept")).toHaveText("text/html");
    await expect(detail(page)).toContainText(
      "https://shop.example.com/account?email=[email]&token=[redacted]&lang=en"
    );
    expect(leaks([await page.content()])).toEqual([]);
  });

  test.describe("with the clipboard", () => {
    // Tall enough for the waterfall drawer to show a request's detail with its copy buttons.
    test.use({
      permissions: ["clipboard-read", "clipboard-write"],
      viewport: { width: 1280, height: 1800 },
    });

    test("leaves no secret of the HAR or its trace in any step, drawer, request or copy", async ({
      page,
    }) => {
      await page.goto(reportUrl);
      await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();

      const { html, clipboard } = await everythingShown(page);

      // The URL and the cURL command of every request.
      expect(clipboard).toHaveLength(secretHar().log.entries.length * 2);

      expect(clipboard).toContain(
        "https://shop.example.com/account?email=[email]&token=[redacted]&lang=en"
      );
      expect(clipboard).toContain("curl 'https://shop.example.com/reset/[redacted]'");
      expect(leaks([...html, ...clipboard])).toEqual([]);
    });
  });

  test("keeps the keyboard on the rows: arrows move between them, Tab goes through the detail", async ({
    page,
  }) => {
    const button = await openDocument(page);
    await button.focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).nth(2).getByRole("button").first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(button).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Copy URL" })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Copy request headers" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Copy response headers" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(rows(page).nth(2).getByRole("button").first()).toBeFocused();
  });

  test("opens from the link and in the table view, and passes axe in both", async ({ page }) => {
    await openDocument(page);
    expect(await axe(page)).toEqual([]);
    await expect(page).toHaveURL(/r=1/);

    // A new document: the same URL with another hash would only change the hash.
    await page.goto("about:blank");
    await page.goto(`${reportUrl}#d=waterfall&r=1&v=table`);
    await expect(detail(page)).toBeVisible();
    await expect(detail(page).locator("xpath=ancestor::td")).toHaveAttribute("colspan", "10");
    expect(await axe(page)).toEqual([]);
  });

  test("fits a 360px-wide phone, in dark mode too", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      colorScheme: "dark",
      hasTouch: true,
    });
    const page = await context.newPage();
    await openDocument(page);
    const box = (await detail(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    // The copy buttons are 24px targets at least (WCAG 2.5.8).
    const copy = (await page.getByRole("button", { name: "Copy request headers" }).boundingBox())!;
    expect(copy.height).toBeGreaterThanOrEqual(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360
    );
    expect(await axe(page)).toEqual([]);
    await context.close();
  });

  test("marks masked values with a border in forced colors", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openDocument(page);
    const tag = detail(page).getByText("masked").first();
    const border = await tag.evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(border).toBe("solid");
  });
});
