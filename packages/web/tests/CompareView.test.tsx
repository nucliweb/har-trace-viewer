import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { compareFlows } from "@htv/core";
import { CompareView } from "../src/components/CompareView.js";
import { makeCompareFlows } from "./fixtures.js";

const [a, b] = makeCompareFlows();
const { pairs } = compareFlows(a, b);
const total = pairs.length;
const thirdParty = pairs.findIndex((p) => p.kind === "third-party");
const secondary = pairs.findIndex((p) => p.kind === "secondary");
const ttfb = pairs.findIndex((p) => p.kind === "ttfb");

const pane = (side: "A" | "B") => screen.getByRole("region", { name: new RegExp(`^${side} · `) });
const stepInfo = () => screen.getByRole("tabpanel");
// Cell text without the rating spelled out for screen readers, e.g. " (better)".
const cellTexts = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((c) => c.textContent!.replace(/ \(.+\)$/, ""));

async function goTo(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(screen.getByRole("tab", { name: new RegExp(`^Step ${index + 1}:`) }));
}

describe("CompareView", () => {
  it("stacks one labelled diagram per flow, A on top, with a single step track", () => {
    render(<CompareView a={a} b={b} />);

    const panes = screen.getAllByRole("region", { name: /^[AB] · / });
    expect(panes).toHaveLength(2);
    expect(panes[0]).toHaveAccessibleName("A · First view");
    expect(panes[1]).toHaveAccessibleName("B · Repeat view");
    for (const p of panes) expect(p.querySelector("svg")).not.toBeNull();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getAllByRole("tab")).toHaveLength(total);
    expect(screen.getByText(`Step 1 / ${total}`)).toBeInTheDocument();
  });

  it("gives each diagram its own SVG ids", () => {
    render(<CompareView a={a} b={b} />);

    const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("advances both diagrams with Next", async () => {
    const user = userEvent.setup();
    render(<CompareView a={a} b={b} />);

    await user.click(screen.getByRole("button", { name: "Next →" }));

    expect(screen.getByText(`Step 2 / ${total}`)).toBeInTheDocument();
    expect(pane("A")).toHaveAttribute("data-step", "1");
    expect(pane("B")).toHaveAttribute("data-step", "1");
    expect(within(stepInfo()).getAllByText("First request in flight")).toHaveLength(2);
  });

  it("dims the side without the step's kind and keeps its previous step", async () => {
    const user = userEvent.setup();
    render(<CompareView a={a} b={b} />);

    await goTo(user, thirdParty);

    expect(pane("A")).toHaveAttribute("data-step", String(pairs[thirdParty].a));
    expect(pane("A")).toHaveAttribute("data-dimmed", "false");
    expect(pane("B")).toHaveAttribute("data-step", String(pairs[secondary].b));
    expect(pane("B")).toHaveAttribute("data-dimmed", "true");
    expect(within(stepInfo()).getByText("Third-party requests")).toBeInTheDocument();
    expect(
      within(stepInfo()).getByText(/No such step: stays on Secondary resources/)
    ).toBeInTheDocument();
  });

  it("shows both sides' step metrics with the B − A delta", async () => {
    const user = userEvent.setup();
    render(<CompareView a={a} b={b} />);

    await goTo(user, secondary);

    const row = within(stepInfo()).getByRole("row", { name: /^Resources/ });
    expect(cellTexts(row)).toEqual(["2", "1", "−1"]);
  });

  it("reveals the badges of both diagrams as their steps are reached", async () => {
    const user = userEvent.setup();
    render(<CompareView a={a} b={b} />);
    const ttfbBadge = (side: "A" | "B") =>
      within(pane(side)).getByText("TTFB").parentElement!.getAttribute("data-badge-state");

    expect(ttfbBadge("A")).toBe("hidden");
    await goTo(user, ttfb);
    expect(ttfbBadge("A")).toBe("active");
    expect(ttfbBadge("B")).toBe("active");
  });

  it("moves through the pairs with the keyboard", async () => {
    const user = userEvent.setup();
    render(<CompareView a={a} b={b} />);

    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByText(`Step 3 / ${total}`)).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(screen.getByText(`Step ${total} / ${total}`)).toBeInTheDocument();
  });

  it("opens the cache analysis of each side inside its own diagram", async () => {
    const user = userEvent.setup();
    render(<CompareView a={a} b={b} />);

    await user.click(within(pane("B")).getByRole("button", { name: "Toggle cache analysis" }));
    expect(within(pane("B")).getByText("B · Repeat view")).toBeInTheDocument();
    expect(
      within(pane("B")).getByRole("region", { name: "Cache analysis details" })
    ).toHaveTextContent("Hit ratio100% (2/2)");
    expect(
      within(pane("A")).queryByRole("region", { name: "Cache analysis details" })
    ).not.toBeInTheDocument();

    await user.click(within(pane("B")).getByRole("button", { name: "Close cache analysis" }));
    expect(
      screen.queryByRole("region", { name: "Cache analysis details" })
    ).not.toBeInTheDocument();
  });

  describe("Deltas panel", () => {
    async function openDeltas() {
      const user = userEvent.setup();
      render(<CompareView a={a} b={b} />);
      await user.click(screen.getByRole("button", { name: "Toggle deltas" }));
      return user;
    }

    it("lists every metric of both flows with the rated delta", async () => {
      await openDeltas();

      const table = screen.getByRole("table", { name: "Metric deltas" });
      const onLoad = within(table).getByRole("row", { name: /^onLoad/ });
      const cells = within(onLoad).getAllByRole("cell");
      expect(cellTexts(onLoad)).toEqual(["500 ms", "200 ms", "−300 ms", "−60%"]);
      expect(cells[2]).toHaveAttribute("data-rating", "better");
      // Network requests only: B's two browser-cache hits have a row of their own.
      const requests = within(table).getByRole("row", { name: /^Requests/ });
      expect(cellTexts(requests).slice(0, 3)).toEqual(["5", "1", "−4"]);
      const cacheHits = within(table).getByRole("row", { name: /^Browser cache hits/ });
      expect(cellTexts(cacheHits).slice(0, 3)).toEqual(["0", "2", "+2"]);
      expect(within(cacheHits).getAllByRole("cell")[2]).toHaveAttribute("data-rating", "better");
    });

    it("rates each side's Web Vitals like the metrics summary", async () => {
      await openDeltas();

      const table = screen.getByRole("table", { name: "Metric deltas" });
      const ttfbRow = within(table).getByRole("row", { name: /^TTFB/ });
      const [valueA, , delta] = within(ttfbRow).getAllByRole("cell");
      expect(valueA).toHaveAttribute("data-rating", "good");
      expect(delta).toHaveAttribute("data-rating", "same");
    });

    it("joins the hosts of both flows with request and TTFB deltas", async () => {
      await openDeltas();

      const table = screen.getByRole("table", { name: "Host deltas" });
      const thirdPartyRow = within(table).getByRole("row", { name: /^cdn\.third\.com/ });
      expect(cellTexts(thirdPartyRow).slice(0, 3)).toEqual(["1", "0", "−1"]);
    });

    it("notes how to read the deltas, numbered on the metrics and hosts they touch", async () => {
      await openDeltas();

      const notes = within(screen.getByRole("list", { name: "Notes on the deltas" }));
      expect(notes.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        expect.stringContaining("B made 4 fewer network requests than A (5 → 1)"),
      ]);
      const table = screen.getByRole("table", { name: "Metric deltas" });
      const marker = (row: string) =>
        within(table)
          .getByRole("row", { name: new RegExp(`^${row}`) })
          .querySelector("sup");
      expect(marker("CDN hit ratio")).toHaveTextContent("1");
      expect(marker("TTFB")).toBeNull();
      expect(
        screen.getByRole("heading", { name: /^Hosts/ }).querySelector("sup")
      ).toHaveTextContent("1");
    });

    it("rates each host's TTFB on the URLs both flows requested", async () => {
      await openDeltas();

      const table = screen.getByRole("table", { name: "Host deltas" });
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((th) => th.textContent)
      ).toEqual([
        "Host",
        "Requests A",
        "Requests B",
        "Δ",
        "Avg TTFB A",
        "Avg TTFB B",
        "Same URLs",
        "Δ TTFB",
        "Provider",
      ]);
      // Only the document reached example.com in both flows: same URL, same TTFB.
      const own = within(table).getByRole("row", { name: /^example\.com/ });
      expect(cellTexts(own).slice(5, 7)).toEqual(["1", "0 ms"]);
      const thirdParty = within(table).getByRole("row", { name: /^cdn\.third\.com/ });
      expect(cellTexts(thirdParty).slice(4, 7)).toEqual(["—", "0", ""]);
    });

    it("closes with its close button", async () => {
      const user = await openDeltas();
      await user.click(screen.getByRole("button", { name: "Close deltas" }));
      expect(screen.queryByRole("table", { name: "Metric deltas" })).not.toBeInTheDocument();
    });
  });
});
