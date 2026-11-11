import { render, screen, within } from "@testing-library/react";
import { collectFindings, generateFlow, getStepResources } from "@htv/core";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DiagramView } from "../src/components/DiagramView.js";
import { criticalCss, makeHar, secondaryImage } from "../../core/tests/helpers/synthetic-har";
import { makeCompareFlows, makeFlow, makeWptRepeatView } from "./fixtures.js";

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

  it("leaves the step keys to an open dialog", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DiagramView flow={flow} />
        <dialog open aria-label="Settings" />
      </>
    );

    await user.keyboard("{ArrowRight}");
    expect(screen.getByText(`Step 1 / ${flow.steps.length}`)).toBeInTheDocument();
  });

  it("leaves Space and the arrows to a focused checkbox", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DiagramView flow={flow} />
        <input type="checkbox" aria-label="Option" />
      </>
    );
    const option = screen.getByRole("checkbox", { name: "Option" });
    option.focus();

    await user.keyboard(" {ArrowRight}");
    expect(option).toBeChecked();
    expect(screen.getByText(`Step 1 / ${flow.steps.length}`)).toBeInTheDocument();
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

  it("puts the findings first in the toolbar, with a count of what needs fixing", () => {
    render(<DiagramView flow={flow} />);
    const toolbar = document.querySelector<HTMLElement>("[class*=toolbar]")!;
    const [first] = within(toolbar).getAllByRole("button");
    const findings = collectFindings(flow).filter((f) => f.page.index === 0);
    const urgent = findings.filter((f) => f.severity === "critical" || f.severity === "warning");

    const count = urgent.length > 0 ? ` ${urgent.length}` : "";
    expect(first).toHaveAccessibleName(`Toggle findings${count}`);
    expect(first).toHaveTextContent(`Findings${count}`);
  });

  it("opens and closes the findings panel of the page", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);

    await user.click(screen.getByRole("button", { name: /^Toggle findings/ }));
    expect(screen.getByRole("region", { name: "Findings details" })).toBeInTheDocument();
    expect(screen.getByText(`Page 1 · ${flow.pages[0].name}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Toggle cache analysis" }));
    expect(screen.queryByRole("region", { name: "Findings details" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Toggle findings/ }));
    await user.click(screen.getByRole("button", { name: "Close findings" }));
    expect(screen.queryByRole("region", { name: "Findings details" })).not.toBeInTheDocument();
  });

  it("puts the waterfall right after the findings and opens it for the page", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const toolbar = document.querySelector<HTMLElement>("[class*=toolbar]")!;
    const [, second] = within(toolbar).getAllByRole("button");
    expect(second).toHaveAccessibleName("Toggle waterfall");
    expect(second).toHaveAttribute("aria-expanded", "false");

    await user.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "Waterfall details" });
    const requests = within(details).getAllByRole("listitem");
    expect(requests).toHaveLength(flow.pages[0].har.entries.length);
    expect(requests[0]).toHaveTextContent("document");

    await user.click(screen.getByRole("button", { name: /^Toggle findings/ }));
    expect(screen.queryByRole("region", { name: "Waterfall details" })).not.toBeInTheDocument();
  });

  it("shows the page's network report in the cache panel", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.click(screen.getByRole("button", { name: "Toggle cache analysis" }));
    expect(screen.getByRole("region", { name: "Network" })).toBeInTheDocument();
  });

  describe("resource sidebar", () => {
    const lastIndex = flow.steps.length - 1;

    async function openSidebar(user: ReturnType<typeof userEvent.setup>, index: number) {
      await goTo(user, index);
      await user.click(screen.getByRole("button", { name: "View resource list" }));
    }

    it("summarises every page resource on the last step, domains first", async () => {
      const user = userEvent.setup();
      render(<DiagramView flow={flow} />);
      await openSidebar(user, lastIndex);

      const expected = flow.pages[0].har.entries.length - 1;
      expect(screen.getByText("All resources")).toBeInTheDocument();
      expect(screen.getByText(`${expected} resources`)).toBeInTheDocument();
      expect(screen.getByText("First-party")).toBeInTheDocument();
      expect(screen.getByText("Third-party")).toBeInTheDocument();
      const labels = Array.from(document.querySelectorAll("[class*=groupLabel]")).map(
        (el) => el.textContent
      );
      expect(labels[0]).toBe("Domains");
      expect(labels.length).toBeGreaterThan(1);
    });

    it("keeps the step title and a plain domain list on other steps", async () => {
      const user = userEvent.setup();
      render(<DiagramView flow={flow} />);
      const index = flow.steps.findIndex((s, i) => i < lastIndex && s.resourceRefs?.length);
      await openSidebar(user, index);

      expect(screen.queryByText("All resources")).not.toBeInTheDocument();
      expect(screen.queryByText("First-party")).not.toBeInTheDocument();
      expect(screen.getByText("Domains")).toBeInTheDocument();
    });

    it("closes with the same button that opened it", async () => {
      const user = userEvent.setup();
      render(<DiagramView flow={flow} />);
      await openSidebar(user, lastIndex);
      const button = screen.getByRole("button", { name: "View resource list" });
      expect(button).toHaveAttribute("aria-expanded", "true");

      await user.click(button);
      expect(screen.queryByText("All resources")).not.toBeInTheDocument();
      expect(button).toHaveAttribute("aria-expanded", "false");
    });

    // Milestone steps (FCP, LCP) list no requests: the list stays on the last step that had some.
    it("keeps the last step's resources through a step without any", async () => {
      const user = userEvent.setup();
      render(<DiagramView flow={flow} />);
      const count = (i: number) => getStepResources(flow, flow.steps[i]).length;
      const listed = flow.steps.findIndex((_, i) => count(i) > 0 && count(i + 1) === 0);
      const later = flow.steps.findIndex((_, i) => i > listed + 1 && count(i) > 0);
      expect(listed).toBeGreaterThanOrEqual(0);
      expect(later).toBeGreaterThan(listed + 1);
      await openSidebar(user, listed);

      await goTo(user, listed + 1);
      expect(screen.getByText(`${count(listed)} resources`)).toBeInTheDocument();
      expect(screen.queryByText("0 resources")).not.toBeInTheDocument();
      const header = screen.getByText(`${count(listed)} resources`).parentElement!;
      expect(header).toHaveTextContent(flow.steps[listed].title);

      await goTo(user, later);
      expect(screen.getByText(`${count(later)} resources`)).toBeInTheDocument();
    });

    // Every drawer docks on the right: one opening closes the other, so none hides behind another.
    it("shares the right side with the toolbar panels", async () => {
      const user = userEvent.setup();
      render(<DiagramView flow={flow} />);
      const cacheLabel = `Page 1 · ${flow.pages[0].name}`;
      await openSidebar(user, lastIndex);

      await user.click(screen.getByRole("button", { name: "Toggle cache analysis" }));
      expect(screen.getByText(cacheLabel)).toBeInTheDocument();
      expect(screen.queryByText("All resources")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "View resource list" }));
      expect(screen.getByText("All resources")).toBeInTheDocument();
      expect(screen.queryByText(cacheLabel)).not.toBeInTheDocument();
    });
  });
});

describe("DiagramView — cache list beside the diagram", () => {
  const [, repeatView] = makeCompareFlows();
  // The cache list docks on the left: the diagram moves aside so the browser and its cache
  // stay in view.
  const diagram = () => document.querySelector("#diagram-svg")!.parentElement!;

  it("moves the diagram aside while a step lists cache hits, and back afterwards", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={repeatView} />);
    const critical = repeatView.steps.findIndex((s) => s.kind === "critical");
    expect(repeatView.steps[critical].cacheResourceRefs?.length).toBeGreaterThan(0);

    expect(diagram().className).not.toContain("diagramBesideCache");
    await goTo(user, critical);
    expect(screen.getByText("1 resources")).toBeInTheDocument();
    expect(diagram().className).toContain("diagramBesideCache");
    await goTo(user, 0);
    expect(diagram().className).not.toContain("diagramBesideCache");
  });
});

describe("DiagramView — inferred cache hits of a WebPageTest repeat view", () => {
  it("lists them in the cache list with an inferred badge and moves the diagram aside", async () => {
    const user = userEvent.setup();
    const flow = makeWptRepeatView();
    render(<DiagramView flow={flow} />);
    const critical = flow.steps.findIndex((s) => s.kind === "critical");

    await goTo(user, critical);
    const row = screen.getByTitle("https://example.com/app.css");
    expect(row).toHaveTextContent("app.css");
    expect(within(row).getByText("inferred")).toBeInTheDocument();
    expect(screen.getByText("1 resources")).toBeInTheDocument();
    expect(document.querySelector("#diagram-svg")!.parentElement!.className).toContain(
      "diagramBesideCache"
    );
  });
});

describe("DiagramView — cache hits whose store the HAR does not record", () => {
  it("shows them in the cache list with a plain cache badge", async () => {
    const user = userEvent.setup();
    const har = makeHar(
      [{ ...criticalCss(100), fromCache: "unknown" as const }, secondaryImage(200)],
      { onContentLoad: 150, onLoad: 200 }
    );
    const flow = generateFlow([{ name: "Playwright", har }]);
    render(<DiagramView flow={flow} />);

    await goTo(
      user,
      flow.steps.findIndex((s) => s.kind === "critical")
    );
    const row = screen.getByTitle("https://example.com/critical-100.css");
    expect(within(row).getByText("cache")).toBeInTheDocument();
  });
});
