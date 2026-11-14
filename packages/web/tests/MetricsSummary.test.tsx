import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { generateFlow, parseHarJson } from "@htv/core";
import type { Flow } from "@htv/core";
import { DiagramView } from "../src/components/DiagramView.js";
import { MetricsSummary } from "../src/components/MetricsSummary.js";
import { harJson, makeFlow } from "./fixtures.js";
import { makeHar } from "../../core/tests/helpers/synthetic-har";

const noop = () => undefined;

function twoPageFlow(lcp?: number, vitals: { cls?: number; inp?: number } = {}): Flow {
  const base = makeFlow();
  const page = base.pages[0];
  const withTrace = {
    ...page,
    name: "Home",
    trace: page.trace && lcp !== undefined ? { ...page.trace, lcp, ...vitals } : page.trace,
  };
  const noTrace = { name: "Plain", har: parseHarJson(harJson) };
  return generateFlow([withTrace, noTrace]);
}

const cell = (row: string, column: number) => {
  const tr = screen.getByRole("rowheader", { name: row }).closest("tr")!;
  return within(tr).getAllByRole("cell")[column];
};

describe("MetricsSummary", () => {
  it("renders one column per page with the expected rows", () => {
    render(<MetricsSummary flow={twoPageFlow()} onClose={noop} />);
    expect(screen.getByRole("table", { name: "Metrics per page" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Page 1 · Home" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Page 2 · Plain" })).toBeInTheDocument();
    for (const row of [
      "TTFB (from navigation)",
      "Server wait",
      "FCP",
      "LCP",
      "DCL",
      "onLoad",
      "Requests",
      "Browser cache hits",
      "Transfer",
    ]) {
      expect(screen.getByRole("rowheader", { name: row })).toBeInTheDocument();
    }
    expect(screen.getByRole("rowheader", { name: "CDN hit ratio" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Browser cache hit ratio" })).toBeInTheDocument();
  });

  it("rates the TBT of a profiled trace and lists the scripts that took the main thread", () => {
    const base = makeFlow();
    const page = base.pages[0];
    const trace = {
      ...page.trace!,
      mainThread: {
        busyMs: 400,
        byCategory: { scripting: 300, rendering: 60, painting: 20, parsing: 10, gc: 5, other: 5 },
        scripts: [
          { url: "https://www.googletagmanager.com/gtm.js", ms: 220, blockingMs: 150, tasks: 2 },
          { url: "https://webperf-snippets.nucliweb.net/app.js", ms: 80, blockingMs: 10, tasks: 1 },
        ],
        longTasks: [
          {
            startMs: 300,
            durationMs: 250,
            blockingMs: 200,
            url: "https://www.googletagmanager.com/gtm.js",
            category: "scripting" as const,
          },
        ],
        tbtMs: 350,
        tbtFromMs: 181,
        tbtToMs: 2000,
        tbtEndedBy: "recording" as const,
        extensionMs: 0,
      },
    };
    render(
      <MetricsSummary flow={generateFlow([{ ...page, name: "Home", trace }])} onClose={noop} />
    );

    expect(cell("TBT", 0)).toHaveTextContent("350 ms");
    expect(cell("TBT", 0).dataset.rating).toBe("needs-improvement");
    expect(
      screen.getByRole("heading", { name: "Main thread · Page 1 · Home" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Busy 400 ms: scripting 300 ms · rendering 60 ms · painting 20 ms · parsing 10 ms · gc 5 ms · other 5 ms. TBT 350 ms from FCP to the end of the recording, 1 long task."
      )
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Main-thread scripts · Page 1 · Home" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("gtm.js");
    expect(rows[0]).toHaveTextContent("Third party");
    expect(rows[0]).toHaveTextContent("Google Tag Manager");
    expect(rows[0]).toHaveTextContent("220 ms");
    expect(rows[0]).toHaveTextContent("150 ms");
    expect(rows[1]).toHaveTextContent("First party");
  });

  it("shows TBT as n/a and no main-thread section for a page without a profiled trace", () => {
    render(<MetricsSummary flow={twoPageFlow()} onClose={noop} />);
    // The fixture trace of page 1 profiles the main thread; page 2 has no trace.
    expect(cell("TBT", 0)).toHaveTextContent("0 ms");
    expect(cell("TBT", 1)).toHaveTextContent("n/a");
    expect(
      screen.getByRole("heading", { name: "Main thread · Page 1 · Home" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Page 2/ })).not.toBeInTheDocument();
  });

  it("shows the TTFB from the navigation start, rated, and the server wait apart, unrated", () => {
    const har = makeHar([]);
    // A redirect before the document: dns 10 + connect 20 + send 1 + wait 50 after 120 ms.
    har.documentEntry.startTime = 120;
    render(<MetricsSummary flow={generateFlow([{ name: "Home", har }])} onClose={noop} />);

    expect(cell("TTFB (from navigation)", 0)).toHaveTextContent("201 ms");
    expect(cell("TTFB (from navigation)", 0).dataset.rating).toBe("good");
    expect(cell("Server wait", 0)).toHaveTextContent("50 ms");
    expect(cell("Server wait", 0).dataset.rating).toBe("none");
  });

  it("shows n/a for a page without a trace", () => {
    render(<MetricsSummary flow={twoPageFlow()} onClose={noop} />);
    expect(cell("FCP", 0)).not.toHaveTextContent("n/a");
    expect(cell("FCP", 1)).toHaveTextContent("n/a");
    expect(cell("LCP", 1)).toHaveTextContent("n/a");
    expect(cell("LCP", 1).dataset.rating).toBe("none");
  });

  it("applies the poor rating class to a slow LCP", () => {
    render(<MetricsSummary flow={twoPageFlow(5000)} onClose={noop} />);
    expect(cell("LCP", 0).dataset.rating).toBe("poor");
    expect(cell("LCP", 0).className).toMatch(/poor/);
    expect(cell("LCP", 0)).toHaveTextContent("5.0 s");
  });

  it("renders CLS with three decimals and INP as a duration, both rated", () => {
    render(<MetricsSummary flow={twoPageFlow(1000, { cls: 0.17, inp: 250 })} onClose={noop} />);
    expect(cell("CLS", 0)).toHaveTextContent("0.170");
    expect(cell("CLS", 0).dataset.rating).toBe("needs-improvement");
    expect(cell("INP", 0)).toHaveTextContent("250 ms");
    expect(cell("INP", 0).dataset.rating).toBe("needs-improvement");
    expect(cell("CLS", 1)).toHaveTextContent("n/a");
    expect(cell("INP", 1).dataset.rating).toBe("none");
  });

  it("rates poor CLS and INP", () => {
    render(<MetricsSummary flow={twoPageFlow(1000, { cls: 0.3, inp: 600 })} onClose={noop} />);
    expect(cell("CLS", 0).dataset.rating).toBe("poor");
    expect(cell("INP", 0).dataset.rating).toBe("poor");
  });

  it("calls onClose from the close button", async () => {
    let closed = false;
    render(<MetricsSummary flow={twoPageFlow()} onClose={() => (closed = true)} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /close metrics/i }));
    expect(closed).toBe(true);
  });
});

describe("DiagramView metrics toggle", () => {
  it("shows the panel when Metrics is clicked and hides it on close", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={twoPageFlow()} />);
    expect(screen.queryByRole("table", { name: "Metrics per page" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /toggle metrics summary/i }));
    expect(await screen.findByRole("table", { name: "Metrics per page" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close metrics summary/i }));
    expect(screen.queryByRole("table", { name: "Metrics per page" })).not.toBeInTheDocument();
  });
});
