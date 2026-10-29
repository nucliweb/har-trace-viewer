import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const compareUrl = pathToFileURL(resolve(import.meta.dirname, ".output/compare/index.html")).href;

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  await page.context().setOffline(true);
  await page.goto(compareUrl);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  return errors;
}

const pane = (page: Page, side: "A" | "B") =>
  page.getByRole("region", { name: new RegExp(`^${side} · `) });

test("renders both flows as stacked diagrams driven by one step track", async ({ page }) => {
  const errors = await open(page);

  await expect(pane(page, "A")).toHaveAccessibleName("A · Without cache");
  await expect(pane(page, "B")).toHaveAccessibleName("B · With cache");
  await expect(page.locator("#a-diagram-svg")).toBeVisible();
  await expect(page.locator("#b-diagram-svg")).toBeVisible();
  const a = await page.locator("#a-diagram-svg").boundingBox();
  const b = await page.locator("#b-diagram-svg").boundingBox();
  expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height - 1);
  await expect(page.getByRole("tablist")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Next advances both diagrams", async ({ page }) => {
  const errors = await open(page);
  await expect(pane(page, "A")).toHaveAttribute("data-step", "0");
  await expect(pane(page, "B")).toHaveAttribute("data-step", "0");

  await page.getByRole("button", { name: "Next →" }).click();

  await expect(page.getByText(/^Step 2 \/ \d+$/)).toBeVisible();
  await expect(pane(page, "A")).toHaveAttribute("data-step", "1");
  await expect(pane(page, "B")).toHaveAttribute("data-step", "1");

  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Next →" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("the Deltas panel shows the repeat visit loading less", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "Toggle deltas" }).click();

  const table = page.getByRole("table", { name: "Metric deltas" });
  await expect(table).toBeVisible();
  const delta = (label: string) =>
    table
      .getByRole("row", { name: new RegExp(`^${label} `) })
      .getByRole("cell")
      .nth(2);
  const deltas = [await delta("onLoad").textContent(), await delta("Requests").textContent()];
  expect(deltas.some((text) => text?.startsWith("−"))).toBe(true);
  await expect(page.getByRole("table", { name: "Host deltas" }).getByRole("row")).not.toHaveCount(
    1
  );
  expect(errors).toEqual([]);
});

test("HTML text stays at 12px or larger", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Toggle deltas" }).click();

  const small = await page.evaluate(() =>
    [...document.body.querySelectorAll("*")]
      .filter(
        (el) =>
          !(el instanceof SVGElement) &&
          !el.closest("svg") &&
          [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) &&
          el.getBoundingClientRect().width > 0 &&
          parseFloat(getComputedStyle(el).fontSize) < 12
      )
      .map((el) => (el.textContent ?? "").trim().slice(0, 30))
  );
  expect(small).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  for (const deltas of [false, true]) {
    test(`axe wcag2a/aa has no violations: ${scheme} theme, ${deltas ? "deltas open" : "third-party step"}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      const errors = await open(page);
      await page.getByRole("tab", { name: /Third-party requests/ }).click();
      if (deltas) await page.getByRole("button", { name: "Toggle deltas" }).click();
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
        }))
      ).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("stacks the diagrams and the step panel without horizontal scroll", async ({ page }) => {
    await open(page);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    const a = await page.locator("#a-diagram-svg").boundingBox();
    const b = await page.locator("#b-diagram-svg").boundingBox();
    expect(a!.height).toBeGreaterThan(100);
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  });
});
