import { expect, type Page } from "@playwright/test";
import { animationsSettled } from "./animations";
import { JWT_HEADER, SECRETS } from "../packages/core/tests/helpers/secret-har";

// Every secret of the synthetic HAR and trace (packages/core/tests/helpers/secret-har.ts); a URL
// keeps its email percent-encoded too.
const SECRET_VALUES = [...Object.values(SECRETS), JWT_HEADER, "jane.doe%40example.org"];

/** The secrets found in any of the texts. */
export const leaks = (texts: string[]) =>
  SECRET_VALUES.filter((secret) => texts.some((text) => text.includes(secret)));

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

// Clicks a copy button and returns what reached the clipboard, emptied first so a copy that did
// not happen cannot pass for one that did.
async function copied(page: Page, name: string): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.getByRole("button", { name }).click();
  await expect.poll(() => readClipboard(page)).not.toBe("");
  return readClipboard(page);
}

/**
 * Walks a report the way a reader does, from its first step: every step, every drawer (the
 * digits 1 to 9 open them), and the detail of every request with its URL and cURL command
 * copied. Returns the page's HTML at each stop and what each copy put on the clipboard. The
 * page needs the clipboard-read and clipboard-write permissions.
 */
export async function everythingShown(
  page: Page
): Promise<{ html: string[]; clipboard: string[] }> {
  const html = [await page.content()];
  const clipboard: string[] = [];

  const counter = page.getByText(/^Step \d+ \/ \d+$/);
  const total = Number((await counter.textContent())!.split("/")[1]);
  for (let step = 1; step < total; step++) {
    await page.keyboard.press("ArrowRight");
    await expect(counter).toHaveText(`Step ${step + 1} / ${total}`);
    html.push(await page.content());
  }

  for (const key of ["1", "3", "4", "5", "6", "7", "8", "9"]) {
    await page.keyboard.press(key);
    await animationsSettled(page);
    html.push(await page.content());
  }

  await page.keyboard.press("2");
  const rows = page
    .getByRole("region", { name: "Waterfall details" })
    .getByRole("list", { name: /^Requests/ })
    .locator(":scope > li");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    await rows.nth(i).getByRole("button").first().click();
    await expect(page.getByRole("region", { name: "Request details" })).toBeVisible();
    html.push(await page.content());
    clipboard.push(await copied(page, "Copy URL"), await copied(page, "Copy cURL"));
  }
  return { html, clipboard };
}
