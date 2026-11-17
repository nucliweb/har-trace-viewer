import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { animationsSettled } from "./animations";
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

async function openRequests(page: Page) {
  await page.getByRole("button", { name: "Toggle deltas" }).click();
  // A click on a drawer still sliding in would scroll the pane sideways to reach its target.
  await animationsSettled(page);
  await page
    .getByRole("group", { name: "Deltas views" })
    .getByRole("button", { name: "Requests" })
    .click();
  const table = page.getByRole("table", { name: "Request deltas" });
  await expect(table).toBeVisible();
  return table;
}

test("the Requests view pairs every request of the cold load with the warm one", async ({
  page,
}) => {
  const errors = await open(page);
  const table = await openRequests(page);

  // Both loads made the same 34 requests: all paired, none added or removed.
  const filters = page.getByRole("group", { name: "Filter requests" });
  await expect(filters.getByRole("button", { name: "All 34" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Added 0" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Removed 0" })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(35);
  // The warm load revalidated the document and served the framework from the browser cache.
  const documentRow = table.getByRole("row", { name: /^webperf-snippets\.nucliweb\.net / });
  await expect(documentRow.getByRole("cell").nth(8)).toHaveText("200 → 304 (changed)");
  const framework = table.getByRole("row", { name: /^framework-9387e000915d7b64\.js / });
  await expect(framework.getByRole("cell").nth(9)).toHaveText("network → browser cache (changed)");
  await expect(framework.getByRole("cell").nth(7)).toHaveText(/^−47 KB/);

  // The biggest change of time first; a header sorts by another column.
  const first = () => table.getByRole("row").nth(1).getByRole("rowheader");
  await expect(first()).toHaveText("591-937c757170f2c1cd.js");
  await page.getByRole("button", { name: "Sort by Δ size" }).click();
  await expect(first()).toHaveText("js?id=G-NNX9SYKEV2");
  expect(errors).toEqual([]);
});

test("HTML text stays at 12px or larger", async ({ page }) => {
  await open(page);
  await openRequests(page);

  const smallText = () =>
    page.evaluate(() =>
      [...document.body.querySelectorAll("*")]
        .filter(
          (el) =>
            !(el instanceof SVGElement) &&
            !el.closest("svg") &&
            [...el.childNodes].some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
            ) &&
            el.getBoundingClientRect().width > 0 &&
            parseFloat(getComputedStyle(el).fontSize) < 12
        )
        .map((el) => (el.textContent ?? "").trim().slice(0, 30))
    );
  expect(await smallText()).toEqual([]);
  await page
    .getByRole("group", { name: "Deltas views" })
    .getByRole("button", { name: "Summary" })
    .click();
  await expect(page.getByRole("table", { name: "Metric deltas" })).toBeVisible();
  expect(await smallText()).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  for (const deltas of [false, "summary", "requests"] as const) {
    test(`axe wcag2a/aa has no violations: ${scheme} theme, ${deltas ? `deltas open on ${deltas}` : "third-party step"}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      const errors = await open(page);
      const tab = page.getByRole("tab", { name: /Third-party requests/ });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      if (deltas === "summary") {
        await page.getByRole("button", { name: "Toggle deltas" }).click();
        await expect(page.getByRole("table", { name: "Metric deltas" })).toBeVisible();
      } else if (deltas === "requests") {
        await openRequests(page);
      }
      await animationsSettled(page);
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

  test("scrolls the request table inside the drawer, its request column in view", async ({
    page,
  }) => {
    await open(page);
    const table = await openRequests(page);
    const region = page.getByRole("region", { name: "Request deltas" });
    await animationsSettled(page);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );
    const box = await region.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    await region.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    const name = table.getByRole("row").nth(1).getByRole("rowheader");
    const nameBox = await name.boundingBox();
    expect(nameBox!.x).toBeGreaterThanOrEqual(box!.x - 1);
    expect(nameBox!.x).toBeLessThan(box!.x + 8);
  });
});

test.describe("a comparison of ten thousand requests", () => {
  const largeUrl = pathToFileURL(
    resolve(import.meta.dirname, ".output/large-compare/index.html")
  ).href;

  test("renders the request rows near the view only, and the last ones once scrolled to", async ({
    page,
  }) => {
    await page.goto(largeUrl);
    await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
    const table = await openRequests(page);

    const count = Number(await table.getAttribute("aria-rowcount")) - 1;
    expect(count).toBeGreaterThanOrEqual(10_000);
    const rendered = table.locator("tbody tr[data-index]");
    expect(await rendered.count()).toBeLessThan(200);

    const region = page.getByRole("region", { name: "Request deltas" });
    await region.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(table.locator(`tbody tr[data-index="${count - 1}"]`)).toBeVisible();
    expect(await rendered.count()).toBeLessThan(200);
  });
});

test("a comparison link reopens a drawer in pane B, the step and the Deltas Requests view", async ({
  page,
  context,
}) => {
  await open(page);
  await page.getByRole("tab").nth(2).click();
  await pane(page, "B").getByRole("button", { name: "Toggle waterfall" }).click();
  await expect.poll(() => new URL(page.url()).hash).toContain("d=waterfall&side=b");
  expect(new URL(page.url()).hash).toContain("p=3");

  const fresh = await context.newPage();
  await fresh.goto(page.url());
  await expect(fresh.getByRole("tab", { selected: true })).toHaveText(/^3/);
  await expect(pane(fresh, "B").getByRole("region", { name: "Waterfall details" })).toBeVisible();
  await expect(pane(fresh, "A").getByRole("region", { name: "Waterfall details" })).toHaveCount(0);
  await fresh.close();

  // The Deltas drawer on its Requests view, narrowed to the changed requests.
  await page.goto("about:blank");
  await page.goto(compareUrl);
  await openRequests(page);
  await page
    .getByRole("group", { name: "Filter requests" })
    .getByRole("button", { name: /^Changed/ })
    .click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#d=deltas&dv=requests&df=changed");
  const link = page.url();

  const reopened = await context.newPage();
  await reopened.goto(link);
  await expect(reopened.getByRole("table", { name: "Request deltas" })).toBeVisible();
  await expect(
    reopened
      .getByRole("group", { name: "Filter requests" })
      .getByRole("button", { name: /^Changed/ })
  ).toHaveAttribute("aria-pressed", "true");
  await reopened.reload();
  await expect(reopened.getByRole("table", { name: "Request deltas" })).toBeVisible();
});

test("a malformed comparison link opens the comparison as it is", async ({ page }) => {
  await page.goto(`${compareUrl}#d=hops&side=z&dv=grid&p=-2`);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  await expect(page.getByRole("region", { name: /details/ })).toHaveCount(0);
});
