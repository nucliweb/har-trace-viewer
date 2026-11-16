import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompareTarget } from "../src/components/flow-builder/CompareTarget.js";
import { makeEntry } from "../src/components/flow-builder/page-entry.js";
import type { PageEntry } from "../src/components/flow-builder/page-entry.js";
import { makeHar } from "../../core/tests/helpers/synthetic-har";
import { parseTraceJson } from "@htv/core";
import { makeFile, traceJson } from "./fixtures";

function twoPageHar() {
  const [first, second] = [makeHar([]), makeHar([])];
  first.pages = [{ id: "p1", title: "First page", onContentLoad: 1, onLoad: 2 }];
  second.pages = [{ id: "p2", title: "Second page", onContentLoad: 1, onLoad: 2 }];
  return [first, second];
}

function renderTarget(patch: Partial<PageEntry> = {}) {
  const handlers = {
    onHarFile: vi.fn(),
    onTraceFile: vi.fn(),
    onPageChange: vi.fn(),
    onRemove: vi.fn(),
  };
  const entry = { ...makeEntry(), ...patch };
  render(<CompareTarget entry={entry} {...handlers} />);
  return handlers;
}

describe("CompareTarget", () => {
  it("hands over the first file dropped on it and ignores a drop without files", () => {
    const { onHarFile } = renderTarget();
    const row = screen
      .getByRole("button", { name: /drop \.har to compare/i })
      .closest("div")!.parentElement!;

    fireEvent.drop(row, { dataTransfer: { files: [] } });
    expect(onHarFile).not.toHaveBeenCalled();

    const file = makeFile("{}", "other.har");
    fireEvent.drop(row, { dataTransfer: { files: [file, makeFile("{}", "third.har")] } });
    expect(onHarFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it("highlights the row while a file is dragged over it and clears it on leave or drop", () => {
    renderTarget();
    const row = screen
      .getByRole("button", { name: /drop \.har to compare/i })
      .closest("div")!.parentElement!;
    expect(row).not.toHaveClass("rowDragging");

    fireEvent.dragOver(row);
    expect(row).toHaveClass("rowDragging");
    fireEvent.dragLeave(row);
    expect(row).not.toHaveClass("rowDragging");

    fireEvent.dragOver(row);
    fireEvent.drop(row, { dataTransfer: { files: [] } });
    expect(row).not.toHaveClass("rowDragging");
  });

  it("hands over the file chosen with the HAR button", async () => {
    const { onHarFile } = renderTarget();
    const file = makeFile("{}", "other.har");

    await userEvent.setup().upload(screen.getByLabelText("HAR file to compare with"), file);

    expect(onHarFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it("cannot remove a comparison that holds nothing", () => {
    renderTarget();

    expect(screen.getByRole("button", { name: "Remove comparison" })).toBeDisabled();
  });

  it("removes a loaded comparison", async () => {
    const { onRemove } = renderTarget({ har: [makeHar([])], harFileName: "other.har" });

    await userEvent.setup().click(screen.getByRole("button", { name: "Remove comparison" }));

    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("offers the pages of a multi-page HAR and reports the one picked", async () => {
    const { onPageChange } = renderTarget({
      har: twoPageHar(),
      harFileName: "other.har",
      selectedPageIds: ["p1"],
    });
    const select = screen.getByRole("combobox", { name: "Page" });
    expect(select).toHaveValue("p1");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("First page"),
      expect.stringContaining("Second page"),
    ]);

    await userEvent.setup().selectOptions(select, "p2");

    expect(onPageChange).toHaveBeenCalledExactlyOnceWith("p2");
  });

  it("offers no page choice for a single-page HAR", () => {
    renderTarget({ har: [makeHar([])], harFileName: "other.har", selectedPageIds: ["p1"] });

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("asks for the HAR when only a trace was given", () => {
    renderTarget({ trace: parseTraceJson(traceJson), traceFileName: "trace.json" });

    expect(screen.getByText(/^Add the HAR of the same recording/)).toBeVisible();
  });
});
