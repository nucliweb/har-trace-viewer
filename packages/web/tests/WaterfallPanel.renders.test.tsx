import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WaterfallPanel } from "../src/components/WaterfallPanel.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";

// Rows read `shortName` once per render: counting those reads counts the row renders.
const reads = vi.hoisted(() => ({ byName: new Map<string, number>() }));

vi.mock("@htv/core", async (importActual) => {
  const actual = await importActual<typeof import("@htv/core")>();
  return {
    ...actual,
    buildWaterfall: (...args: Parameters<typeof actual.buildWaterfall>) => {
      const waterfall = actual.buildWaterfall(...args);
      return {
        ...waterfall,
        rows: waterfall.rows.map((row) => {
          const name = row.shortName;
          return Object.defineProperty({ ...row }, "shortName", {
            get() {
              reads.byName.set(name, (reads.byName.get(name) ?? 0) + 1);
              return name;
            },
          });
        }),
      };
    },
  };
});

const total = () => [...reads.byName.values()].reduce((sum, n) => sum + n, 0);

const entries = Array.from({ length: 60 }, (_, i) =>
  makeEntry({ url: `https://example.com/asset-${i}.js`, startTime: i * 10, duration: 20 })
);
const har = makeHar(entries, { onContentLoad: 300, onLoad: 520 });

function renderPanel() {
  render(<WaterfallPanel har={har} pageLabel="Home" onClose={() => undefined} />);
}

describe("WaterfallPanel render cost", () => {
  beforeEach(() => reads.byName.clear());

  it("re-renders only the rows whose active state changed when hovering", () => {
    renderPanel();
    const buttons = screen.getAllByRole("button", { name: /asset-/ });
    expect(buttons).toHaveLength(60);

    reads.byName.clear();
    fireEvent.mouseEnter(buttons[3]);
    expect(total()).toBe(1);

    reads.byName.clear();
    fireEvent.mouseEnter(buttons[7]);
    fireEvent.mouseLeave(buttons[3]);
    expect(total()).toBeLessThanOrEqual(3);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  });

  it("keeps typing responsive: the search settles after the input", async () => {
    renderPanel();
    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "asset-5");
    expect(search).toHaveValue("asset-5");
    await act(async () => undefined);
    expect(screen.getAllByRole("button", { name: /asset-5/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /asset-6/ })).toBeNull();
  });
});
