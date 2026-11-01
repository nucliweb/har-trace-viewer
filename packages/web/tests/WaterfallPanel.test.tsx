import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ParsedTrace } from "@htv/core";
import { WaterfallPanel } from "../src/components/WaterfallPanel.js";
import { makeEntry, makeHar, makeTrace } from "../../core/tests/helpers/synthetic-har";

const css = makeEntry({
  url: "https://example.com/css/main.css",
  startTime: 100,
  duration: 40,
  timing: { blocked: 2, dns: 0, connect: 0, ssl: 0, send: 1, wait: 30, receive: 7 },
  initiator: { type: "parser", url: "https://example.com/" },
});
const hero = makeEntry({
  url: "https://example.com/img/hero.avif",
  startTime: 200,
  duration: 80,
  resourceType: "image",
  mimeType: "image/avif",
  priority: "High",
  transferSize: 48_000,
});
const tag = makeEntry({
  url: "https://cdn.third.com/tag.js?id=42",
  startTime: 150,
  duration: 120,
  resourceType: "script",
  mimeType: "application/javascript",
  priority: "Low",
  status: 302,
  timing: {
    blocked: 5,
    dns: 10,
    connect: 50,
    ssl: 30,
    send: 1,
    wait: 40,
    receive: 14,
  },
});
const cached = makeEntry({
  url: "https://example.com/font.woff2",
  startTime: 260,
  duration: 2,
  resourceType: "font",
  fromCache: "memory",
  transferSize: 0,
  timing: {
    blocked: 0,
    dns: 0,
    connect: 0,
    ssl: 0,
    send: 0,
    wait: 1,
    receive: 1,
    notApplicable: ["dns", "connect", "ssl"],
  },
});

const har = makeHar([css, hero, tag, cached], { onContentLoad: 300, onLoad: 520 });
const trace: ParsedTrace = {
  ...makeTrace(250, 410),
  lcpCandidate: { timeMs: 410, type: "image", url: hero.url },
};

function renderPanel(overrides: Partial<Parameters<typeof WaterfallPanel>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <WaterfallPanel
      har={har}
      trace={trace}
      pageLabel="Page 1 · Home"
      onClose={onClose}
      {...overrides}
    />
  );
  return { onClose };
}

const rows = () =>
  within(screen.getByRole("list", { name: /Requests/ })).queryAllByRole("listitem");
const rowButton = (index: number) => within(rows()[index]).getByRole("button");
const names = () => rows().map((row) => row.querySelector("[data-name]")?.textContent);

