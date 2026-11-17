import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaterfallPanel } from "../src/components/WaterfallPanel.js";
import { MessagesContext } from "../src/i18n/context.js";
import { es } from "../src/i18n/es.js";
import { ca } from "../src/i18n/ca.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";

const APP = "https://example.com/app.js";
const app = makeEntry({
  url: APP,
  startTime: 50,
  resourceType: "script",
  mimeType: "application/javascript",
  initiator: { type: "parser", url: "https://example.com/", lineNumber: 3 },
});
const image = makeEntry({
  url: "https://cdn.example.com/hero.avif?w=800",
  startTime: 100,
  duration: 60,
  method: "GET",
  status: 200,
  mimeType: "image/avif",
  resourceType: "image",
  priority: "High",
  httpVersion: "h2",
  contentEncoding: "none",
  transferSize: 21_000,
  encodedBodySize: 20_000,
  bodySize: 20_000,
  timing: { blocked: 2, dns: 0, connect: 0, ssl: 0, send: 1, wait: 30, receive: 27 },
  initiator: { type: "script", url: APP, lineNumber: 41 },
  responseHeaders: { "cache-control": "public, max-age=600", age: "42", "x-cache": "HIT" },
  headers: {
    request: [
      ":authority: cdn.example.com",
      "accept: image/avif,*/*",
      "cookie: sid=[redacted]******; theme=****",
      "authorization: [redacted]",
    ],
    response: ["content-type: image/avif", "cache-control: public, max-age=600", "x-cache: HIT"],
  },
});
const old = makeEntry({
  url: "https://example.com/old.css",
  startTime: 200,
  responseHeaders: { "cache-control": "no-cache" },
});
const har = makeHar([app, image, old], { onContentLoad: 300, onLoad: 520 });

// The rows of the request list, whatever the language: the first list, its own items.
const items = () => [...document.querySelectorAll<HTMLElement>("ol:first-of-type > li")];
const rowNamed = (name: string) =>
  items().find((item) => item.querySelector("[data-name]")?.textContent?.startsWith(name))!;

function renderPanel(messages?: typeof es) {
  const panel = <WaterfallPanel har={har} pageLabel="Page 1" onClose={() => undefined} />;
  render(
    messages ? <MessagesContext.Provider value={messages}>{panel}</MessagesContext.Provider> : panel
  );
}

