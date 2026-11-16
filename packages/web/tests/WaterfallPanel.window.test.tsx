import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaterfallPanel } from "../src/components/WaterfallPanel.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";

// The document and 1 000 assets, in start order: the request at position p (0 the document) is
// asset-(p - 1), and its entry index is p.
const COUNT = 1001;
const assets = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    makeEntry({
      url: `https://example.com/asset-${i}.js`,
      startTime: 100 + i,
      transferSize: 1000 + i,
    })
  );
const large = makeHar(assets(COUNT - 1));

function renderPanel(har = large) {
  render(<WaterfallPanel har={har} pageLabel="Big page" onClose={() => undefined} />);
}

const list = () => screen.getByRole("list", { name: /^Requests/ });
const items = () => within(list()).queryAllByRole("listitem");
const positions = () => items().map((item) => Number(item.getAttribute("aria-posinset")));
const item = (position: number) =>
  items().find((li) => li.getAttribute("aria-posinset") === String(position));
const rowButton = (position: number) => within(item(position)!).getAllByRole("button")[0];
const region = () => screen.getByRole("region", { name: "Waterfall details" });

/** Scrolls the region, as a wheel or the scrollbar would. jsdom has no layout: rows are 24px. */
function scrollTo(top: number) {
  act(() => {
    region().scrollTop = top;
    fireEvent.scroll(region());
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

// A wide timeout keeps the tests about the rows, not about how fast an instrumented render of
// hundreds of rows runs on a busy machine.
describe("WaterfallPanel with more than 300 requests", { timeout: 30_000 }, () => {
  it("renders every request of a page of up to 300, as a plain list", () => {
    renderPanel(makeHar(assets(299)));
    expect(items()).toHaveLength(300);
    expect(items()[0]).not.toHaveAttribute("aria-setsize");
    expect(list().querySelectorAll("li[aria-hidden]")).toHaveLength(0);
  });

  it("renders the rows near the view only, each with its true position in the list", () => {
    renderPanel();
    expect(items().length).toBeGreaterThan(20);
    expect(items().length).toBeLessThan(100);
    expect(positions()[0]).toBe(1);
    expect(items()[0]).toHaveAttribute("aria-setsize", String(COUNT));
    expect(within(list()).getByText("example.com")).toBeInTheDocument();
    // The status still counts every request: each one is a scroll away.
    expect(screen.getByText(`${COUNT} requests`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more/ })).not.toBeInTheDocument();
  });

  it("renders the rows further down as the list scrolls, down to the last one", () => {
    renderPanel();
    scrollTo(24 * 500);
    expect(positions()).toContain(501);
    expect(positions()).not.toContain(1);
    expect(items().length).toBeLessThan(100);

    scrollTo(24 * COUNT);
    expect(positions().at(-1)).toBe(COUNT);
    expect(within(item(COUNT)!).getByText("asset-999.js")).toBeInTheDocument();
  });

  it("moves the focus past the rendered rows with the keyboard, onto a row each time", async () => {
    const user = userEvent.setup();
    renderPanel();
    act(() => rowButton(1).focus());

    await user.keyboard("{End}");
    expect(rowButton(COUNT)).toHaveFocus();
    expect(positions()).not.toContain(1);
    await user.keyboard("{ArrowUp}");
    expect(rowButton(COUNT - 1)).toHaveFocus();
    await user.keyboard("{Home}");
    expect(rowButton(1)).toHaveFocus();

    // Down past the bottom of the window, one row at a time.
    const rendered = positions().at(-1)!;
    act(() => rowButton(rendered - 2).focus());
    await user.keyboard("{ArrowDown>7/}");
    expect(rowButton(rendered + 5)).toHaveFocus();
    await user.keyboard("{PageDown}");
    const paged = Number(document.activeElement!.closest("li")!.getAttribute("aria-posinset"));
    expect(paged).toBeGreaterThan(rendered + 5);
    await user.keyboard("{PageUp}");
    expect(rowButton(rendered + 5)).toHaveFocus();
  });

  it("goes on to the next row with Tab past the last rendered one, and back with Shift+Tab", async () => {
    const user = userEvent.setup();
    renderPanel();
    const last = positions().at(-1)!;
    act(() => rowButton(last).focus());

    await user.tab();
    expect(rowButton(last + 1)).toHaveFocus();
    scrollTo(24 * 600);
    const first = positions().find((position) => position > last + 1)!;
    act(() => rowButton(first).focus());
    await user.tab({ shift: true });
    expect(rowButton(first - 1)).toHaveFocus();
  });

  it("keeps the focused row rendered when the list scrolls away from it", () => {
    renderPanel();
    act(() => rowButton(3).focus());
    scrollTo(24 * 700);
    expect(rowButton(3)).toHaveFocus();
    expect(positions()).toContain(701);

    act(() => screen.getByRole("searchbox").focus());
    scrollTo(24 * 701);
    expect(positions()).not.toContain(3);
  });

  it("opens a link's selection far down the list, rendered, selected and kept on scrolling", () => {
    window.history.replaceState(null, "", "/#r=900");
    renderPanel();
    expect(rowButton(901)).toHaveAttribute("aria-expanded", "true");
    expect(within(item(901)!).getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
    expect(region().scrollTop).toBeGreaterThan(24 * 800);

    scrollTo(0);
    expect(positions()).not.toContain(901);
    scrollTo(24 * 895);
    expect(rowButton(901)).toHaveAttribute("aria-expanded", "true");
  });

  it("starts from the top after a sort or a filter, or shows the selected request", async () => {
    const user = userEvent.setup();
    renderPanel();
    scrollTo(24 * 500);

    await user.click(screen.getByRole("button", { name: "Sort by size" }));
    expect(region().scrollTop).toBe(0);
    // Largest first: the last asset, then the one before.
    expect(within(items()[0]).getByText("asset-999.js")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sort by size" }));
    await user.click(screen.getByRole("button", { name: "Sort by size" }));

    scrollTo(24 * 500);
    await user.click(rowButton(505));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "asset-50" } });
    await act(async () => undefined);
    // asset-50 and asset-500 to asset-509: the selected asset-503 shows, and the list is short.
    expect(items()).toHaveLength(11);
    expect(within(list()).getByRole("button", { expanded: true })).toHaveTextContent("asset-503");
  });

  it("gives the table its true row count, and each row its index", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/#r=2");
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: /^Requests/ });
    // The header, the requests and the actions row of the selected one.
    expect(table).toHaveAttribute("aria-rowcount", String(COUNT + 2));
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBeLessThan(100);
    expect(rows.slice(0, 5).map((row) => row.getAttribute("aria-rowindex"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    // The selected request (asset-1, at position 2), then its actions row.
    expect(rows[3]).toHaveTextContent("asset-1.js");
    expect(within(rows[4]).getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
    expect(rows[5]).toHaveTextContent("asset-2.js");

    scrollTo(24 * COUNT);
    const last = within(table).getAllByRole("row").at(-1)!;
    expect(last).toHaveAttribute("aria-rowindex", String(COUNT + 2));
    expect(last).toHaveTextContent("asset-999.js");
  });

  it("measures the rows: the gaps stand for rows of their real height", () => {
    // A layout of 30px rows (the actions of a selected row add 40px), from the top of the list.
    const rect = (top: number, height: number) => ({ top, height }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      const index = this.dataset.index;
      if (index === undefined) return rect(0, 0);
      const position = Number(index);
      return rect(position * 30 + (position > 2 ? 40 : 0), position === 2 ? 70 : 30);
    });
    window.history.replaceState(null, "", "/#r=2");
    renderPanel();

    const rendered = items().length;
    const gap = list().querySelector<HTMLElement>("li[aria-hidden]:last-child")!;
    expect(gap.style.height).toBe(`${(COUNT - rendered) * 30}px`);
  });
});
