import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, join, resolve } from "node:path";

// The public site's build, as in web.spec.ts: generation runs in the parse worker.
const root = resolve(import.meta.dirname, "../packages/web/dist-site");

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
      let file = resolve(root, "." + urlPath);
      if (!file.startsWith(root)) throw new Error("outside root");
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res
        .writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/har-trace-viewer/`;
});

test.afterAll(() => {
  server.close();
});

const TYPES = [
  ["application/javascript", "js"],
  ["text/css", "css"],
  ["image/png", "png"],
  ["application/json", "json"],
] as const;

// A synthetic recording: the document's DNS and connect are as slow as behind the Great Firewall,
// so the flow suggests the China region and offers to switch.
function syntheticHar(entryCount: number): Buffer {
  const start = Date.UTC(2026, 0, 1);
  const entry = (
    url: string,
    mimeType: string,
    offset: number,
    timings: Record<string, number>
  ) => ({
    startedDateTime: new Date(start + offset).toISOString(),
    time: 120,
    request: { url, method: "GET" },
    response: {
      status: 200,
      headers: [{ name: "Content-Type", value: mimeType }],
      content: { mimeType, size: 4000 },
      bodySize: 4000,
      headersSize: 200,
    },
    timings: { blocked: 1, dns: 5, connect: 10, ssl: 0, send: 1, wait: 80, receive: 9, ...timings },
  });
  const entries = [
    entry("https://www.example.com/", "text/html", 0, { dns: 350, connect: 620, wait: 300 }),
  ];
  for (let i = 1; i < entryCount; i++) {
    const [mimeType, extension] = TYPES[i % TYPES.length];
    entries.push(
      entry(`https://cdn${i % 60}.example.net/a/${i}.${extension}`, mimeType, 400 + i, {})
    );
  }
  return Buffer.from(JSON.stringify({ log: { entries } }));
}

// Counts what the parse worker is sent and what it answers, and can corrupt the next flow request
// so the analysis throws inside the worker.
async function watchWorker(page: Page) {
  await page.addInitScript(() => {
    const state = ((window as unknown as { __htv: object }).__htv = {
      breakFlow: false,
      flowsSent: 0,
      flowsDone: 0,
      flowsFailed: 0,
    });
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: { kind?: string }) {
      if (message.kind === "flow") {
        state.flowsSent += 1;
        if (state.breakFlow) message = { ...message, pages: null } as typeof message;
      }
      return send.call(this, message);
    };
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (event: MessageEvent) => {
          if (event.data.ok === true && event.data.result?.steps) state.flowsDone += 1;
          if (event.data.ok === false) state.flowsFailed += 1;
        });
      }
    };
  });
  const counters = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __htv: { flowsSent: number; flowsDone: number; flowsFailed: number };
          }
        ).__htv
    );
  const breakFlow = (on: boolean) =>
    page.evaluate((value) => {
      (window as unknown as { __htv: { breakFlow: boolean } }).__htv.breakFlow = value;
    }, on);
  return { counters, breakFlow };
}

async function loadHar(page: Page, buffer: Buffer) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "site.har", mimeType: "application/json", buffer });
}

const generateButton = (page: Page) => page.getByRole("button", { name: /Generat(e diagram|ing)/ });
// The app's own live region is the last one: the diagram has one for its steps.
const announcer = (page: Page) => page.locator('[aria-live="polite"]').last();
const failure = (page: Page) =>
  page.getByRole("alert").filter({ hasText: /Could not generate the diagram/ });

