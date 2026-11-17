import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { compareFlowRequests, generateFlow } from "@htv/core";
import type { HarEntry } from "@htv/core";
import { CompareView } from "../src/components/CompareView.js";
import { RequestDeltas } from "../src/components/RequestDeltas.js";
import { Drawer } from "../src/components/Drawer.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";
import { makeCompareFlows } from "./fixtures.js";
import { loadOnDemandModules } from "./lazy.js";

beforeAll(loadOnDemandModules);

const table = () => screen.getByRole("table", { name: "Request deltas" });
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const rowNamed = (name: RegExp) => within(table()).getByRole("row", { name });
// Cell text without what is spelled out for screen readers only, e.g. " (better)".
const cellTexts = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((c) => c.textContent!.replace(/ \(.+\)$/, ""));
const headers = () =>
  within(table())
    .getAllByRole("columnheader")
    .map((th) => th.textContent!.replace(/ [↑↓]$/, ""));

function renderRequests(a: HarEntry[], b: HarEntry[]) {
  const flowA = generateFlow([{ name: "Cold", har: makeHar(a) }]);
  const flowB = generateFlow([{ name: "Warm", har: makeHar(b) }]);
  render(
    <Drawer title="Deltas" width="1040px">
      <RequestDeltas requests={compareFlowRequests(flowA, flowB)} />
    </Drawer>
  );
}

const script = (url: string, overrides: Partial<HarEntry> = {}) =>
  makeEntry({ url, mimeType: "application/javascript", resourceType: "script", ...overrides });

