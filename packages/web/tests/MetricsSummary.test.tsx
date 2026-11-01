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
    expect(screen.getByRole("table", { name: "Metrics per page" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close metrics summary/i }));
    expect(screen.queryByRole("table", { name: "Metrics per page" })).not.toBeInTheDocument();
  });
});