test("a generation that throws in the worker is reported, and the next one clears the report", async ({
  page,
}) => {
  const worker = await watchWorker(page);
  await page.goto(baseUrl);
  await loadHar(page, syntheticHar(40));
  await expect(generateButton(page)).toBeEnabled();

  await worker.breakFlow(true);
  await generateButton(page).click();

  const alert = failure(page);
  await expect(alert).toBeVisible();
  await expect(page.getByText("Build your flow")).toBeVisible();
  await expect(generateButton(page)).toHaveText("Generate diagram →");
  await expect(generateButton(page)).toBeEnabled();
  await expect(generateButton(page)).not.toHaveAttribute("aria-disabled", "true");
  await expect(announcer(page)).toHaveText("");
  expect((await worker.counters()).flowsFailed).toBe(1);

  await worker.breakFlow(false);
  await generateButton(page).click();

  await expect(page.locator("#diagram-svg")).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test("a region switch that throws keeps the open diagram and reports above it", async ({
  page,
}) => {
  const worker = await watchWorker(page);
  await page.goto(baseUrl);
  await loadHar(page, syntheticHar(40));
  await generateButton(page).click();
  await expect(page.locator("#diagram-svg")).toBeVisible();
  const steps = await page.getByText(/^Step 1 \/ \d+$/).textContent();
  const notice = page.getByRole("status").filter({ hasText: "Great Firewall" });
  await expect(notice.getByRole("button", { name: "Show default topology" })).toBeVisible();

  await worker.breakFlow(true);
  await notice.getByRole("button", { name: "Show default topology" }).click();

  const alert = failure(page);
  await expect(alert).toBeVisible();
  const [alertBox, diagramBox] = await Promise.all([
    alert.boundingBox(),
    page.locator("#diagram-svg").boundingBox(),
  ]);
  expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(diagramBox!.y + 1);
  await expect(page.getByText(steps!, { exact: true })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Show default topology" })).toBeVisible();

  await worker.breakFlow(false);
  await notice.getByRole("button", { name: "Show default topology" }).click();
  await expect(notice.getByRole("button", { name: "Show GFW topology" })).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test.describe("a generation that takes a while", () => {
  // Generous but bounded: ten thousand requests through the analysis in the worker.
  test.setTimeout(120_000);
  const large = syntheticHar(10_000);

  async function startGeneration(page: Page) {
    await page.goto(baseUrl);
    await loadHar(page, large);
    await expect(generateButton(page)).toBeEnabled({ timeout: 60_000 });
    await generateButton(page).click();
  }

  const settled = (page: Page, count: number, worker: Awaited<ReturnType<typeof watchWorker>>) =>
    expect
      .poll(async () => (await worker.counters()).flowsDone, { timeout: 90_000 })
      .toBeGreaterThanOrEqual(count);

  test("announces it and refuses a second run while one is running", async ({ page }) => {
    const worker = await watchWorker(page);
    await startGeneration(page);

    await expect(announcer(page)).toHaveText("Generating…");
    await expect(generateButton(page)).toHaveText("Generating…");
    await expect(generateButton(page)).toHaveAttribute("aria-disabled", "true");
    // aria-disabled keeps the button focusable and clickable: forced, it must start nothing.
    await generateButton(page).click({ force: true });
    await generateButton(page).click({ force: true });

    await expect(page.locator("#diagram-svg")).toBeVisible({ timeout: 90_000 });
    await expect(announcer(page)).toHaveText("");
    const { flowsSent, flowsDone } = await worker.counters();
    expect([flowsSent, flowsDone]).toEqual([1, 1]);
  });

  test("a result that arrives after the demo was loaded does not replace it", async ({ page }) => {
    const worker = await watchWorker(page);
    await startGeneration(page);
    await expect(announcer(page)).toHaveText("Generating…");

    await page.getByRole("button", { name: "Load demo flow →" }).click();
    await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
    const demoSteps = await page.getByText(/^Step 1 \/ \d+$/).textContent();
    await expect(announcer(page)).toHaveText("");

    // The worker's answer arrives now; it must not take the screen.
    await settled(page, 1, worker);
    await expect(page.getByText(demoSteps!, { exact: true })).toBeVisible();
    await expect(page.getByText("Build your flow")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Great Firewall" })).toHaveCount(0);
    await expect(announcer(page)).toHaveText("");
  });

  test("Reset during a region switch leaves the start screen, and the late result stays away", async ({
    page,
  }) => {
    const worker = await watchWorker(page);
    await startGeneration(page);
    await expect(page.locator("#diagram-svg")).toBeVisible({ timeout: 90_000 });
    const notice = page.getByRole("status").filter({ hasText: "Great Firewall" });

    await notice.getByRole("button", { name: "Show default topology" }).click();
    await expect(notice.getByRole("button", { name: "Generating…" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await page.getByRole("button", { name: /Reset/ }).first().click();
    await expect(page.getByText("Build your flow")).toBeVisible();

    await settled(page, 2, worker);
    await expect(page.getByText("Build your flow")).toBeVisible();
    await expect(page.locator("#diagram-svg")).toHaveCount(0);
    await expect(announcer(page)).toHaveText("");
  });

  test("the region switch regenerates the diagram", async ({ page }) => {
    const worker = await watchWorker(page);
    await startGeneration(page);
    await expect(page.locator("#diagram-svg")).toBeVisible({ timeout: 90_000 });
    const notice = page.getByRole("status").filter({ hasText: "Great Firewall" });
    await expect(notice).toContainText("so the diagram draws it");

    await notice.getByRole("button", { name: "Show default topology" }).click();

    await expect(notice.getByRole("button", { name: "Show GFW topology" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(notice).toContainText("keeps the default topology");
    await expect(page.locator("#diagram-svg")).toBeVisible();
    expect((await worker.counters()).flowsDone).toBe(2);
  });
});

test("switching to Spanish on the site loads the locale and words the export menu in it", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (req) => requested.push(req.url()));
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "Load demo flow →" }).click();
  await expect(page.getByText(/^Step 1 \/ \d+$/)).toBeVisible();
  expect(requested.some((url) => /\/es-[\w-]+\.js$/.test(url))).toBe(false);

  await page.keyboard.press("l");

  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  expect(requested.some((url) => /\/es-[\w-]+\.js$/.test(url))).toBe(true);
  await page.getByRole("button", { name: "Exportar" }).click();
  await expect(page.getByRole("menu", { name: "Exportar el informe" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Descargar CSV" })).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Secretos", exact: true }).click();
  await page.getByRole("menuitem", { name: "Descargar CSV" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ocultado:" })).toBeVisible();
});
