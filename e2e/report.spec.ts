import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const output = resolve(import.meta.dirname, ".output");
const bundleUrl = pathToFileURL(resolve(output, "bundle/index.html")).href;
const plainUrl = pathToFileURL(resolve(output, "plain/index.html")).href;
const cachedUrl = pathToFileURL(resolve(output, "cached/index.html")).href;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

interface Collected {
  errors: string[];
  requests: string[];
}

function collect(page: Page): Collected {
  const collected: Collected = { errors: [], requests: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") collected.errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => collected.errors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => collected.errors.push(`requestfailed: ${req.url()}`));
  page.on("request", (req) => collected.requests.push(req.url()));
  return collected;
}

async function open(page: Page, url: string): Promise<Collected> {
  await page.context().setOffline(true);
  const collected = collect(page);
  await page.goto(url);
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  return collected;
}

const stepLabel = (page: Page) => page.getByText(/^Step \d+ \/ \d+$/);
const themeToggle = (page: Page) => page.getByRole("button", { name: "Toggle theme" });

async function totalSteps(page: Page): Promise<number> {
  const text = (await stepLabel(page).textContent()) ?? "";
  return Number(text.split("/")[1]);
}

test("bundled report opens over file:// offline without console errors", async ({ page }) => {
  const collected = await open(page, bundleUrl);
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: "Toggle cache analysis" }).click();
  await themeToggle(page).click();
  await page.waitForTimeout(300);
  expect(collected.errors).toEqual([]);
});

test("bundled report makes no http(s) network requests", async ({ page }) => {
  const collected = await open(page, bundleUrl);
  await page.getByRole("button", { name: "Next →" }).click();
  const remote = collected.requests.filter((url) => /^(https?|wss?|ftp):/i.test(url));
  expect(remote).toEqual([]);
  const allowed = collected.requests.filter((url) => !/^(file|data|blob):/i.test(url));
  expect(allowed).toEqual([]);
});

test("step navigation moves through every step and highlights the diagram", async ({ page }) => {
  await open(page, bundleUrl);
  const total = await totalSteps(page);
  expect(total).toBeGreaterThan(2);

  const next = page.getByRole("button", { name: "Next →" });
  const prev = page.getByRole("button", { name: "← Prev" });
  const highlighted = page.locator('#diagram-svg g[opacity="1"]');

  for (let n = 1; n <= total; n++) {
    await expect(stepLabel(page)).toHaveText(`Step ${n} / ${total}`);
    expect(await highlighted.count()).toBeGreaterThan(0);
    if (n < total) await next.click();
  }
  await expect(next).toBeDisabled();

  await prev.click();
  await expect(stepLabel(page)).toHaveText(`Step ${total - 1} / ${total}`);

  const before = await page.locator("#diagram-svg").innerHTML();
  await page.getByRole("tab", { name: /^Step 1:/ }).click();
  await expect(stepLabel(page)).toHaveText(`Step 1 / ${total}`);
  const after = await page.locator("#diagram-svg").innerHTML();
  expect(after).not.toEqual(before);

  await page.getByRole("tab", { name: new RegExp(`^Step ${total}:`) }).click();
  await expect(stepLabel(page)).toHaveText(`Step ${total} / ${total}`);
});

