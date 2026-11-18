import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { animationsSettled } from "./animations";

// A report of one page with ten thousand synthetic requests (see global-setup.ts): its waterfall
// renders the rows near the view only, every row a scroll away.
const reportUrl = pathToFileURL(resolve(import.meta.dirname, ".output/large/index.html")).href;
const COUNT = 10_000;
// Row elements in the DOM (the rows and the gaps standing for the others), whatever the scroll.
const BOUND = 120;

const region = (page: Page) => page.getByRole("region", { name: "Waterfall details" });
const list = (page: Page) => region(page).getByRole("list", { name: /^Requests/ });
const items = (page: Page) => list(page).getByRole("listitem");

async function openWaterfall(page: Page, hash = "") {
  await page.goto(`${reportUrl}${hash}`);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  if (!hash.includes("d=waterfall")) {
    await page.getByRole("button", { name: "Toggle waterfall" }).click();
  }
  await expect(items(page).first()).toBeVisible();
}

/** The position (1-based) of the row that has the focus, and whether it shows in the region. */
function focusedRow(page: Page) {
  return page.evaluate(() => {
    const row = document.activeElement?.closest<HTMLElement>("[data-index]");
    const scroller = row?.closest('[role="region"]');
    if (!row || !scroller) return null;
    const box = row.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    // The sticky header (the ruler, or the table's) covers the top of the region.
    const header =
      scroller.querySelector("thead") ?? scroller.firstElementChild!.firstElementChild!;
    const headerBottom = header.getBoundingClientRect().bottom;
    return {
      position: Number(row.dataset.index) + 1,
      shown: box.top >= headerBottom - 1 && box.bottom <= view.bottom + 1,
    };
  });
}

/**
 * Scrolls the region from top to bottom a view at a time, and at each step checks the
 * rendered rows: how many elements the list holds, and how far each row is from where it would
 * be with every row rendered (its position times the row height).
 */
function scrollThrough(page: Page, listSelector: string) {
  return page.evaluate(async (selector) => {
    const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
    const scroller = document.querySelector<HTMLElement>(
      '[role="region"][aria-label="Waterfall details"]'
    )!;
    const listOf = () => scroller.querySelector<HTMLElement>(selector)!;
    const tops = () => {
      const firsts = new Map<number, Element>();
      for (const part of listOf().querySelectorAll<HTMLElement>(":scope > [data-index]")) {
        const index = Number(part.dataset.index);
        if (!firsts.has(index)) firsts.set(index, part);
      }
      return firsts;
    };
    const top = (element: Element) => element.getBoundingClientRect().top;
    const firsts = tops();
    // From a row between two rows, as the panel measures it.
    const a = [...firsts.keys()].find((index) => firsts.has(index - 1))!;
    const pitch = top(firsts.get(a + 1)!) - top(firsts.get(a)!);
    let maxElements = 0;
    let maxError = 0;
    let steps = 0;
    scroller.scrollTop = 0;
    await frame();
    for (;;) {
      await frame();
      maxElements = Math.max(maxElements, listOf().children.length);
      const listTop = top(listOf());
      for (const [index, part] of tops()) {
        maxError = Math.max(maxError, Math.abs(top(part) - listTop - index * pitch));
      }
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) break;
      scroller.scrollTop += scroller.clientHeight;
      steps++;
    }
    const last = [...tops().values()].at(-1)!;
    const box = last.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    return {
      steps,
      pitch,
      maxElements,
      maxError,
      listHeight: listOf().getBoundingClientRect().height,
      lastIndex: Number((last as HTMLElement).dataset.index),
      lastText: last.textContent,
      lastShown: box.top >= view.top && box.bottom <= view.bottom + 1,
    };
  }, listSelector);
}

