import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DiagramView } from "../src/components/DiagramView.js";
import { analysisJourney } from "./analysis-flow.js";
import { loadOnDemandModules } from "./lazy.js";

const flow = analysisJourney();
const toggle = () => screen.getByRole("button", { name: "Toggle analysis" });
const pressedView = () =>
  within(screen.getByRole("group", { name: "Analysis views" }))
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-pressed") === "true")?.textContent;
const drawerHeading = () => screen.queryByRole("heading", { level: 2, name: /^Analysis / });

// Parts of the app load on demand: load them before the tests use them (see lazy.ts).
beforeAll(loadOnDemandModules);

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("DiagramView: the analysis drawer", () => {
  it.each([
    ["6", "Connections"],
    ["7", "Compression"],
    ["8", "Render"],
    ["9", "Critical path"],
  ])("%s opens it on %s, and closes it again", async (key, view) => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard(key);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(pressedView()).toBe(view);
    await user.keyboard(key);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(drawerHeading()).not.toBeInTheDocument();
  });

  it("the key of another view switches the open drawer to it", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard("6");
    await user.keyboard("8");
    expect(pressedView()).toBe("Render");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("the toolbar button opens the view last shown, and hands the focus back on close", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.click(toggle());
    expect(pressedView()).toBe("Connections");
    await user.click(screen.getByRole("button", { name: "Compression" }));
    expect(pressedView()).toBe("Compression");
    expect(screen.getByRole("button", { name: "Compression" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Close analysis" }));
    expect(toggle()).toHaveFocus();

    await user.click(toggle());
    expect(pressedView()).toBe("Compression");
    await user.keyboard("{Escape}");
    expect(drawerHeading()).not.toBeInTheDocument();
    expect(toggle()).toHaveFocus();
  });

  it("follows the page of the step on screen", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.keyboard("8");
    expect(drawerHeading()).toHaveTextContent("Page 1 · Home");
    expect(screen.getByRole("table", { name: "LCP phases" })).toBeInTheDocument();

    const apiStep = flow.steps.findIndex((s) => s.pageIndex === 1);
    await user.click(screen.getByRole("tab", { name: new RegExp(`^Step ${apiStep + 1}:`) }));
    expect(drawerHeading()).toHaveTextContent("Page 2 · API");
    expect(screen.getByRole("region", { name: "Analysis details" })).toHaveTextContent(
      /This page has no HTML document/
    );
  });

  it("a link opens the view it names, and the link follows the view shown", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/#d=critical-path");
    render(<DiagramView flow={flow} />);

    expect(pressedView()).toBe("Critical path");
    await user.click(screen.getByRole("button", { name: "Connections" }));
    expect(window.location.hash).toBe("#d=connections");
    await user.click(screen.getByRole("button", { name: "Close analysis" }));
    expect(window.location.hash).toBe("");
  });
});
