import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaterfallPanel } from "../src/components/WaterfallPanel.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";

const css = makeEntry({ url: "https://example.com/css/main.css", startTime: 100, duration: 40 });
const hero = makeEntry({
  url: "https://example.com/img/hero.avif",
  startTime: 200,
  duration: 80,
  resourceType: "image",
  transferSize: 48_000,
});
const har = makeHar([css, hero], { onContentLoad: 300, onLoad: 520 });

const renderPanel = () =>
  render(<WaterfallPanel har={har} pageLabel="Page 1" onClose={() => undefined} />);
const names = () =>
  within(screen.getByRole("list", { name: /Requests/ }))
    .getAllByRole("listitem")
    .map((row) => row.querySelector("[data-name]")?.textContent);
const search = () => screen.getByRole("searchbox", { name: "Filter requests" });

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("WaterfallPanel view state", () => {
  it("writes the filter, view and sort to the hash without adding history entries", async () => {
    const user = userEvent.setup();
    const before = window.history.length;
    renderPanel();
    await user.type(search(), "hero");
    expect(window.location.hash).toBe("#q=hero&v=waterfall&s=start.asc");

    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "Sort by size" }));
    expect(window.location.hash).toBe("#q=hero&v=table&s=size.desc");
    expect(window.history.length).toBe(before);
  });

  it("writes the selected request, and clears the hash when the drawer closes", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPanel();
    await user.click(
      within(screen.getByRole("list", { name: /Requests/ })).getAllByRole("button")[1]
    );
    expect(window.location.hash).toContain("&r=");
    unmount();
    expect(window.location.hash).toBe("");
  });

  it("opens as the link says: filter, view, sort and selection", () => {
    window.history.replaceState(null, "", "/#q=main&v=table&s=name.desc&r=1");
    renderPanel();
    expect(search()).toHaveValue("main");
    const table = screen.getByRole("table", { name: /Requests/ });
    // The header, the one request that matches, and the actions of the selected one.
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("button", { name: "Copy URL" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("selects the request of the link in the waterfall view", () => {
    window.history.replaceState(null, "", "/#r=1");
    renderPanel();
    const rowButtons = within(screen.getByRole("list", { name: /Requests/ })).getAllByRole(
      "button"
    );
    expect(rowButtons.filter((b) => b.getAttribute("aria-expanded") === "true")).toHaveLength(1);
  });

  it("ignores a selection that matches no request and malformed values", () => {
    window.history.replaceState(null, "", "/#r=99&v=grid&s=nope.up");
    renderPanel();
    expect(names()).toHaveLength(3);
    expect(search()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Waterfall" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      within(screen.getByRole("list", { name: /Requests/ }))
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-expanded") === "true")
    ).toHaveLength(0);
  });
});

describe("WaterfallPanel preferences", () => {
  it("restores the filter, view and sort on the next visit", async () => {
    const user = userEvent.setup();
    const first = renderPanel();
    await user.type(search(), "hero");
    await user.click(screen.getByRole("button", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "Sort by size" }));
    first.unmount();

    renderPanel();
    expect(search()).toHaveValue("hero");
    const table = screen.getByRole("table", { name: /Requests/ });
    expect(within(table).getByRole("columnheader", { name: /Size/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("lets the link win over the stored values", async () => {
    const user = userEvent.setup();
    const first = renderPanel();
    await user.type(search(), "hero");
    await user.click(screen.getByRole("button", { name: "Table" }));
    first.unmount();

    window.history.replaceState(null, "", "/#q=&v=waterfall");
    renderPanel();
    expect(search()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Waterfall" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("works for the page when the storage throws", async () => {
    for (const method of ["getItem", "setItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    const user = userEvent.setup();
    renderPanel();
    await user.type(search(), "hero");
    expect(names()).toEqual(["hero.avif"]);
  });
});
