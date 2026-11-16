import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { DiagramView } from "../src/components/DiagramView.js";
import { CompareView } from "../src/components/CompareView.js";
import { makeCompareFlows, makeFlow } from "./fixtures.js";
import { loadOnDemandModules } from "./lazy.js";

const flow = makeFlow();
const toggle = (drawer: string) =>
  document.querySelector<HTMLElement>(`[data-drawer="${drawer}"]`)!;
const expanded = (drawer: string) => toggle(drawer).getAttribute("aria-expanded") === "true";

// Parts of the app load on demand: load them before the tests use them (see lazy.ts).
beforeAll(loadOnDemandModules);

describe("DiagramView: drawer shortcuts", () => {
  it.each([
    ["1", "findings"],
    ["2", "waterfall"],
    ["3", "hops"],
    ["4", "metrics"],
    ["5", "cache"],
  ])("%s opens the %s drawer and closes it again", async (key, drawer) => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard(key);
    expect(expanded(drawer)).toBe(true);
    await user.keyboard(key);
    expect(expanded(drawer)).toBe(false);
  });

  it("replaces the open drawer with the one asked for", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard("1");
    await user.keyboard("5");
    expect(expanded("findings")).toBe(false);
    expect(expanded("cache")).toBe(true);
  });

  it("/ opens the waterfall and focuses its filter", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard("/");
    const filter = await screen.findByRole("searchbox", { name: "Filter requests" });
    expect(expanded("waterfall")).toBe(true);
    await waitFor(() => expect(filter).toHaveFocus());
  });

  it("/ focuses the filter of a waterfall that is already open, and a typed slash stays text", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard("2");
    const filter = await screen.findByRole("searchbox", { name: "Filter requests" });
    expect(filter).not.toHaveFocus();
    await user.keyboard("/");
    await waitFor(() => expect(filter).toHaveFocus());
    await user.keyboard("a/b");
    expect(filter).toHaveValue("a/b");
    expect(expanded("waterfall")).toBe(true);
  });

  it("does not steal the focus when the waterfall is opened later with its button", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard("/");
    await screen.findByRole("searchbox", { name: "Filter requests" });
    await user.keyboard("{Escape}");
    expect(expanded("waterfall")).toBe(false);
    await user.click(toggle("waterfall"));

    expect(await screen.findByRole("searchbox", { name: "Filter requests" })).not.toHaveFocus();
  });

  it("leaves the keys to a text field", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DiagramView flow={flow} />
        <input aria-label="Notes" />
      </>
    );

    await user.type(screen.getByLabelText("Notes"), "1/");
    expect(expanded("findings")).toBe(false);
    expect(expanded("waterfall")).toBe(false);
  });

  it("leaves the keys to an open dialog", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DiagramView flow={flow} />
        <dialog open aria-label="Settings" />
      </>
    );

    await user.keyboard("1");
    await user.keyboard("/");
    expect(expanded("findings")).toBe(false);
    expect(expanded("waterfall")).toBe(false);
  });

  it("leaves a key with a modifier to the browser", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard("{Control>}1{/Control}");
    expect(expanded("findings")).toBe(false);
  });
});

describe("CompareView: drawer shortcuts", () => {
  it("leaves the digits unbound, since two panes have a drawer each", async () => {
    const user = userEvent.setup();
    const [a, b] = makeCompareFlows();
    render(<CompareView a={a} b={b} />);

    await user.keyboard("1");
    await user.keyboard("2");
    expect(document.querySelectorAll('[data-drawer][aria-expanded="true"]')).toHaveLength(0);
  });
});
