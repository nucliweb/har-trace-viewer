import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const bundle = resolve(import.meta.dirname, ".output/bundle/index.html");
const FLOW_ASSIGNMENT = "window.__HTV_FLOW__ = ";

// A report whose embedded flow has no steps: the diagram view throws while rendering.
async function openBrokenReport(page: Page, testInfo: TestInfo) {
  const html = await readFile(bundle, "utf8");
  const start = html.indexOf(FLOW_ASSIGNMENT) + FLOW_ASSIGNMENT.length;
  const end = html.indexOf("</script>", start);
  const flow = JSON.parse(html.slice(start, end).trim().replace(/;$/, ""));
  flow.steps = [];
  const broken = html.slice(0, start) + JSON.stringify(flow) + html.slice(end);
  const file = testInfo.outputPath("broken-report.html");
  await writeFile(file, broken);
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(file).href);
}

test("a view that throws shows a message with focus on its heading, and a way back to the start", async ({
  page,
}, testInfo) => {
  await openBrokenReport(page, testInfo);

  const heading = page.getByRole("heading", { name: "Something went wrong" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("This view could not be drawn.");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.locator("#diagram-svg")).toHaveCount(0);

  await page.getByRole("button", { name: "Back to the start" }).click();

  await expect(page.getByText("Build your flow")).toBeVisible();
  await expect(heading).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset" })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the error screen has no axe violations: ${scheme} theme`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await openBrokenReport(page, testInfo);
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) }))
    ).toEqual([]);
    await context.close();
  });
}
