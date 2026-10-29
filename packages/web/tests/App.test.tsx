import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { makeCompareFlows, makeFlow } from "./fixtures.js";

afterEach(() => {
  delete window.__HTV_FLOW__;
  delete window.__HTV_COMPARE__;
});

describe("App", () => {
  it("shows the builder when no flow is embedded", () => {
    render(<App />);
    expect(screen.getByText("Build your flow")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^↩ Reset$/ })).not.toBeInTheDocument();
  });

  it("renders the embedded flow directly and Reset returns to the builder", async () => {
    const user = userEvent.setup();
    const flow = makeFlow();
    window.__HTV_FLOW__ = JSON.parse(JSON.stringify(flow));
    render(<App />);
    expect(screen.getByText(`Step 1 / ${flow.steps.length}`)).toBeInTheDocument();
    expect(screen.queryByText("Build your flow")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^↩ Reset$/ }));
    expect(screen.getByText("Build your flow")).toBeInTheDocument();
  });

  it("renders an embedded comparison as two diagrams with one step track", () => {
    const [a, b] = makeCompareFlows();
    window.__HTV_FLOW__ = JSON.parse(JSON.stringify(a));
    window.__HTV_COMPARE__ = JSON.parse(JSON.stringify(b));
    render(<App />);

    expect(screen.getByRole("region", { name: "Comparison" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "A · First view" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "B · Repeat view" })).toBeInTheDocument();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("toggles the theme from the header", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
