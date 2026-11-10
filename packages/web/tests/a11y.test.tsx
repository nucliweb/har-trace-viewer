import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { getStepResources } from "@htv/core";
import { describe, expect, it } from "vitest";
import { CompareView } from "../src/components/CompareView.js";
import { DiagramView } from "../src/components/DiagramView.js";
import { ca } from "../src/i18n/ca.js";
import { MessagesContext } from "../src/i18n/context.js";
import { en } from "../src/i18n/en.js";
import type { Messages } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";
import { makeCompareFlows, makeFlow } from "./fixtures.js";

const flow = makeFlow();
const [a, b] = makeCompareFlows();
const inLanguage = (messages: Messages, children: ReactNode) => (
  <MessagesContext.Provider value={messages}>{children}</MessagesContext.Provider>
);

// Each toolbar drawer: the toggle that opens it and the ✕ that closes it.
const DRAWERS: [RegExp, string][] = [
  [/^Toggle findings/, "Close findings"],
  [/^Toggle waterfall$/, "Close waterfall"],
  [/^Toggle hops$/, "Close hops"],
  [/^Toggle metrics summary$/, "Close metrics summary"],
  [/^Toggle cache analysis$/, "Close cache analysis"],
];

describe("drawers and the keyboard (A-01)", () => {
  it("closing a drawer with its ✕ hands the focus back to its toggle", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    for (const [toggle, close] of DRAWERS) {
      const button = screen.getByRole("button", { name: toggle });
      await user.click(button);
      await user.click(screen.getByRole("button", { name: close }));
      expect(screen.queryByRole("button", { name: close })).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    }
  });

  it("Escape closes the open drawer and hands the focus back to its toggle", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    for (const [toggle, close] of DRAWERS) {
      const button = screen.getByRole("button", { name: toggle });
      await user.click(button);
      // From inside the drawer as well as from the toolbar.
      screen.getByRole("button", { name: close }).focus();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("button", { name: close })).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    }
  });

  it("the resource list closes the same way, back to its button", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const step = flow.steps.findIndex((s) => getStepResources(flow, s).length > 0);
    await user.click(screen.getByRole("tab", { name: new RegExp(`^Step ${step + 1}:`) }));
    const button = screen.getByRole("button", { name: "View resource list" });

    await user.click(button);
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("Escape in the export menu closes the menu only", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.click(screen.getByRole("button", { name: /^Toggle findings/ }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close findings" })).toBeInTheDocument();
  });

  it("in a comparison, each pane's drawer and the deltas close back to their toggle", async () => {
    const user = userEvent.setup();
    render(<CompareView a={a} b={b} />);
    const paneB = screen.getByRole("region", { name: /^B · / });
    const cache = within(paneB).getByRole("button", { name: "Toggle cache analysis" });

    await user.click(cache);
    await user.click(within(paneB).getByRole("button", { name: "Close cache analysis" }));
    expect(cache).toHaveFocus();

    await user.click(cache);
    await user.keyboard("{Escape}");
    expect(within(paneB).queryByRole("button", { name: "Close cache analysis" })).toBeNull();
    expect(cache).toHaveFocus();

    const deltas = screen.getByRole("button", { name: "Toggle deltas" });
    await user.click(deltas);
    await user.click(screen.getByRole("button", { name: "Close deltas" }));
    expect(deltas).toHaveFocus();
    await user.click(deltas);
    await user.keyboard("{Escape}");
    expect(deltas).toHaveAttribute("aria-expanded", "false");
  });
});

describe("scrolling areas reachable by keyboard (A-02)", () => {
  it("the filter syntax help and the resource list are focusable, named regions", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.click(screen.getByRole("button", { name: "Toggle waterfall" }));
    await user.click(screen.getByText("Filter syntax"));
    expect(screen.getByRole("region", { name: "Filter syntax" })).toHaveAttribute("tabindex", "0");
    await user.click(screen.getByRole("button", { name: "Close waterfall" }));

    await user.click(screen.getByRole("tab", { name: new RegExp(`^Step ${flow.steps.length}:`) }));
    await user.click(screen.getByRole("button", { name: "View resource list" }));
    expect(screen.getByRole("region", { name: "All resources" })).toHaveAttribute("tabindex", "0");
  });
});