async function openImage() {
  const user = userEvent.setup();
  renderPanel();
  await user.click(within(rowNamed("hero.avif")).getAllByRole("button")[0]);
  return { user, detail: screen.getByRole("region", { name: "Request details" }) };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("WaterfallPanel: the detail of a request", () => {
  it("shows no detail until a request is selected, then shows it under its row", async () => {
    renderPanel();
    expect(screen.queryByRole("region", { name: "Request details" })).not.toBeInTheDocument();

    const { detail } = await openImage();
    expect(rowNamed("hero.avif")).toContainElement(detail);
    expect(within(detail).getByText("https://cdn.example.com/hero.avif?w=800")).toBeInTheDocument();
  });

  it("lists the request's facts: method, status, protocol, priority, type", async () => {
    const { detail } = await openImage();
    const fact = (term: string) =>
      within(detail).getByText(term, { selector: "dt" }).nextElementSibling?.textContent;

    expect(fact("Method")).toBe("GET");
    expect(fact("Status")).toBe("200");
    expect(fact("Protocol")).toBe("h2");
    expect(fact("Priority")).toBe("High");
    expect(fact("Type")).toBe("image · image/avif");
  });

  it("shows the initiator chain, closest first, with 1-based line numbers", async () => {
    const { detail } = await openImage();
    const chain = within(detail).getByRole("list", { name: "Initiator chain" });
    const links = within(chain)
      .getAllByRole("listitem")
      .map((li) => li.textContent);

    expect(links).toEqual([
      "script https://example.com/app.js:42",
      "parser https://example.com/:4",
    ]);
  });

  it("gives every timing phase, sizes and the cache status", async () => {
    const { detail } = await openImage();
    const timing = within(detail).getByRole("group", { name: "Timing" });
    const cell = (phase: string) =>
      within(timing).getByText(phase, { selector: "dt" }).nextElementSibling?.textContent;

    expect(cell("Blocked")).toBe("2 ms");
    expect(cell("Wait")).toBe("30 ms");
    expect(cell("Receive")).toBe("27 ms");
    const fact = (term: string) =>
      within(detail).getByText(term, { selector: "dt" }).nextElementSibling?.textContent;
    expect(fact("Transfer")).toBe("21 KB");
    expect(fact("Compressed body")).toBe("20 KB");
    expect(fact("Uncompressed body")).toBe("20 KB");
    expect(fact("CDN cache")).toBe("hit");
    expect(fact("Cache-Control")).toBe("public, max-age=600");
    expect(fact("Age")).toBe("42 s");
  });

  it("lists the request and response headers in order, marking the masked values", async () => {
    const { detail } = await openImage();
    const request = within(detail).getByRole("group", { name: "Request headers (4)" });
    const names = [...request.querySelectorAll("dt")].map((dt) => dt.textContent);

    expect(names).toEqual([":authority", "accept", "cookie", "authorization"]);
    const value = (name: string) =>
      within(request).getByText(name, { selector: "dt" }).nextElementSibling as HTMLElement;
    expect(value("cookie")).toHaveTextContent("sid=[redacted]******; theme=****");
    expect(within(value("cookie")).getByText("masked")).toBeInTheDocument();
    expect(within(value("accept")).queryByText("masked")).not.toBeInTheDocument();
    expect(within(detail).getByRole("group", { name: "Response headers (3)" })).toBeInTheDocument();
  });

  it("copies a header list as lines and says so", async () => {
    const { user, detail } = await openImage();
    // After userEvent.setup, which installs a clipboard of its own.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await user.click(within(detail).getByRole("button", { name: "Copy request headers" }));

    expect(writeText).toHaveBeenCalledWith(
      ":authority: cdn.example.com\naccept: image/avif,*/*\ncookie: sid=[redacted]******; theme=****\nauthorization: [redacted]"
    );
    expect(screen.getByText("Request headers copied")).toBeInTheDocument();

    await user.click(within(detail).getByRole("button", { name: "Copy response headers" }));
    expect(screen.getByText("Response headers copied")).toBeInTheDocument();
  });

  it("keeps the URL and cURL copy actions before the detail", async () => {
    const { detail } = await openImage();
    const buttons = within(rowNamed("hero.avif"))
      .getAllByRole("button")
      .map((b) => b.textContent);

    expect(buttons.slice(1, 3)).toEqual(["Copy URL", "Copy cURL"]);
    expect(detail).toBeInTheDocument();
  });

  it("says that a report without header lists keeps only some response headers", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(within(rowNamed("old.css")).getAllByRole("button")[0]);
    const detail = screen.getByRole("region", { name: "Request details" });

    expect(within(detail).getByText(/allow-list of response headers/)).toBeInTheDocument();
    const kept = within(detail).getByRole("group", { name: "Response headers (1)" });
    expect(within(kept).getByText("cache-control", { selector: "dt" })).toBeInTheDocument();
    const request = within(detail).getByRole("group", { name: "Request headers" });
    expect(within(request).getByText("Not recorded")).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Copy request headers" })).toBeNull();
  });

  it("shows the detail in the table view too", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: /hero\.avif/ }));

    const detail = screen.getByRole("region", { name: "Request details" });
    expect(detail.closest("td")).toHaveAttribute("colspan", "10");
    expect(within(detail).getByRole("group", { name: "Request headers (4)" })).toBeInTheDocument();
    // Lists only: the rows of the requests table stay its own.
    expect(within(detail).queryByRole("table")).toBeNull();
  });

  it.each([
    ["Spanish", es, "Detalles de la petición", "oculto"],
    ["Catalan", ca, "Detalls de la petició", "ocult"],
  ] as const)("speaks %s", async (_name, messages, heading, masked) => {
    const user = userEvent.setup();
    renderPanel(messages);
    await user.click(within(rowNamed("hero.avif")).getAllByRole("button")[0]);

    const detail = screen.getByRole("region", { name: heading });
    expect(within(detail).getAllByText(masked).length).toBeGreaterThan(0);
  });
});
