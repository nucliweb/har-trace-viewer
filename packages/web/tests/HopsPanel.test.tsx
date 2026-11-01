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
    // HAR counts TLS inside connect: TCP alone is 454 − 200 ms.
    expect(rows[0]).toHaveTextContent("663 ms / 254 ms / 200 ms");
    expect(rows[1]).toHaveTextContent("reused");
  });

  it("counts browser-cache hits apart, leaving them out of requests and TTFB", () => {
    const cached: ParsedHar = {
      ...har,
      entries: [
        doc,
        entry("https://static.example.com/a.js", { ttfb: 80 }),
        entry("https://static.example.com/b.js", { ttfb: 1, fromCache: "disk" }),
        entry("https://fonts.example.net/f.woff2", { ttfb: 0, fromCache: "memory" }),
      ],
    };
    render(<HopsPanel hops={analyzeHops(cached, doc.url)} pageLabel="Page 1" onClose={noop} />);
    const table = screen.getByRole("table", { name: "Hops per host" });
    const columns = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    const cell = (host: string, column: string) =>
      within(within(table).getByRole("row", { name: new RegExp(`^${host}`) })).getAllByRole("cell")[
        columns.indexOf(column) - 1
      ].textContent;

    expect(columns).toContain("Cached");
    expect(cell("static\\.example\\.com", "Requests")).toBe("1");
    expect(cell("static\\.example\\.com", "Cached")).toBe("1");
    expect(cell("static\\.example\\.com", "Median TTFB")).toBe("80 ms");
    expect(cell("fonts\\.example\\.net", "Requests")).toBe("0");
    expect(cell("fonts\\.example\\.net", "Median TTFB")).toBe("n/a");
  });

  it("shows the median TTFB before and after onLoad, leaving beacons aside", () => {
    const later: ParsedHar = {
      ...har,
      entries: [
        doc,
        entry("https://static.example.com/a.js", { ttfb: 20, startTime: 50 }),
        entry("https://static.example.com/b.js", { ttfb: 40, startTime: 60 }),
        entry("https://static.example.com/c.js", { ttfb: 900, startTime: 70, method: "POST" }),
        entry("https://static.example.com/lazy.js", { ttfb: 300, startTime: 900 }),
      ],
    };
    render(<HopsPanel hops={analyzeHops(later, doc.url)} pageLabel="Page 1" onClose={noop} />);
    const table = screen.getByRole("table", { name: "Hops per host" });
    const columns = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    const row = within(table).getByRole("row", { name: /^static\.example\.com/ });
    const cell = (column: string) =>
      within(row).getAllByRole("cell")[columns.indexOf(column) - 1].textContent;

    expect(cell("Median TTFB")).toBe("30 ms");
    expect(cell("After onLoad")).toBe("300 ms");
  });

  it("shows a connection phase that did not happen as n/a", () => {
    const plain = entry("http://plain.example.org/a.js", {
      timing: {
        dns: 5,
        connect: 15,
        ssl: 0,
        send: 0,
        wait: 50,
        receive: 0,
        blocked: 0,
        notApplicable: ["ssl"],
      },
    });
    render(
      <HopsPanel
        hops={analyzeHops({ ...har, entries: [doc, plain] }, doc.url)}
        pageLabel="Page 1"
        onClose={noop}
      />
    );
    const table = screen.getByRole("table", { name: "Hops per host" });

    expect(within(table).getByRole("row", { name: /^plain\.example\.org/ })).toHaveTextContent(
      "5 ms / 15 ms / n/a"
    );
  });

  it("shows the protocol and the connections of each host", () => {
    const transport: ParsedHar = {
      ...har,
      entries: [
        { ...doc, httpVersion: "h2", connectionId: "1" },
        entry("https://static.example.com/a.js", { httpVersion: "h3", connectionId: "2" }),
        entry("https://static.example.com/b.js", { httpVersion: "h3", connectionId: "3" }),
        entry("https://cdn.thirdparty.net/lib.js", { httpVersion: "h1", connectionId: "4" }),
        entry("https://old.example.org/a.js"),
      ],
    };
    render(<HopsPanel hops={analyzeHops(transport, doc.url)} pageLabel="Page 1" onClose={noop} />);
    const table = screen.getByRole("table", { name: "Hops per host" });
    const columns = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    const cell = (host: string) =>
      within(within(table).getByRole("row", { name: new RegExp(`^${host}`) })).getAllByRole("cell")[
        columns.indexOf("Protocol") - 1
      ].textContent;

    expect(cell("www\\.example\\.com")).toBe("h2 · 1 conn");
    expect(cell("static\\.example\\.com")).toBe("h3 · 2 conns");
    expect(cell("cdn\\.thirdparty\\.net")).toBe("h1 · 1 conn");
    expect(cell("old\\.example\\.org")).toBe("n/a");
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