// The visible words of a control, without arrows, icons or digits.
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("visible text inside the accessible name, in every language (A-03)", () => {
  for (const messages of [en, es, ca]) {
    it(`${messages.lang}: every named button of the diagram and the comparison`, async () => {
      const user = userEvent.setup();
      const { unmount } = render(inLanguage(messages, <DiagramView flow={flow} />));
      const check = () => {
        for (const button of screen.getAllByRole("button")) {
          const label = button.getAttribute("aria-label");
          const visible = words(button.textContent ?? "");
          if (!label || !visible) continue;
          expect(words(label), `"${label}" should hold "${visible}"`).toContain(visible);
        }
      };
      check();
      await user.click(screen.getByRole("button", { name: messages.steps.autoPlay }));
      check();
      unmount();
      render(inLanguage(messages, <CompareView a={a} b={b} />));
      check();
    });
  }
});

describe("English analysis texts marked as English (A-04)", () => {
  it("marks the step, the findings and the recommendations in Spanish", async () => {
    const user = userEvent.setup();
    render(inLanguage(es, <DiagramView flow={flow} />));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(flow.steps[0].title)).toHaveAttribute("lang", "en");
    expect(within(panel).getByText(flow.steps[0].description)).toHaveAttribute("lang", "en");

    await user.click(screen.getByRole("button", { name: /^Mostrar u ocultar los hallazgos/ }));
    const findings = screen.getByRole("region", { name: "Detalles de los hallazgos" });
    const titles = findings.querySelectorAll("li > div > div:first-child");
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(title.closest("[lang]")).toHaveAttribute("lang", "en");

    await user.click(
      screen.getByRole("button", { name: "Mostrar u ocultar el análisis de caché" })
    );
    const cache = screen.getByRole("region", { name: "Detalles del análisis de caché" });
    const recommendation = flow.pageAnalyses[0].cacheReport.recommendations[0];
    expect(within(cache).getByText(recommendation.label).closest("[lang]")).toHaveAttribute(
      "lang",
      "en"
    );
  });

  it("leaves English alone when the interface is English", () => {
    render(<DiagramView flow={flow} />);
    expect(screen.getByText(flow.steps[0].title).closest("[lang]")).toBeNull();
  });
});

describe("the diagram as an image of the step (A-07)", () => {
  it("is named by the step title and described by its description", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    const diagram = screen.getByRole("img", { name: flow.steps[0].title });
    expect(diagram).toHaveAccessibleDescription(flow.steps[0].description);

    await user.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByRole("img", { name: flow.steps[1].title })).toBe(diagram);
  });

  it("names each diagram of a comparison by its side and step", () => {
    render(<CompareView a={a} b={b} />);
    const imgs = screen.getAllByRole("img");
    expect(imgs.map((img) => img.getAttribute("aria-label"))).toEqual([
      `A · ${a.pages[0].name}: ${a.steps[0].title}`,
      `B · ${b.pages[0].name}: ${b.steps[0].title}`,
    ]);
  });
});

describe("toolbar toggles report their state (A-09)", () => {
  it("every drawer toggle of the diagram says whether its drawer is open", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    for (const [toggle] of DRAWERS) {
      const button = screen.getByRole("button", { name: toggle });
      expect(button).toHaveAttribute("aria-expanded", "false");
      await user.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      await user.click(button);
    }
  });
});

describe("the waterfall tooltip can be dismissed (A-08)", () => {
  it("Escape hides the tooltip first, then closes the drawer", async () => {
    const user = userEvent.setup();
    render(<DiagramView flow={flow} />);
    await user.click(screen.getByRole("button", { name: "Toggle waterfall" }));
    const rows = within(screen.getByRole("list", { name: /^Requests, / })).getAllByRole("button");

    // A tooltip shown by the pointer, with the focus elsewhere.
    await user.hover(rows[1]);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close waterfall" })).toBeInTheDocument();
    await user.unhover(rows[1]);

    // A tooltip shown by the focus: it hides and the row keeps the focus.
    act(() => rows[2].focus());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(rows[2]).toHaveFocus();
    expect(rows[2]).not.toHaveAttribute("aria-describedby");

    // With no tooltip left, Escape closes the drawer.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Close waterfall" })).not.toBeInTheDocument();
  });
});