test("keyboard alone walks every step with ArrowRight, then End and Home", async ({ page }) => {
  await open(page, bundleUrl);
  const total = await totalSteps(page);
  const highlighted = page.locator('#diagram-svg g[opacity="1"]');

  await page.getByRole("region", { name: "Diagram" }).focus();
  for (let n = 1; n <= total; n++) {
    await expect(stepLabel(page)).toHaveText(`Step ${n} / ${total}`);
    expect(await highlighted.count()).toBeGreaterThan(0);
    await expect(page.getByRole("tab", { selected: true })).toHaveAttribute(
      "aria-label",
      new RegExp(`^Step ${n}:`)
    );
    if (n < total) await page.keyboard.press("ArrowRight");
  }
  await page.keyboard.press("ArrowRight");
  await expect(stepLabel(page)).toHaveText(`Step ${total} / ${total}`);

  await page.keyboard.press("Home");
  await expect(stepLabel(page)).toHaveText(`Step 1 / ${total}`);
  await page.keyboard.press("End");
  await expect(stepLabel(page)).toHaveText(`Step ${total} / ${total}`);
  await page.keyboard.press("ArrowLeft");
  await expect(stepLabel(page)).toHaveText(`Step ${total - 1} / ${total}`);

  // Inside the tablist the focus follows the selected tab.
  await page.getByRole("tab", { selected: true }).focus();
  await page.keyboard.press("Home");
  await expect(stepLabel(page)).toHaveText(`Step 1 / ${total}`);
  await expect(page.getByRole("tab", { name: /^Step 1:/ })).toBeFocused();

  // Space toggles autoplay.
  await page.getByRole("region", { name: "Diagram" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Auto play" })).toBeVisible();
});

interface StepResources {
  title: string;
  resources: string[];
  cacheResources: string[];
}

// URLs each step references, resolved from the flow embedded in the report.
function embeddedStepResources(page: Page): Promise<StepResources[]> {
  return page.evaluate(() => {
    interface EmbeddedFlow {
      pages: { har: { entries: { url: string }[] } }[];
      steps: {
        title: string;
        pageIndex: number;
        resourceRefs?: number[];
        cacheResourceRefs?: number[];
      }[];
    }
    const flow = (window as unknown as { __HTV_FLOW__: EmbeddedFlow }).__HTV_FLOW__;
    return flow.steps.map((step) => {
      const { entries } = flow.pages[step.pageIndex].har;
      return {
        title: step.title,
        resources: (step.resourceRefs ?? []).map((ref) => entries[ref].url),
        cacheResources: (step.cacheResourceRefs ?? []).map((ref) => entries[ref].url),
      };
    });
  });
}

test("each step's resource list shows the entries the step references", async ({ page }) => {
  const collected = await open(page, bundleUrl);
  const steps = await embeddedStepResources(page);
  expect(steps.some((s) => s.resources.length > 0)).toBe(true);

  for (const [i, step] of steps.entries()) {
    await page.getByRole("tab", { name: `Step ${i + 1}: ${step.title}` }).click();
    const openList = page.getByRole("button", { name: "View resource list" });
    if (step.resources.length === 0) {
      await expect(openList).toHaveCount(0);
      continue;
    }
    await openList.click();
    await expect(
      page.getByText(`${step.resources.length} resources`, { exact: true })
    ).toBeVisible();
    for (const url of step.resources) {
      await expect(page.locator(`[title="${url}"]`).first()).toBeAttached();
    }
    await page.getByRole("button", { name: "Close" }).click();
  }
  expect(collected.errors).toEqual([]);
});

test("each step's cache list shows the cache hits the step references", async ({ page }) => {
  const collected = await open(page, cachedUrl);
  const steps = await embeddedStepResources(page);
  expect(steps.some((s) => s.cacheResources.length > 0)).toBe(true);

  for (const [i, step] of steps.entries()) {
    await page.getByRole("tab", { name: `Step ${i + 1}: ${step.title}` }).click();
    const header = page.getByText(/^\d+ resources$/);
    if (step.cacheResources.length === 0) {
      await expect(header).toHaveCount(0);
      continue;
    }
    await expect(header).toHaveText(`${step.cacheResources.length} resources`);
    for (const url of step.cacheResources) {
      await expect(page.locator(`[title="${url}"]`).first()).toBeAttached();
    }
  }
  expect(collected.errors).toEqual([]);
});

test("theme toggle flips data-theme and the body background", async ({ page }) => {
  await open(page, bundleUrl);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  const initialTheme = await theme();
  const initialBg = await bg();
  await themeToggle(page).click();
  expect(await theme()).not.toEqual(initialTheme);
  expect(["light", "dark"]).toContain(await theme());
  await expect.poll(bg).not.toEqual(initialBg);
  await themeToggle(page).click();
  expect(await theme()).toEqual(initialTheme);
});

test("no text is rendered smaller than 12px at 1280x800", async ({ page }) => {
  await open(page, bundleUrl);
  await page.getByRole("button", { name: "Toggle cache analysis" }).click();

  expect(await page.locator("svg text").count()).toBeGreaterThan(0);

  const violations = await page.evaluate(() => {
    const MIN = 12;
    const found: string[] = [];
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String((el as HTMLElement).className?.baseVal ?? el.className).slice(0, 40)} "${(el.textContent ?? "").trim().slice(0, 30)}"`;

    const hasOwnText = (el: Element) =>
      [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());

    for (const el of document.body.querySelectorAll("*")) {
      if (el instanceof SVGElement || !hasOwnText(el)) continue;
      if (el.closest("svg")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const size = parseFloat(style.fontSize);
      if (size < MIN) found.push(`${describe(el)}: ${size}px`);
    }

    for (const el of document.querySelectorAll("svg text, svg tspan")) {
      if (!hasOwnText(el)) continue;
      const svg = el.ownerSVGElement;
      const ctm = (el as SVGGraphicsElement).getScreenCTM();
      if (!svg || !ctm) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const scale = Math.hypot(ctm.a, ctm.b);
      const rendered = parseFloat(getComputedStyle(el).fontSize) * scale;
      if (rendered < MIN - 0.01) found.push(`${describe(el)}: ${rendered.toFixed(2)}px rendered`);
    }
    return found;
  });
  expect(violations).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  for (const cachePanel of [false, true]) {
    test(`axe wcag2a/aa has no violations: ${scheme} theme, ${cachePanel ? "cache panel open" : "initial step"}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await open(page, bundleUrl);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
      if (cachePanel) {
        await page.getByRole("button", { name: "Toggle cache analysis" }).click();
        await expect(page.getByRole("button", { name: "Toggle cache analysis" })).toBeVisible();
      }
      await page.waitForTimeout(500);
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
      await context.close();
    });
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`hops panel lists hosts and has no axe violations: ${scheme} theme`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await open(page, bundleUrl);
    await page.getByRole("button", { name: "Toggle hops" }).click();
    const table = page.getByRole("table", { name: "Hops per host" });
    await expect(table).toBeVisible();
    expect(await table.getByRole("row").count()).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(500);
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
    await context.close();
  });
}

