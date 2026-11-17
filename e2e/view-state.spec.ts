import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// A generated report opened from file://: the flow is embedded, so a link is meaningful at once.
const reportUrl = pathToFileURL(resolve(import.meta.dirname, ".output/bundle/index.html")).href;

const drawerButton = (page: Page, drawer: string) => page.locator(`[data-drawer="${drawer}"]`);
const filter = (page: Page) => page.getByRole("searchbox", { name: "Filter requests" });
const tableView = (page: Page) => page.getByRole("button", { name: "Table", exact: true });

test("a link reopens the drawer, the filter, the view and the sort", async ({ page, context }) => {
  await page.goto(reportUrl);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press("2");
  await filter(page).fill("type:script");
  await tableView(page).click();
  await page.getByRole("button", { name: "Sort by size" }).click();
  await expect
    .poll(() => new URL(page.url()).hash)
    .toBe("#q=type%3Ascript&v=table&s=size.desc&d=waterfall");

  const fresh = await context.newPage();
  await fresh.goto(page.url());
  await expect(filter(fresh)).toHaveValue("type:script");
  await expect(drawerButton(fresh, "waterfall")).toHaveAttribute("aria-expanded", "true");
  await expect(tableView(fresh)).toHaveAttribute("aria-pressed", "true");
  await expect(fresh.getByRole("columnheader", { name: /size/i })).toHaveAttribute(
    "aria-sort",
    "descending"
  );
});

test("the filter, sort and view survive a reload, and the link wins over them", async ({
  page,
}) => {
  await page.goto(reportUrl);
  await page.keyboard.press("2");
  await filter(page).fill("type:script");
  await tableView(page).click();
  await page.getByRole("button", { name: "Sort by time" }).click();

  // A plain address, opened afresh (not a hash change of the same document): only the stored
  // values speak.
  await page.goto("about:blank");
  await page.goto(reportUrl);
  await page.keyboard.press("2");
  await expect(filter(page)).toHaveValue("type:script");
  await expect(tableView(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("columnheader", { name: /time/i })).toHaveAttribute(
    "aria-sort",
    "descending"
  );

  // The link names its own view.
  await page.goto("about:blank");
  await page.goto(`${reportUrl}#d=waterfall&q=&v=waterfall`);
  await expect(filter(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Waterfall", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("a malformed link opens the report as it is", async ({ page }) => {
  await page.goto(`${reportUrl}#d=nope&r=-4&v=grid&s=x`);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  await expect(filter(page)).toHaveCount(0);
});

test("typing in the filter adds no history entry", async ({ page }) => {
  await page.goto(reportUrl);
  await page.keyboard.press("2");
  const before = await page.evaluate(() => history.length);
  await filter(page).pressSequentially("script");
  expect(await page.evaluate(() => history.length)).toBe(before);
});

const twoPagesUrl = pathToFileURL(
  resolve(import.meta.dirname, ".output/two-pages/index.html")
).href;
const selectedTab = (page: Page) => page.getByRole("tab", { selected: true });

test("a link to a request on a later page opens on that page with the request selected", async ({
  page,
  context,
}) => {
  await page.goto(twoPagesUrl);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  // The last step belongs to the second page.
  await page.getByRole("tab").last().click();
  await page.keyboard.press("2");
  const row = page
    .getByRole("region", { name: "Waterfall details" })
    .getByRole("list", { name: /^Requests/ })
    .locator(":scope > li")
    .nth(1)
    .getByRole("button")
    .first();
  await row.click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/p=\d+/);
  const link = page.url();
  expect(new URL(link).hash).toMatch(/r=\d+/);
  const tab = await selectedTab(page).textContent();

  const fresh = await context.newPage();
  await fresh.goto(link);
  await expect(selectedTab(fresh)).toHaveText(tab!);
  await expect(drawerButton(fresh, "waterfall")).toHaveAttribute("aria-expanded", "true");
  await expect(fresh.getByText("Page 2 · Problems").first()).toBeVisible();
  await expect(fresh.getByRole("region", { name: "Waterfall details" })).toContainText(
    "recommendations.json"
  );
  await expect(fresh.getByRole("region", { name: "Request details" })).toBeVisible();

  // A reload keeps the same view.
  await fresh.reload();
  await expect(selectedTab(fresh)).toHaveText(tab!);
  await expect(fresh.getByRole("region", { name: "Request details" })).toBeVisible();
});

test("the step follows the keyboard and the dots without history entries, and out-of-range steps are ignored", async ({
  page,
}) => {
  await page.goto(reportUrl);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  const before = await page.evaluate(() => history.length);
  await page.getByRole("region", { name: /./ }).first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/^Step 2 \/ \d+$/)).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("#p=2");
  await page.getByRole("tab").nth(2).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#p=3");
  expect(await page.evaluate(() => history.length)).toBe(before);
  // Autoplay stays out of the link.
  await page.getByRole("button", { name: "Auto play" }).click();
  expect(new URL(page.url()).hash).not.toContain("play");

  await page.goto("about:blank");
  await page.goto(`${reportUrl}#p=9999`);
  await expect(page.getByText(/^Step (\d+) \/ \1$/)).toBeVisible();
  await page.goto("about:blank");
  await page.goto(`${reportUrl}#p=0`);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
});
