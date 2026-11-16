import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { makeCompareFlows, makeFlow } from "./fixtures.js";
import { loadOnDemandModules } from "./lazy.js";

afterEach(() => {
  delete window.__HTV_FLOW__;
  delete window.__HTV_COMPARE__;
});

// The product version: the published CLI package, which bundles this app into its reports.
const productVersion = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../cli/package.json"), "utf8")
).version;

// Parts of the app load on demand: load them before the tests use them (see lazy.ts).
beforeAll(loadOnDemandModules);

describe("App", () => {
  it("shows the product version in the header", () => {
    render(<App />);
    expect(screen.getByRole("banner")).toHaveTextContent(`v${productVersion}`);
  });

  it("shows the builder when no flow is embedded", () => {
    render(<App />);
    expect(screen.getByText("Build your flow")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("renders the embedded flow directly and Reset returns to the builder", async () => {
    const user = userEvent.setup();
    const flow = makeFlow();
    window.__HTV_FLOW__ = JSON.parse(JSON.stringify(flow));
    render(<App />);
    expect(await screen.findByText(`Step 1 / ${flow.steps.length}`)).toBeInTheDocument();
    expect(screen.queryByText("Build your flow")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("Build your flow")).toBeInTheDocument();
  });

  it("renders an embedded comparison as two diagrams with one step track", async () => {
    const [a, b] = makeCompareFlows();
    window.__HTV_FLOW__ = JSON.parse(JSON.stringify(a));
    window.__HTV_COMPARE__ = JSON.parse(JSON.stringify(b));
    render(<App />);

    expect(await screen.findByRole("region", { name: "Comparison" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "A · First view" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "B · Repeat view" })).toBeInTheDocument();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("tells why an embedded flow draws the Great Firewall", async () => {
    const flow = {
      ...makeFlow(),
      clientRegion: "cn" as const,
      hints: { suggestedClientRegion: { region: "cn" as const, reason: "document DNS 663ms" } },
    };
    window.__HTV_FLOW__ = JSON.parse(JSON.stringify(flow));
    render(<App />);

    expect(await screen.findByRole("status")).toHaveTextContent("so the diagram draws it");
  });

  it("opens the drawer and the filter a link names, and the link follows the view", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/#d=waterfall&q=css");
    window.__HTV_FLOW__ = JSON.parse(JSON.stringify(makeFlow()));
    render(<App />);

    expect(await screen.findByRole("searchbox", { name: "Filter requests" })).toHaveValue("css");
    expect(window.location.hash).toContain("d=waterfall");

    await user.click(screen.getByRole("button", { name: "Close waterfall" }));
    expect(window.location.hash).toBe("");
    await user.click(screen.getByRole("button", { name: "Toggle metrics summary" }));
    expect(window.location.hash).toBe("#d=metrics");

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(window.location.hash).toBe("");
  });

  it("ignores a link that names no drawer of the app", async () => {
    window.history.replaceState(null, "", "/#d=bogus");
    window.__HTV_FLOW__ = JSON.parse(JSON.stringify(makeFlow()));
    render(<App />);

    expect(await screen.findByText(/^Step 1 \//)).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });

  it("toggles the theme from the header", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
