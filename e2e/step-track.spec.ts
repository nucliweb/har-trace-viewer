import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { animationsSettled } from "./animations";

// A report of two pages (see global-setup.ts): the step track groups the steps of each page.
const reportUrl = pathToFileURL(resolve(import.meta.dirname, ".output/two-pages/index.html")).href;

const track = (page: Page) => page.getByRole("tablist", { name: "Steps" });

async function axe(page: Page) {
  await animationsSettled(page);
  const results = await new AxeBuilder({ page })
    .include('[role="tablist"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((v) => v.id);
}

for (const [name, width] of [
  ["a desktop", 1280],
  ["a 360px-wide phone", 360],
] as const) {
  test(`leads the steps of each page with its page on ${name}, and passes axe`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(reportUrl);
    await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();

    await expect(track(page).getByText("P1")).toBeVisible();
    await expect(track(page).getByText("P2")).toBeAttached();
    await expect(track(page).getByRole("tab").first()).toHaveAccessibleName(/, Page 1 of 2$/);
    await expect(track(page).getByRole("tab").last()).toHaveAccessibleName(/, Page 2 of 2$/);
    expect(await axe(page)).toEqual([]);
  });
}
