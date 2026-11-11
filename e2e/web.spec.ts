import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Serves the built web app (packages/web/dist), as Vercel does, to test the public entry page.
const root = resolve(import.meta.dirname, "../packages/web/dist");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

let server: ReturnType<typeof createServer>;
let baseUrl = "";

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
      const file = resolve(root, "." + (urlPath === "/" ? "/index.html" : urlPath));
      if (!file.startsWith(root)) throw new Error("outside root");
      const body = await readFile(file);
      res
        .writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

test.afterAll(() => {
  server.close();
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("head carries the description, social card, theme color and icon", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page).toHaveTitle("HTV · HAR Trace Viewer");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const meta = (selector: string) => page.locator(`head ${selector}`).getAttribute("content");
  expect(await meta('meta[name="description"]')).toMatch(/HAR/);
  expect(await meta('meta[property="og:title"]')).toBe("HTV · HAR Trace Viewer");
  expect(await meta('meta[property="og:image"]')).toMatch(/^\.?\/og\.png$/);
  expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
  await expect(page.locator('head meta[name="theme-color"]')).toHaveCount(2);
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute("href", /^data:image\/svg/);

  const og = await page.request.get(new URL("og.png", baseUrl).href);
  expect(og.ok()).toBe(true);
  expect((await og.body()).length).toBeLessThan(150 * 1024);
});

test("the empty state explains where the files come from", async ({ page }) => {
  await page.goto(baseUrl);
  const guide = page.getByRole("region", { name: /where do the files come from/i });
  await expect(guide.getByText(/preserve log/i)).toBeVisible();
  await expect(guide.getByText(/save profile/i)).toBeVisible();
});

test("one click on the demo button shows the diagram", async ({ page }) => {
  const errors = collectErrors(page);
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));
  await page.goto(baseUrl);
  // The demo flow is a separate chunk, downloaded only on demand.
  expect(requested.some((url) => /demo-flow/.test(url))).toBe(false);

  await page.getByRole("button", { name: "Load demo flow →" }).click();
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  expect(requested.some((url) => /demo-flow/.test(url))).toBe(true);
  await expect(page.locator("#diagram-svg")).toBeVisible();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText(/^Step 2 \/ \d+$/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("dropping a JSON file that is not a HAR shows why it cannot be read", async ({ page }) => {
  const errors = collectErrors(page);
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));
  await page.goto(baseUrl);

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['{"hello":"world"}'], "notes.har", { type: "application/json" }));
    return transfer;
  });
  const row = page.getByLabel("Page 1 name").locator("xpath=..");
  await row.dispatchEvent("drop", { dataTransfer });

  await expect(
    page.getByText(
      "This JSON is neither a HAR (log.entries) nor a Chrome trace (traceEvents or an event array)."
    )
  ).toBeVisible();
  // The message came back from the parse worker.
  expect(requested.some((url) => /parse\.worker/.test(url))).toBe(true);
  await expect(page.getByRole("button", { name: /Generate diagram/ })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("a gzipped HAR loads like a plain one", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(baseUrl);
  const har = await readFile(
    resolve(
      import.meta.dirname,
      "../packages/core/tests/fixtures/webperf-snippets.har.fixture.json"
    )
  );

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "site.har.gz", mimeType: "application/gzip", buffer: gzipSync(har) });

  await expect(page.getByText("site.har.gz")).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate diagram/ })).toBeEnabled();
  expect(errors).toEqual([]);
});

test.describe("mobile 360x740", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test("the empty state and the demo diagram fit the viewport", async ({ page }) => {
    await page.goto(baseUrl);
    const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect(await scrollWidth()).toBeLessThanOrEqual(360);

    const demo = page.getByRole("button", { name: "Load demo flow →" });
    const box = await demo.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await demo.click();
    await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
    expect(await scrollWidth()).toBeLessThanOrEqual(360);
    const svg = await page.locator("#diagram-svg").boundingBox();
    expect(svg!.width).toBeLessThanOrEqual(360);
  });
});

