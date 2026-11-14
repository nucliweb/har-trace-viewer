import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DiagramView } from "../src/components/DiagramView.js";
import { CompareView } from "../src/components/CompareView.js";
import { makeFlow } from "./fixtures.js";
import { apiCaptureHar, apiCaptureWithPageHar, makeApiFlow } from "./api-capture.js";

const NONSENSE = /NaN|undefined|null|Invalid Date/;
const DRAWERS = [/metrics/i, /cache/i, /findings/i, /waterfall/i, /hops/i];

const captures = [
  ["without pages", () => makeApiFlow(apiCaptureHar())],
  ["with a page that has no document", () => makeApiFlow(apiCaptureWithPageHar())],
] as const;

describe.each(captures)("an API capture %s", (_name, make) => {
  const flow = make();

  it("walks every step and opens every drawer without nonsense text", async () => {
    const user = userEvent.setup();
    const { container } = render(<DiagramView flow={flow} />);
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();

    for (let i = 0; i < flow.steps.length; i++) {
      await user.click(screen.getByRole("tab", { name: new RegExp(`^Step ${i + 1}:`) }));
      expect(container.textContent).not.toMatch(NONSENSE);
    }
    for (const name of DRAWERS) {
      await user.click(screen.getByRole("button", { name }));
      expect(container.textContent).not.toMatch(NONSENSE);
      expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    }
  });

  it("shows no TTFB badge and n/a for the document metrics", async () => {
    const user = userEvent.setup();
    const { container } = render(<DiagramView flow={flow} />);
    await user.click(screen.getByRole("tab", { name: /^Step 4:/ }));
    expect(container.querySelector("[data-badge-state]")).toBeNull();

    await user.click(screen.getByRole("button", { name: /metrics/i }));
    for (const label of ["TTFB (from navigation)", "Server wait"]) {
      expect(
        screen.getByRole("row", { name: new RegExp(`^${label.replace(/[()]/g, "\\$&")}`) })
      ).toHaveTextContent("n/a");
    }
  });

  it("zooms the waterfall on the page load and lists the resources of a step", async () => {
    const user = userEvent.setup();
    const { container } = render(<DiagramView flow={flow} />);
    await user.click(screen.getByRole("button", { name: /waterfall/i }));
    await user.selectOptions(screen.getByLabelText("Axis"), "Page load");
    expect(container.textContent).not.toMatch(NONSENSE);

    await user.click(screen.getByRole("tab", { name: /^Step 4:/ }));
    await user.click(screen.getByRole("button", { name: /resource list/i }));
    expect(container.textContent).not.toMatch(NONSENSE);
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("steps through the keyboard from the first to the last step and back", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const total = flow.steps.length;
    await user.keyboard("{ArrowRight>3/}");
    expect(screen.getByText(`Step ${total} / ${total}`)).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText(`Step ${total} / ${total}`)).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(screen.getByText(`Step 1 / ${total}`)).toBeInTheDocument();
  });

  it("never calls the primary request a document", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.click(screen.getByRole("button", { name: /cache/i }));
    expect(screen.queryByText("Document")).not.toBeInTheDocument();
    expect(screen.getByText("Primary request")).toBeInTheDocument();
  });
});

describe("compare with an API capture", () => {
  const pairs = [
    ["a page with a document and an API capture", () => [makeFlow(), makeApiFlow()]],
    ["an API capture and a page with a document", () => [makeApiFlow(), makeFlow()]],
    ["two API captures", () => [makeApiFlow(), makeApiFlow(apiCaptureWithPageHar())]],
  ] as const;

  it.each(pairs)("shows %s without nonsense text, Deltas and cache included", async (_n, make) => {
    const user = userEvent.setup();
    const [a, b] = make();
    const { container } = render(<CompareView a={a} b={b} />);
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /deltas/i }));
    expect(container.textContent).not.toMatch(NONSENSE);
    const ttfb = screen.getByRole("row", { name: /^TTFB/ });
    expect(ttfb.textContent).not.toMatch(NONSENSE);

    await user.click(screen.getAllByRole("button", { name: /cache/i })[0]);
    expect(container.textContent).not.toMatch(NONSENSE);
  });
});