describe("RequestDeltas in the comparison", () => {
  it("opens from the Requests view of the Deltas drawer", async () => {
    const user = userEvent.setup();
    const [a, b] = makeCompareFlows();
    render(<CompareView a={a} b={b} />);
    await user.click(screen.getByRole("button", { name: "Toggle deltas" }));

    const views = screen.getByRole("group", { name: "Deltas views" });
    expect(within(views).getByRole("button", { name: "Summary" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await user.click(within(views).getByRole("button", { name: "Requests" }));

    expect(within(views).getByRole("button", { name: "Requests" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByRole("table", { name: "Metric deltas" })).not.toBeInTheDocument();
    // B served the stylesheet and one image from the browser cache, and dropped the rest.
    const css = rowNamed(/^critical-100\.css/);
    expect(cellTexts(css)).toEqual([
      "100 ms",
      "50 ms",
      "50 ms",
      "0 ms",
      "0 ms",
      "1.0 KB",
      "1.0 KB",
      "0 B",
      "200",
      "network → browser cache",
      "—",
      "VeryHigh",
    ]);
    expect(within(css).getByText("network → browser cache")).toHaveTextContent("(changed)");
    expect(screen.getByRole("group", { name: "Filter requests" })).toHaveTextContent(
      "All 5Changed 2Added 0Removed 2"
    );

    await user.click(within(views).getByRole("button", { name: "Summary" }));
    expect(screen.getByRole("table", { name: "Metric deltas" })).toBeInTheDocument();
  });
});

describe("RequestDeltas", () => {
  it("names its columns and puts the biggest change of time first", () => {
    renderRequests(
      [script("https://example.com/a.js", { duration: 100 }), script("https://example.com/b.js")],
      [script("https://example.com/a.js", { duration: 400 }), script("https://example.com/b.js")]
    );

    expect(headers()).toEqual([
      "Request",
      "Start",
      "Time A",
      "Time B",
      "Δ time",
      "Δ TTFB",
      "Size A",
      "Size B",
      "Δ size",
      "Status",
      "Cache",
      "Protocol",
      "Priority",
    ]);
    // Ties keep the order of the comparison: the bigger change of bytes, then the earlier start.
    expect(bodyRows().map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "a.js",
      "example.com",
      "b.js",
    ]);
    const delta = within(rowNamed(/^a\.js/)).getAllByRole("cell")[3];
    expect(delta).toHaveTextContent("+300 ms (worse)");
    expect(delta).toHaveAttribute("data-rating", "worse");
    expect(screen.getByRole("columnheader", { name: /^Δ time/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("sorts by another column, and reverses it on a second click", async () => {
    const user = userEvent.setup();
    renderRequests(
      [
        script("https://example.com/a.js", { duration: 100, transferSize: 1000 }),
        script("https://example.com/b.js", { startTime: 50, transferSize: 1000 }),
      ],
      [
        script("https://example.com/a.js", { duration: 400, transferSize: 1000 }),
        script("https://example.com/b.js", { startTime: 50, transferSize: 90_000 }),
      ]
    );
    const names = () => bodyRows().map((r) => within(r).getByRole("rowheader").textContent);

    await user.click(screen.getByRole("button", { name: "Sort by Δ size" }));
    expect(names()).toEqual(["b.js", "a.js", "example.com"]);
    expect(screen.getByRole("columnheader", { name: /^Δ size/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );

    await user.click(screen.getByRole("button", { name: "Sort by Δ size" }));
    expect(names()).toEqual(["a.js", "example.com", "b.js"]);

    await user.click(screen.getByRole("button", { name: "Sort by start" }));
    expect(names()).toEqual(["example.com", "b.js", "a.js"]);

    await user.click(screen.getByRole("button", { name: "Sort by request" }));
    expect(names()).toEqual(["a.js", "b.js", "example.com"]);

    await user.click(screen.getByRole("button", { name: "Sort by Δ TTFB" }));
    expect(screen.getByRole("columnheader", { name: /^Δ TTFB/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("filters the added, the removed and the changed requests", async () => {
    const user = userEvent.setup();
    renderRequests(
      [script("https://example.com/old.js"), script("https://example.com/same.js")],
      [
        script("https://example.com/new.js", { transferSize: 3000 }),
        script("https://example.com/same.js", { status: 304 }),
      ]
    );
    const filters = within(screen.getByRole("group", { name: "Filter requests" }));

    await user.click(filters.getByRole("button", { name: "Added 1" }));
    expect(filters.getByRole("button", { name: "Added 1" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const added = rowNamed(/new\.js/);
    expect(within(added).getByRole("rowheader")).toHaveTextContent("added new.js");
    // An added request: nothing on A, its whole time and size as the delta.
    expect(cellTexts(added).slice(1, 8)).toEqual([
      "—",
      "50 ms",
      "+50 ms",
      "+10 ms",
      "—",
      "3.0 KB",
      "+3.0 KB",
    ]);
    expect(bodyRows()).toHaveLength(1);

    await user.click(filters.getByRole("button", { name: "Removed 1" }));
    expect(within(rowNamed(/old\.js/)).getByRole("rowheader")).toHaveTextContent("removed old.js");
    expect(cellTexts(rowNamed(/old\.js/)).slice(1, 4)).toEqual(["50 ms", "—", "−50 ms"]);

    await user.click(filters.getByRole("button", { name: "Changed 1" }));
    expect(cellTexts(rowNamed(/^same\.js/))[8]).toBe("200 → 304");

    await user.click(filters.getByRole("button", { name: "All 4" }));
    expect(bodyRows()).toHaveLength(4);
  });

  it("says when a filter leaves nothing", async () => {
    const user = userEvent.setup();
    renderRequests([script("https://example.com/a.js")], [script("https://example.com/a.js")]);

    await user.click(screen.getByRole("button", { name: "Added 0" }));

    expect(screen.getByText("No request in this view.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Request deltas" })).not.toBeInTheDocument();
  });

  it("marks a pair matched by a similar URL, with both URLs", () => {
    renderRequests(
      [script("https://example.com/main-93d7eb3c1c216c38.js")],
      [script("https://example.com/main-0a1b2c3d4e5f6789.js")]
    );

    const header = within(rowNamed(/main-0a1b2c3d4e5f6789\.js/)).getByRole("rowheader");
    expect(header).toHaveTextContent("≈ matched by a similar URL main-0a1b2c3d4e5f6789.js");
    expect(header).toHaveAttribute(
      "title",
      "A: https://example.com/main-93d7eb3c1c216c38.js\nB: https://example.com/main-0a1b2c3d4e5f6789.js"
    );
    expect(screen.getByText(/1 of them by a similar URL/)).toBeInTheDocument();
  });
});

describe("RequestDeltas with more than 300 requests", { timeout: 30_000 }, () => {
  it("renders the rows near the view only, and the others as it scrolls", () => {
    const many = (prefix: string) =>
      Array.from({ length: 400 }, (_, i) =>
        script(`https://example.com/${prefix}${i}.js`, { startTime: 100 + i })
      );
    renderRequests(many("a"), many("a"));

    expect(table()).toHaveAttribute("aria-rowcount", "402");
    const rendered = bodyRows().filter((r) => r.hasAttribute("data-index"));
    expect(rendered.length).toBeGreaterThan(20);
    expect(rendered.length).toBeLessThan(100);

    const region = screen.getByRole("region", { name: "Request deltas" });
    act(() => {
      region.scrollTop = 24 * 300;
      fireEvent.scroll(region);
    });
    const indexes = bodyRows()
      .filter((r) => r.hasAttribute("data-index"))
      .map((r) => Number(r.getAttribute("data-index")));
    expect(indexes).toContain(300);
    expect(indexes).not.toContain(0);
  });
});