test("the keyboard opens the shortcuts and the settings as accessible modal dialogs", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "Load demo flow →" }).click();
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();

  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  // The dialog holds the focus and the step keys leave it alone.
  await expect(help.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include("dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  await page.keyboard.press("c");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("t");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("the shortcuts still answer after a checkbox is ticked, which keeps Space", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto(baseUrl);
  await page.keyboard.press("c");
  const journeys = page.getByRole("checkbox", { name: "Multi-page journeys" });
  await journeys.click();
  await expect(journeys).toBeFocused();

  await page.keyboard.press("t");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press(" ");
  await expect(journeys).not.toBeChecked();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the page order arrows of a journey are at least 24px each way", async ({ page }) => {
  await page.goto(baseUrl);
  await page.keyboard.press("c");
  await page.getByRole("checkbox", { name: "Multi-page journeys" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "+ Add page" }).click();

  const arrows = page.getByRole("button", { name: /^Move page (up|down)$/ });
  expect(await arrows.count()).toBe(4);
  for (const arrow of await arrows.all()) {
    const box = (await arrow.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});

test("l switches the interface language, kept across reloads", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(baseUrl);
  await expect(page.getByRole("heading", { name: "Build your flow" })).toBeVisible();

  await page.keyboard.press("l");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { name: "Construye tu flujo" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Construye tu flujo" })).toBeVisible();

  await page.getByRole("button", { name: "Cargar el flujo de demostración →" }).click();
  await expect(page.getByText(/^Paso 1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press("c");
  const settings = page.getByRole("dialog", { name: "Configuración" });
  await settings.getByRole("radio", { name: "Català" }).check();
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(page.getByRole("dialog", { name: "Configuració" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByText(/^Pas 1 \/ \d+$/)).toBeVisible();
  expect(errors).toEqual([]);
});

// The contrast of a form field's border against what surrounds it (WCAG 1.4.11 asks 3:1).
function fieldBorderContrasts(page: Page): Promise<{ field: string; ratio: number }[]> {
  return page.evaluate(() => {
    const rgb = (c: string) => {
      const canvas = document.createElement("canvas").getContext("2d")!;
      canvas.fillStyle = c;
      canvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const background = (el: Element | null) => {
      for (let n = el; n; n = n.parentElement) {
        const c = rgb(getComputedStyle(n).backgroundColor);
        if (c.a === 1) return c;
      }
      return rgb("white");
    };
    return [...document.querySelectorAll("input[type=text], input[type=search], select")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const [x, y] = [
          lum(rgb(getComputedStyle(el).borderTopColor)),
          lum(background(el.parentElement)),
        ].sort((p, q) => q - p);
        const label = el.getAttribute("aria-label") ?? el.id ?? el.tagName;
        return {
          field: `${el.tagName.toLowerCase()} ${label}`,
          ratio: Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100,
        };
      });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`form fields stand out at 3:1 and show the focus: ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(baseUrl);
    const fields = [...(await fieldBorderContrasts(page))];
    await page.getByRole("button", { name: "Load demo flow →" }).click();
    await page.getByRole("button", { name: "Toggle waterfall" }).click();
    fields.push(...(await fieldBorderContrasts(page)));

    expect(fields.length).toBeGreaterThanOrEqual(5);
    expect(fields.filter((f) => f.ratio < 3)).toEqual([]);

    await page.getByRole("button", { name: "↩ Reset" }).click();
    await page.getByLabel("Page 1 name").focus();
    await page.keyboard.press("End");
    const outline = await page
      .getByLabel("Page 1 name")
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });
}

// What an element looks like on screen: the share of near-white pixels (the forced Canvas) and
// of saturated ones (a color the forced palette would have flattened). Computed styles keep the
// author's colors under forced colors, so only the pixels tell.
async function pixels(page: Page, locator: ReturnType<Page["locator"]>) {
  const png = (await locator.screenshot()).toString("base64");
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [img.width, img.height];
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let white = 0;
    let saturated = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 235 && g > 235 && b > 235) white++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 60) saturated++;
    }
    const total = data.length / 4;
    return { white: white / total, saturated: saturated / total };
  }, png);
}

test("forced colors keep the waterfall bars and the selected states", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", colorScheme: "light" });
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "Load demo flow →" }).click();
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  // Selected reads as filled: far less of the forced Canvas than its unselected sibling.
  const selectedStandsOut = async (
    selected: ReturnType<Page["locator"]>,
    other: ReturnType<Page["locator"]>
  ) => {
    const [a, b] = [await pixels(page, selected), await pixels(page, other)];
    expect(b.white - a.white).toBeGreaterThan(0.3);
  };

  const dots = page.getByRole("tab");
  await selectedStandsOut(dots.nth(0), dots.nth(1));
  await page.getByRole("button", { name: "Toggle waterfall" }).click();
  await selectedStandsOut(
    page.getByRole("button", { name: "Toggle waterfall" }),
    page.getByRole("button", { name: "Toggle hops" })
  );
  const chips = page.getByRole("group", { name: "Resource types" }).getByRole("button");
  await chips.nth(0).click();
  await selectedStandsOut(chips.nth(0), chips.nth(1));
  const views = page.getByRole("group", { name: "View" }).getByRole("button");
  await selectedStandsOut(views.nth(0), views.nth(1));

  // The bars keep their phase colors: zoomed on the page load, they fill part of the list.
  await page.getByLabel("Axis").selectOption("load");
  const bars = await pixels(page, page.locator("ol"));
  expect(bars.saturated).toBeGreaterThan(0.01);
});