// Browsers block <script type="module" crossorigin> over file://, so the non-bundled report needs
// an HTTP server. The README documents this and points to --bundle for double-click use.
test("non-bundled report is blocked over file:// (documented: use --bundle or serve it)", async ({
  page,
}) => {
  const collected = collect(page);
  await page.goto(plainUrl);
  await expect.poll(() => collected.errors.length).toBeGreaterThan(0);
  await expect(page.getByText(/^Step \d+ \/ \d+$/)).toHaveCount(0);
});

test("non-bundled report served over HTTP loads its relative assets without errors", async ({
  page,
}) => {
  const root = resolve(output, "plain");
  const server = createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
      const file = resolve(root, "." + (urlPath === "/" ? "/index.html" : urlPath));
      if (!file.startsWith(root)) throw new Error("outside root");
      const body = await readFile(file);
      const type = MIME[extname(file)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const { port } = server.address() as AddressInfo;
    const collected = collect(page);
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
    await page.getByRole("button", { name: "Next →" }).click();
    expect(collected.errors).toEqual([]);
    const external = collected.requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`));
    expect(external.filter((u) => !u.startsWith("data:"))).toEqual([]);
  } finally {
    server.close();
  }
});

test("bundled report falls back to main-thread parsing when the worker chunk is missing", async ({
  page,
}) => {
  const collected = await open(page, bundleUrl);
  await page.getByRole("button", { name: "↩ Reset" }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "fixture.har", // the builder only accepts the .har extension
      mimeType: "application/json",
      buffer: await readFile(
        resolve(
          import.meta.dirname,
          "../packages/core/tests/fixtures/webperf-snippets.har.fixture.json"
        )
      ),
    });
  const generate = page.getByRole("button", { name: /Generate diagram/ });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  // Chrome logs a failed worker script load itself ("Failed to load resource" for a
  // file:// URL, plus the equivalent for blocked module workers). That native log is the
  // missing chunk the fallback handles, so only those exact messages are ignored.
  const unexpected = collected.errors.filter(
    (e) => !/Failed to load resource|Failed to construct 'Worker'/.test(e)
  );
  expect(unexpected).toEqual([]);
});

test.describe("mobile layout at 360x740", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  const tapTargetsOf = (page: Page) => [
    themeToggle(page),
    page.getByRole("button", { name: "Next →" }),
    page.getByRole("button", { name: "← Prev" }),
    page.getByRole("button", { name: "Auto play" }),
    page.getByRole("button", { name: "Toggle cache analysis" }),
    page.getByRole("button", { name: "Toggle metrics summary" }),
    page.getByRole("combobox", { name: "Playback speed" }),
    page.getByRole("tab").first(),
  ];

  test("the report does not scroll horizontally and keeps 44px tap targets", async ({ page }) => {
    const collected = await open(page, bundleUrl);
    await page.getByRole("button", { name: "Next →" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360
    );
    for (const target of tapTargetsOf(page)) {
      const box = await target.boundingBox();
      expect(box, await target.evaluate((el) => el.outerHTML.slice(0, 80))).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    // The diagram scales to the viewport instead of overflowing it.
    const svg = await page.locator("#diagram-svg").boundingBox();
    expect(svg!.width).toBeLessThanOrEqual(360);
    expect(collected.errors).toEqual([]);
  });

  test("HTML text stays at 12px or larger and the step controls wrap inside the viewport", async ({
    page,
  }) => {
    await open(page, bundleUrl);
    const result = await page.evaluate(() => {
      const small: string[] = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (el.closest("svg")) continue;
        const ownText = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
        );
        if (!ownText) continue;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width === 0 || style.visibility === "hidden") continue;
        if (parseFloat(style.fontSize) < 12) small.push(`${el.tagName} ${el.textContent?.trim()}`);
      }
      const overflowing = [...document.querySelectorAll("button, select")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > 360.5 || r.left < -0.5);
        })
        .map((el) => el.getAttribute("aria-label") ?? el.textContent);
      return { small, overflowing };
    });
    expect(result.small).toEqual([]);
    // The step track scrolls inside its own row; every other control fits the viewport.
    expect(result.overflowing.filter((label) => !/^Step \d+:/.test(label ?? ""))).toEqual([]);
  });

  test("the builder stacks without horizontal scroll after Reset", async ({ page }) => {
    await open(page, bundleUrl);
    await page.getByRole("button", { name: "↩ Reset" }).click();
    await expect(page.getByRole("heading", { name: "Build your flow" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360
    );
  });
});
