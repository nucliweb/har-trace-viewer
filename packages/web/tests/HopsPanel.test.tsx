import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { analyzeHops, generateFlow } from "@htv/core";
import type { Flow, HarEntry, ParsedHar } from "@htv/core";
import { DiagramView } from "../src/components/DiagramView.js";
import { HopsPanel } from "../src/components/HopsPanel.js";

function entry(url: string, over: Partial<HarEntry> = {}): HarEntry {
  return {
    url,
    startTime: 0,
    duration: 100,
    timing: { dns: 0, connect: 0, ssl: 0, send: 0, wait: 50, receive: 0, blocked: 0 },
    ttfb: 50,
    status: 200,
    mimeType: "text/html",
    resourceType: "document",
    responseHeaders: {},
    transferSize: 2000,
    bodySize: 2000,
    isDocument: false,
    fromCache: false,
    ...over,
  };
}

const doc = entry("https://www.example.com/", {
  isDocument: true,
  responseHeaders: { "x-akamai-transformed": "9 - 0 pmb=mRUM,1" },
  timing: { dns: 663, connect: 454, ssl: 200, send: 0, wait: 50, receive: 0, blocked: 0 },
});
const har: ParsedHar = {
  pages: [{ id: "p1", title: "Home", onContentLoad: 100, onLoad: 200 }],
  documentEntry: doc,
  preconnectHints: {},
  entries: [
    doc,
    entry("https://static.example.com/a.js", { resourceType: "script" }),
    entry("https://cdn.thirdparty.net/lib.js", {
      resourceType: "script",
      responseHeaders: { "cf-ray": "abc-LAX", "cf-cache-status": "HIT" },
    }),
    entry("https://cdn.thirdparty.net/lib2.js", {
      resourceType: "script",
      responseHeaders: { "cf-ray": "abc-LAX", "cf-cache-status": "MISS" },
    }),
  ],
};
const flow: Flow = generateFlow([{ name: "Home", har }]);

const noop = () => undefined;
const panel = () =>
  render(<HopsPanel hops={analyzeHops(har, doc.url)} pageLabel="Page 1 · Home" onClose={noop} />);

describe("HopsPanel", () => {
  it("renders one row per host, first party first", () => {
    panel();
    const table = screen.getByRole("table", { name: "Hops per host" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("www.example.com");
    expect(rows[1]).toHaveTextContent("static.example.com");
    expect(rows[2]).toHaveTextContent("cdn.thirdparty.net");
    expect(rows[2]).toHaveTextContent("Cloudflare");
    expect(rows[2]).toHaveTextContent("Los Angeles · United States");
    expect(rows[2]).toHaveTextContent("50%");
    expect(rows[0]).toHaveTextContent("Akamai Edge");
    expect(rows[0]).toHaveTextContent("n/a");
    expect(rows[0]).toHaveTextContent("663 ms / 454 ms / 200 ms");
    expect(rows[1]).toHaveTextContent("reused");
  });

  it("shows the page label and the summary line", () => {
    panel();
    expect(screen.getByRole("heading", { name: "Page 1 · Home" })).toBeInTheDocument();
    expect(screen.getByText("3 hosts · 3 providers · 1 region")).toBeInTheDocument();
  });
});

describe("Hops toggle in DiagramView", () => {
  it("opens from the toolbar and is exclusive with Metrics and Cache", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    expect(screen.queryByRole("table", { name: "Hops per host" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle hops" }));
    expect(screen.getByRole("table", { name: "Hops per host" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle metrics summary" }));
    expect(screen.queryByRole("table", { name: "Hops per host" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle hops" }));
    await user.click(screen.getByRole("button", { name: "Toggle cache analysis" }));
    expect(screen.queryByRole("table", { name: "Hops per host" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle hops" }));
    await user.click(screen.getByRole("button", { name: "Close hops" }));
    expect(screen.queryByRole("table", { name: "Hops per host" })).not.toBeInTheDocument();
  });
});