describe("WaterfallPanel", () => {
  it("lists the requests by start, the document first, with type, status and size", () => {
    renderPanel();

    expect(screen.getByText("Page 1 · Home")).toBeInTheDocument();
    expect(names()).toEqual(["example.com", "main.css", "tag.js?id=42", "hero.avif", "font.woff2"]);
    const third = rows()[2];
    expect(third).toHaveTextContent("script");
    expect(third).toHaveTextContent("302");
    expect(third).toHaveTextContent("1.0 KB");
  });

  it("says that the browser cache served a request", () => {
    renderPanel();
    expect(rows()[4]).toHaveTextContent("memory");
  });

  it("draws the page's marks on the time ruler", () => {
    renderPanel();
    const ruler = screen.getByRole("img", { name: /Time ruler/ });

    expect(ruler).toHaveAccessibleName(
      "Time ruler: TTFB 81 ms, FCP 250 ms, LCP 410 ms, DCL 300 ms, onLoad 520 ms"
    );
    for (const label of ["TTFB", "FCP", "LCP", "DCL", "Load"]) {
      expect(within(ruler).getByText(label)).toBeInTheDocument();
    }
  });

  it("badges the LCP resource and the render-blocking requests", () => {
    renderPanel();

    expect(within(rows()[3]).getByText("LCP")).toBeInTheDocument();
    expect(within(rows()[1]).getByText("RB")).toHaveAttribute("title", "Render-blocking");
    expect(within(rows()[2]).queryByText("RB")).not.toBeInTheDocument();
  });

  it("filters by resource type with the chips", async () => {
    const user = userEvent.setup();
    renderPanel();
    const chip = screen.getByRole("button", { name: "image" });

    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["hero.avif"]);
    await user.click(screen.getByRole("button", { name: "script" }));
    expect(names()).toEqual(["tag.js?id=42", "hero.avif"]);
    await user.click(chip);
    await user.click(screen.getByRole("button", { name: "script" }));
    expect(rows()).toHaveLength(5);
  });

  it("filters by party, host and URL text", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(screen.getByLabelText("Party"), "third");
    expect(names()).toEqual(["tag.js?id=42"]);
    await user.selectOptions(screen.getByLabelText("Party"), "");
    await user.selectOptions(screen.getByLabelText("Host"), "example.com");
    expect(names()).toHaveLength(4);
    await user.type(screen.getByLabelText("Search URLs"), "IMG/");
    expect(names()).toEqual(["hero.avif"]);
    expect(screen.getByText("1 of 5 requests")).toBeInTheDocument();
  });

  it("zooms the time axis on the page load when late requests stretch the recording", async () => {
    const user = userEvent.setup();
    const beacon = makeEntry({ url: "https://example.com/beacon", startTime: 5_000, duration: 20 });
    renderPanel({ har: makeHar([css, beacon], { onContentLoad: 300, onLoad: 520 }) });
    const ruler = () => screen.getByRole("img", { name: /Time ruler/ });

    expect(ruler()).toHaveTextContent("4.0 s");
    await user.selectOptions(screen.getByLabelText("Axis"), "load");
    expect(ruler()).toHaveTextContent("400 ms");
    expect(ruler()).not.toHaveTextContent("4.0 s");
    // A request after the axis stays listed, its bar out of view.
    expect(names()).toContain("beacon");
  });

  it("says when no request matches", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText("Search URLs"), "nothing-like-this");
    expect(screen.getByText("No request matches the filters.")).toBeInTheDocument();
  });

  it("shows the full URL and the phase durations of a hovered or focused row", async () => {
    const user = userEvent.setup();
    renderPanel();
    const row = rowButton(2);

    await user.hover(row);
    const tooltip = screen.getByRole("tooltip");
    expect(row).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip).toHaveTextContent("https://cdn.third.com/tag.js?id=42");
    expect(tooltip).toHaveTextContent(/Blocked\s*5 ms/);
    expect(tooltip).toHaveTextContent(/DNS\s*10 ms/);
    expect(tooltip).toHaveTextContent(/Connect\s*20 ms/);
    expect(tooltip).toHaveTextContent(/TLS\s*30 ms/);
    expect(tooltip).toHaveTextContent(/Wait\s*40 ms/);
    expect(tooltip).toHaveTextContent(/Receive\s*14 ms/);
    await user.unhover(row);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(rowButton(4));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/DNS\s*n\/a/);
    expect(screen.getByRole("tooltip")).toHaveTextContent("memory cache");
  });

  it("moves between rows with the arrow keys", async () => {
    const user = userEvent.setup();
    renderPanel();
    rowButton(0).focus();

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(rowButton(2)).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(rowButton(1)).toHaveFocus();
    await user.keyboard("{End}");
    expect(rowButton(4)).toHaveFocus();
  });

  it("renders at most 300 rows at once, with a button for the next ones", () => {
    // 650 entries plus the document need three pages of 300. A plain click event and a wide
    // timeout keep the test about the paging, not about how fast an instrumented render runs.
    const many = Array.from({ length: 650 }, (_, i) =>
      makeEntry({ url: `https://example.com/asset-${i}.js`, startTime: 100 + i / 10 })
    );
    renderPanel({ har: makeHar(many), trace: undefined });

    expect(rows()).toHaveLength(300);
    fireEvent.click(screen.getByRole("button", { name: "Show 300 more (351 left)" }));
    expect(rows()).toHaveLength(600);
  }, 30_000);

  it("closes with its close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Close waterfall" }));
    expect(onClose).toHaveBeenCalled();
  });
});
