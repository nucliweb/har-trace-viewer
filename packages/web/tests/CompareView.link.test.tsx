import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { compareFlows } from "@htv/core";
import { CompareView } from "../src/components/CompareView.js";
import { makeCompareFlows } from "./fixtures.js";
import { loadOnDemandModules } from "./lazy.js";

const [a, b] = makeCompareFlows();
const total = compareFlows(a, b).pairs.length;

const pane = (side: "A" | "B") => screen.getByRole("region", { name: new RegExp(`^${side} · `) });
const open = (hash: string) => window.history.replaceState(null, "", `/${hash}`);
const hash = () => window.location.hash;

beforeAll(loadOnDemandModules);
afterEach(() => window.history.replaceState(null, "", "/"));

describe("CompareView link", () => {
  it("opens the drawer of the pane the link names", () => {
    open("#d=waterfall&side=b");
    render(<CompareView a={a} b={b} />);
    expect(within(pane("B")).getByRole("region", { name: "Waterfall details" })).toBeVisible();
    expect(within(pane("A")).queryByRole("region", { name: "Waterfall details" })).toBeNull();
  });

  it("opens a drawer without a side in pane A, and ignores drawers a comparison lacks", () => {
    open("#d=cache");
    const { unmount } = render(<CompareView a={a} b={b} />);
    expect(within(pane("A")).getByRole("region", { name: "Cache analysis details" })).toBeVisible();
    unmount();
    open("#d=hops&side=b");
    render(<CompareView a={a} b={b} />);
    expect(screen.queryByRole("region", { name: /details/ })).toBeNull();
  });

  it("opens on the step of the link", () => {
    open("#p=3");
    render(<CompareView a={a} b={b} />);
    expect(screen.getByRole("tab", { name: /^Step 3:/ })).toHaveAttribute("aria-selected", "true");
  });

  it("clamps a step past the end", () => {
    open("#p=999");
    render(<CompareView a={a} b={b} />);
    expect(screen.getByRole("tab", { name: new RegExp(`^Step ${total}:`) })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("opens the Deltas drawer on its Requests view and filter", () => {
    open("#d=deltas&dv=requests&df=removed");
    render(<CompareView a={a} b={b} />);
    expect(screen.getByRole("table", { name: "Request deltas" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Removed/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("opens the Deltas drawer on its summary when the link names no view", () => {
    open("#d=deltas&dv=grid&df=x");
    render(<CompareView a={a} b={b} />);
    expect(screen.getByRole("table", { name: "Metric deltas" })).toBeVisible();
  });

  it("follows the drawer, its pane and the step, and clears them on close", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CompareView a={a} b={b} />);
    await user.click(within(pane("B")).getByRole("button", { name: "Toggle waterfall" }));
    expect(hash()).toContain("d=waterfall&side=b");
    await user.click(within(pane("A")).getByRole("button", { name: "Toggle cache analysis" }));
    expect(hash()).toContain("d=cache&side=a");
    await user.click(within(pane("A")).getByRole("button", { name: "Close cache analysis" }));
    expect(hash()).not.toContain("d=cache");
    await user.click(screen.getByRole("tab", { name: /^Step 2:/ }));
    expect(hash()).toContain("p=2");
    unmount();
    expect(hash()).toBe("");
  });

  it("follows the Deltas drawer, its view and its filter", async () => {
    const user = userEvent.setup();
    render(<CompareView a={a} b={b} />);
    await user.click(screen.getByRole("button", { name: "Toggle deltas" }));
    expect(hash()).toBe("#d=deltas");
    await user.click(screen.getByRole("button", { name: "Requests" }));
    expect(hash()).toBe("#d=deltas&dv=requests");
    await user.click(screen.getByRole("button", { name: /^Removed/ }));
    expect(hash()).toBe("#d=deltas&dv=requests&df=removed");
    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(hash()).toBe("#d=deltas&dv=requests");
    await user.click(screen.getByRole("button", { name: /^Changed/ }));
    await user.click(screen.getByRole("button", { name: "Summary" }));
    expect(hash()).toBe("#d=deltas");
    await user.click(screen.getByRole("button", { name: "Close deltas" }));
    expect(hash()).toBe("");
  });
});
