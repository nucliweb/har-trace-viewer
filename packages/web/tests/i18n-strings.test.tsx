import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeCacheForHar } from "@htv/core";
import { App } from "../src/App.js";
import { CachePanel } from "../src/components/CachePanel.js";
import { ExportMenu } from "../src/components/ExportMenu.js";
import { ca } from "../src/i18n/ca.js";
import { MessagesContext } from "../src/i18n/context.js";
import { es } from "../src/i18n/es.js";
import { LOCALE_STORAGE_KEY } from "../src/i18n/useLocale.js";
import { makeEntry, makeHar } from "../../core/tests/helpers/synthetic-har";
import { harJson, makeFile, makeFlow } from "./fixtures.js";

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
    const group = within(menu).getByRole("group", { name: messages.export.redactGroup });
    expect(within(group).getAllByRole("menuitemradio")).toHaveLength(3);
    await user.click(
      within(group).getByRole("menuitemradio", { name: messages.export.redactSecrets })
    );
    await user.click(within(menu).getByRole("menuitem", { name: messages.export.csv }));

    expect(screen.getByRole("status")).toHaveTextContent(`${messages.export.redacted} `);
    expect(messages.export.redacted).not.toBe("Redacted:");
  });

  it(`tells a failed generation in ${name}`, async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    render(<App />);
    // The language loads on demand: wait for it before the file goes in.
    await screen.findByRole("button", { name: messages.app.help }, { timeout: 5000 });
    const input = document.querySelector<HTMLInputElement>('input[accept=".har,.gz"]')!;
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