test.describe("a waterfall of ten thousand requests", () => {
  // Opening a 9 MB report takes a while on a slow runner.
  test.setTimeout(90_000);

  test("keeps a bounded number of rows in the DOM from top to bottom, and reaches the last request", async ({
    page,
  }) => {
    await openWaterfall(page);
    await expect(page.getByText(`${COUNT} requests`)).toBeVisible();
    await expect(items(page).first()).toHaveAttribute("aria-posinset", "1");
    await expect(items(page).first()).toHaveAttribute("aria-setsize", String(COUNT));
    expect(await list(page).locator(":scope > li").count()).toBeLessThan(BOUND);
    await expect(region(page).getByRole("button", { name: /^Show \d+ more/ })).toHaveCount(0);

    const result = await scrollThrough(page, "ol");
    expect(result.maxElements).toBeLessThan(BOUND);
    // Each rendered row sits where it would with every row rendered, to a pixel.
    expect(result.maxError).toBeLessThan(1);
    expect(result.listHeight).toBeCloseTo(COUNT * result.pitch, 0);
    expect(result.lastIndex).toBe(COUNT - 1);
    expect(result.lastShown).toBe(true);
    await expect(items(page).last()).toHaveAttribute("aria-posinset", String(COUNT));

    // The mark lines span the whole list, down to its last row.
    const lines = region(page).locator("div > div[aria-hidden='true']").first();
    const linesBox = (await lines.boundingBox())!;
    const lastBox = (await items(page).last().boundingBox())!;
    expect(linesBox.y + linesBox.height).toBeGreaterThanOrEqual(lastBox.y + lastBox.height);
  });

  test("moves the focus past the rendered rows with the keyboard, onto a row in view", async ({
    page,
  }) => {
    await openWaterfall(page);
    await items(page).first().getByRole("button").first().focus();
    const rendered = await list(page).locator(":scope > li[data-index]").count();
    for (let i = 0; i < rendered + 10; i++) await page.keyboard.press("ArrowDown");
    expect(await focusedRow(page)).toEqual({ position: rendered + 11, shown: true });

    await page.keyboard.press("End");
    expect(await focusedRow(page)).toEqual({ position: COUNT, shown: true });
    await page.keyboard.press("PageUp");
    const paged = (await focusedRow(page))!;
    expect(paged.position).toBeLessThan(COUNT - 5);
    expect(paged.shown).toBe(true);
    await page.keyboard.press("ArrowUp");
    expect(await focusedRow(page)).toEqual({ position: paged.position - 1, shown: true });
    await page.keyboard.press("Home");
    expect(await focusedRow(page)).toEqual({ position: 1, shown: true });

    // Tab past the last rendered row goes on to the next one.
    const last = list(page).locator(":scope > li[data-index]").last();
    const position = Number(await last.getAttribute("aria-posinset"));
    await last.getByRole("button").first().focus();
    await page.keyboard.press("Tab");
    expect(await focusedRow(page)).toEqual({ position: position + 1, shown: true });
    await page.keyboard.press("Shift+Tab");
    expect(await focusedRow(page)).toEqual({ position, shown: true });

    // The focused row stays rendered when the wheel scrolls away from it.
    await region(page).hover();
    await page.mouse.wheel(0, 20_000);
    await expect.poll(() => region(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(10_000);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
    expect((await focusedRow(page))!.position).toBe(position);
  });

  test("a link opens with a request far down selected and in view, and keeps it selected", async ({
    page,
  }) => {
    await openWaterfall(page, "#d=waterfall&r=9000");
    const selected = list(page).getByRole("button", { expanded: true });
    await expect(selected).toBeVisible();
    await expect(list(page).getByRole("button", { name: "Copy URL" })).toBeVisible();
    const item = items(page).filter({ has: page.getByRole("button", { expanded: true }) });
    const position = Number(await item.getAttribute("aria-posinset"));
    expect(position).toBeGreaterThan(8000);
    const box = (await selected.boundingBox())!;
    const view = (await region(page).boundingBox())!;
    expect(box.y).toBeGreaterThan(view.y);
    expect(box.y + box.height).toBeLessThan(view.y + view.height);

    const where = await region(page).evaluate((el) => el.scrollTop);
    await region(page).evaluate((el) => (el.scrollTop = 0));
    await expect(selected).toHaveCount(0);
    await region(page).evaluate((el, top) => (el.scrollTop = top), where);
    await expect(list(page).getByRole("button", { expanded: true })).toBeVisible();

    // The rows below the selected one make room for its actions.
    const result = await scrollThrough(page, "ol");
    expect(result.lastShown).toBe(true);
    expect(result.lastIndex).toBe(COUNT - 1);
  });

  test("sorts and filters the whole list, starting again from the top", async ({ page }) => {
    await openWaterfall(page);
    await region(page).evaluate((el) => (el.scrollTop = 100_000));
    await page.getByRole("button", { name: "Sort by size" }).click();
    await expect(page.getByText(`${COUNT} requests · by size ↓`)).toBeVisible();
    expect(await region(page).evaluate((el) => el.scrollTop)).toBe(0);
    await expect(items(page).first()).toHaveAttribute("aria-posinset", "1");
    expect(await list(page).locator(":scope > li").count()).toBeLessThan(BOUND);

    await page.getByRole("searchbox", { name: "Filter requests" }).fill("type:font");
    const status = page.getByText(/^\d+ of 10000 requests/);
    await expect(status).toBeVisible();
    const fonts = Number((await status.textContent())!.split(" ")[0]);
    expect(fonts).toBeGreaterThan(300);
    const result = await scrollThrough(page, "ol");
    expect(result.lastIndex).toBe(fonts - 1);
    expect(result.lastText).toContain(".woff2");

    // A short list renders every row, as a plain list.
    await page.getByRole("searchbox", { name: "Filter requests" }).fill("status:4xx");
    const errors = page.getByText(/^\d+ of 10000 requests/);
    await expect(errors).toHaveText(/^\d{2,3} of/);
    const shown = Number((await errors.textContent())!.split(" ")[0]);
    expect(shown).toBeLessThanOrEqual(300);
    await expect(items(page)).toHaveCount(shown);
    await expect(items(page).first()).not.toHaveAttribute("aria-setsize");
  });

  test("the table view renders a window of rows, with its true row count", async ({ page }) => {
    await openWaterfall(page);
    await page.getByRole("button", { name: "Table", exact: true }).click();
    const table = page.getByRole("table", { name: /^Requests/ });
    await expect(table).toHaveAttribute("aria-rowcount", String(COUNT + 1));
    expect(await table.locator("tr").count()).toBeLessThan(BOUND);

    const result = await scrollThrough(page, "tbody");
    expect(result.maxElements).toBeLessThan(BOUND);
    expect(result.maxError).toBeLessThan(1);
    expect(result.lastShown).toBe(true);
    const last = table.getByRole("row").last();
    await expect(last).toHaveAttribute("aria-rowindex", String(COUNT + 1));
    // The header stays at the top of the region.
    const header = (await table.getByRole("columnheader", { name: /name/i }).boundingBox())!;
    expect(header.y).toBeCloseTo((await region(page).boundingBox())!.y, -1);

    // Tab past the last rendered row goes on to the next one.
    await region(page).evaluate((el) => (el.scrollTop = 0));
    await expect(table.locator("tbody > tr[data-index]").first()).toHaveAttribute(
      "data-index",
      "0"
    );
    const lastRendered = table.locator("tbody > tr[data-index]").last();
    const index = Number(await lastRendered.getAttribute("data-index"));
    await lastRendered.getByRole("button").focus();
    await page.keyboard.press("Tab");
    expect(await focusedRow(page)).toEqual({ position: index + 2, shown: true });
  });

  test("works on a 360px-wide phone", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      reducedMotion: "reduce",
      hasTouch: true,
    });
    const page = await context.newPage();
    await openWaterfall(page);
    const result = await scrollThrough(page, "ol");
    expect(result.maxElements).toBeLessThan(BOUND);
    expect(result.maxError).toBeLessThan(1);
    expect(result.lastShown).toBe(true);
    expect(result.lastIndex).toBe(COUNT - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360
    );
    await context.close();
  });

  for (const view of ["Waterfall", "Table"] as const) {
    test(`has no axe violations in the middle of the list: ${view.toLowerCase()} view`, async ({
      page,
    }) => {
      await openWaterfall(page, "#d=waterfall&r=5000");
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(region(page).getByRole("button", { name: "Copy URL" })).toBeVisible();
      if (view === "Waterfall") {
        await list(page).getByRole("button", { expanded: true }).focus();
        await page.keyboard.press("ArrowDown");
        await expect(page.getByRole("tooltip")).toBeVisible();
      }
      await animationsSettled(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
        }))
      ).toEqual([]);
    });
  }

  test("opens a row's tooltip above it when it would run past the bottom of the list", async ({
    page,
  }) => {
    // Room above the bottom row for the whole tooltip, measured once the drawer stops moving.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWaterfall(page);
    await animationsSettled(page);
    // The last row that shows whole, at the bottom edge of the scrolling list.
    const last = await page.evaluate(() => {
      const body = document
        .querySelector("[data-index]")!
        .closest<HTMLElement>("ul, ol")!.parentElement!;
      let scroller: HTMLElement | null = body;
      while (scroller && getComputedStyle(scroller).overflowY === "visible") {
        scroller = scroller.parentElement;
      }
      const bottom = scroller!.getBoundingClientRect().bottom;
      const rows = [...document.querySelectorAll<HTMLElement>("[data-index]")];
      return rows.filter((row) => row.getBoundingClientRect().bottom <= bottom).at(-1)!.dataset
        .index!;
    });
    await page.locator(`[data-index="${last}"] button`).first().hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();

    const fits = await tooltip.evaluate((tip) => {
      let scroller = tip.parentElement;
      while (scroller && getComputedStyle(scroller).overflowY === "visible") {
        scroller = scroller.parentElement;
      }
      const box = scroller!.getBoundingClientRect();
      const rect = tip.getBoundingClientRect();
      return { top: rect.top >= box.top, bottom: rect.bottom <= box.bottom };
    });
    expect(fits).toEqual({ top: true, bottom: true });
  });
});
