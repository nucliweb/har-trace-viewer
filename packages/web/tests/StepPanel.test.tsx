import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DiagramView } from "../src/components/DiagramView.js";
import { makeFlow } from "./fixtures.js";

const flow = makeFlow();
const total = flow.steps.length;
const label = (n: number) => screen.getByText(`Step ${n} / ${total}`);
const tab = (n: number) => screen.getByRole("tab", { name: new RegExp(`^Step ${n}:`) });

describe("keyboard navigation", () => {
  it("moves with ArrowRight and ArrowLeft from the document", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(label(3)).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(label(2)).toBeInTheDocument();
  });

  it("jumps with End and Home", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.keyboard("{End}");
    expect(label(total)).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(label(1)).toBeInTheDocument();
  });

  it("works when the diagram region is focused and handles the key only once", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const region = screen.getByRole("region", { name: "Diagram" });
    expect(region).toHaveAttribute("tabindex", "0");
    region.focus();
    await user.keyboard("{ArrowRight}");
    expect(label(2)).toBeInTheDocument();
  });

  it("toggles autoplay with Space", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Auto play" })).toBeInTheDocument();
  });

  it("does not steal Space from a button", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    screen.getByRole("button", { name: /next/i }).focus();
    await user.keyboard(" ");
    expect(label(2)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto play" })).toBeInTheDocument();
  });

  it("ignores keys typed in an input, select or contenteditable", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="field" />
        <div contentEditable suppressContentEditableWarning data-testid="ce">
          <span>x</span>
        </div>
        <DiagramView flow={flow} />
      </>
    );
    await user.click(screen.getByLabelText("field"));
    await user.keyboard("{ArrowRight} {End}");
    screen.getByRole("combobox", { name: "Playback speed" }).focus();
    await user.keyboard("{ArrowRight}");
    fireEvent.keyDown(screen.getByText("x"), { key: "ArrowRight" });
    expect(label(1)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto play" })).toBeInTheDocument();
  });

  it("ignores shortcuts with a modifier and unrelated keys", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.keyboard("{Meta>}{ArrowRight}{/Meta}a");
    expect(label(1)).toBeInTheDocument();
  });
});

describe("tab semantics", () => {
  it("exposes a tablist of tabs with a roving tabindex and a labelled tabpanel", () => {
    render(<DiagramView flow={flow} />);
    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist", { name: "Steps" })).toBeInTheDocument();
    expect(tabs).toHaveLength(total);
    tabs.forEach((t, i) => {
      expect(t).toHaveAttribute("aria-selected", String(i === 0));
      expect(t).toHaveAttribute("tabindex", i === 0 ? "0" : "-1");
      const controlled = document.getElementById(t.getAttribute("aria-controls")!);
      expect(controlled).toBe(screen.getByRole("tabpanel"));
    });
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[0].id);
    expect(
      screen.getByRole("tabpanel", { name: tabs[0].getAttribute("aria-label")! })
    ).toBeTruthy();
  });

  it("moves selection and focus with the arrow keys, Home and End inside the tablist", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    tab(1).focus();
    await user.keyboard("{ArrowRight}");
    expect(label(2)).toBeInTheDocument();
    expect(tab(2)).toHaveFocus();
    expect(tab(2)).toHaveAttribute("aria-selected", "true");
    expect(tab(2)).toHaveAttribute("tabindex", "0");
    expect(tab(1)).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{End}");
    expect(tab(total)).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tab(total)).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tab(total - 1)).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tab(1)).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(label(1)).toBeInTheDocument();
    await user.keyboard("{Control>}{ArrowRight}{/Control}x");
    expect(label(1)).toBeInTheDocument();
  });

  it("announces the current step in a polite live region", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const live = () => document.querySelector("[aria-live='polite']")!;
    expect(live()).toHaveTextContent(`Step 1 of ${total}: ${flow.steps[0].title}`);
    await user.keyboard("{ArrowRight}");
    expect(live()).toHaveTextContent(`Step 2 of ${total}: ${flow.steps[1].title}`);
  });
});
