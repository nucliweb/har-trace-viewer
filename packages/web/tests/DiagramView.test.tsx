import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DiagramView } from "../src/components/DiagramView.js";
import { makeFlow } from "./fixtures.js";

const flow = makeFlow();
const stepOf = (type: string) => flow.steps.findIndex((s) => s.badge?.type === type);
const badge = (label: string) =>
  Array.from(document.querySelectorAll(".badgeLabel")).find((el) => el.textContent === label)
    ?.parentElement ?? null;
const isHidden = (label: string) => badge(label)!.className.includes("badgeHidden");

async function goTo(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(screen.getByRole("tab", { name: new RegExp(`^Step ${index + 1}:`) }));
}

describe("DiagramView", () => {
  it("starts on step 1 with every badge hidden", () => {
    render(<DiagramView flow={flow} />);
    expect(screen.getByText(`Step 1 / ${flow.steps.length}`)).toBeInTheDocument();
    for (const label of ["TTFB", "FCP", "LCP"]) expect(isHidden(label)).toBe(true);
  });

  it("reveals each badge only once its step is reached", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const ttfb = stepOf("ttfb");
    const fcp = stepOf("fcp");
    expect(ttfb).toBeGreaterThanOrEqual(0);
    expect(fcp).toBeGreaterThan(ttfb);

    await goTo(user, ttfb);
    expect(isHidden("TTFB")).toBe(false);
    expect(isHidden("FCP")).toBe(true);

    await goTo(user, fcp);
    expect(isHidden("FCP")).toBe(false);
    expect(isHidden("TTFB")).toBe(false);

    await goTo(user, ttfb);
    expect(isHidden("FCP")).toBe(true);
  });

  it("updates the step label with Next and Prev", async () => {
    const user = userEvent.setup();
    const total = flow.steps.length;
    render(<DiagramView flow={flow} />);
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText(`Step 2 / ${total}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /prev/i }));
    expect(screen.getByText(`Step 1 / ${total}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
  });

  it("opens and closes the cache panel with the page label", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const label = `Page 1 · ${flow.pages[0].name}`;
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle cache analysis" }));
    expect(screen.getByText(label)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle cache analysis" }));
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  });
});
