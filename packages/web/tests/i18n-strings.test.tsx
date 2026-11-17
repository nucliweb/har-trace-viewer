import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeCacheForHar } from "@htv/core";
import { App } from "../src/App.js";
import { AnalysisPanel } from "../src/components/AnalysisPanel.js";
import { CachePanel } from "../src/components/CachePanel.js";
import { CompareView } from "../src/components/CompareView.js";
import { ExportMenu } from "../src/components/ExportMenu.js";
import { ca } from "../src/i18n/ca.js";
import { MessagesContext } from "../src/i18n/context.js";
import { es } from "../src/i18n/es.js";
import { LOCALE_STORAGE_KEY } from "../src/i18n/useLocale.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";
import { analysisJourney } from "./analysis-flow.js";
import { harJson, makeCompareFlows, makeFile, makeFlow } from "./fixtures.js";
import { loadOnDemandModules } from "./lazy.js";

const analysis = vi.hoisted(() => ({ fail: false }));

vi.mock("@htv/core", async (importActual) => {
  const actual = await importActual<typeof import("@htv/core")>();
  return {
    ...actual,
    generateFlow: (...args: Parameters<typeof actual.generateFlow>) => {
      if (analysis.fail) throw new Error("analysis failed");
      return actual.generateFlow(...args);
    },
  };
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  analysis.fail = false;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const languages = [
  ["Spanish", es, "es"],
  ["Catalan", ca, "ca"],
] as const;

// Parts of the app load on demand: load them before the tests use them (see lazy.ts).
beforeAll(loadOnDemandModules);

describe.each(languages)("translated strings in %s", (name, messages, locale) => {
  it(`labels the primary request of a capture without a document in ${name}`, () => {
    render(
      <MessagesContext.Provider value={messages}>
        <CachePanel
          report={analyzeCacheForHar(makeHar([makeEntry()]))}
          hasDocument={false}
          pageLabel="Page"
          onClose={() => undefined}
        />
      </MessagesContext.Provider>
    );
    expect(screen.getByText(messages.cache.primaryRequest)).toBeInTheDocument();
    expect(screen.queryByText(messages.cache.document)).not.toBeInTheDocument();
    expect(messages.cache.primaryRequest).not.toBe("Primary request");
  });

  it(`words the analysis views, their tables and what a page lacks in ${name}`, async () => {
    const user = userEvent.setup();
    const flow = analysisJourney();
    const panel = (view: "connections" | "render", page: number) => (
      <MessagesContext.Provider value={messages}>
        <AnalysisPanel
          view={view}
          onViewChange={() => undefined}
          analysis={flow.pageAnalyses[page]}
          hasDocument={page === 0}
          hasTrace={page === 0}
          pageLabel="Page"
          onClose={() => undefined}
        />
      </MessagesContext.Provider>
    );
    const { rerender } = render(panel("connections", 0));
    const t = messages.analysis;
    expect(screen.getByRole("group", { name: t.views })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: t.connections.caption });
    expect(
      within(table).getByRole("columnheader", { name: messages.hops.requests })
    ).toBeInTheDocument();
    expect(t.connections.caption).not.toBe("Connections per host");

    rerender(panel("render", 0));
    expect(screen.getByRole("table", { name: t.render.phasesCaption })).toBeInTheDocument();
    rerender(panel("render", 1));
    expect(screen.getByText(t.noDocument)).toBeInTheDocument();
    expect(t.noDocument).not.toMatch(/^This page/);
    await user.click(screen.getByRole("button", { name: t.close }));
  });

  it(`words the requests of a comparison in ${name}`, async () => {
    const user = userEvent.setup();
    const [a, b] = makeCompareFlows();
    render(
      <MessagesContext.Provider value={messages}>
        <CompareView a={a} b={b} />
      </MessagesContext.Provider>
    );
    const t = messages.deltas;
    await user.click(screen.getByRole("button", { name: messages.compare.toggleDeltas }));
    const views = screen.getByRole("group", { name: t.views });
    await user.click(within(views).getByRole("button", { name: t.view.requests }));

    const table = screen.getByRole("table", { name: t.requestsCaption });
    expect(within(table).getByRole("columnheader", { name: t.timeA })).toBeInTheDocument();
    expect(
      within(table).getAllByText(`${t.source.network} → ${t.source.browser}`, { exact: false })
    ).toHaveLength(2);
    const filters = screen.getByRole("group", { name: t.requestFilters });
    await user.click(within(filters).getByRole("button", { name: `${t.requestFilter.removed} 2` }));
    expect(within(table).getAllByText(t.removed)).toHaveLength(2);
    expect(screen.getByText(t.pairedRequests(3, 0))).toBeInTheDocument();
    expect(t.requestsCaption).not.toBe("Request deltas");
  });

  it(`words the export menu and the redaction note in ${name}`, async () => {
    const user = userEvent.setup();
    const download = vi.fn();
    render(
      <MessagesContext.Provider value={messages}>
        <ExportMenu flow={makeFlow()} download={download} />
      </MessagesContext.Provider>
    );
    await user.click(screen.getByRole("button", { name: messages.export.button }));
    const menu = screen.getByRole("menu", { name: messages.export.menu });
    const group = within(menu).getByRole("group", { name: messages.export.maskHostsGroup });
    await user.click(
      within(group).getByRole("menuitemcheckbox", { name: messages.export.maskHosts })
    );
    await user.click(within(menu).getByRole("menuitem", { name: messages.export.csv }));

    expect(screen.getByRole("status")).toHaveTextContent(`${messages.export.masked} `);
    expect(messages.export.masked).not.toBe("Masked:");
  });

  it(`tells a failed generation in ${name}`, async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    render(<App />);
    // The language loads on demand: wait for it before the file goes in.
    await screen.findByRole("button", { name: messages.app.help }, { timeout: 5000 });
    const input = document.querySelector<HTMLInputElement>('input[accept^=".har,.gz"]')!;
    await user.upload(input, makeFile(harJson, "site.har"));
    analysis.fail = true;

    const generate = screen.getByRole("button", { name: messages.builder.generateDiagram });
    // The parser loads on demand: the button enables once the file has been read.
    await waitFor(() => expect(generate).toBeEnabled(), { timeout: 5000 });
    await user.click(generate);

    // The analysis module loads on demand too.
    const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(alert).toHaveTextContent(messages.errors.generate);
    expect(messages.errors.generate).not.toMatch(/^Could not generate/);
  });
});
