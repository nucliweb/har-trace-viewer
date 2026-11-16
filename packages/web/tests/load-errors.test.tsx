import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { File as NodeFile } from "node:buffer";
import { gzipSync } from "node:zlib";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import {
  describeEntryError,
  isWordedByInterface,
} from "../src/components/flow-builder/page-entry.js";
import { ca } from "../src/i18n/ca.js";
import { en } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";
import { harJson, makeFile } from "./fixtures.js";
import { loadOnDemandModules } from "./lazy.js";

const html = document.documentElement;
const harInput = () => document.querySelector<HTMLInputElement>('input[accept^=".har,.gz"]')!;
const traceInput = () => document.querySelector<HTMLInputElement>('input[accept=".json,.gz"]')!;
const gz = (content: string, name: string) =>
  new NodeFile([gzipSync(content)], name) as unknown as File;

interface Case {
  code: string;
  /** Where the file is dropped and the file itself. */
  onTrace?: boolean;
  file: () => File;
  /** The error on the row, by language; a RegExp where the text carries a browser's detail. */
  en: string | RegExp;
  es: string | RegExp;
  ca: string | RegExp;
}

const cases: Case[] = [
  {
    code: "not-json",
    file: () => makeFile("{ not json", "site.har"),
    en: /^Not valid JSON: ./,
    es: /^No es un JSON válido: ./,
    ca: /^No és un JSON vàlid: ./,
  },
  {
    code: "unrecognized-json",
    file: () => makeFile('{"foo":1}', "site.har"),
    en: "This JSON is neither a HAR (log.entries) nor a Chrome trace (traceEvents or an event array).",
    es: "Este JSON no es ni un HAR (log.entries) ni una traza de Chrome (traceEvents o un array de eventos).",
    ca: "Aquest JSON no és ni un HAR (log.entries) ni una traça de Chrome (traceEvents o una matriu d'esdeveniments).",
  },
  {
    code: "wrong-kind (a trace as the HAR)",
    file: () => makeFile("[]", "site.har"),
    en: "This is a Chrome trace, not a HAR: load it with the Trace button.",
    es: "Esto es una traza de Chrome, no un HAR: cárgala con el botón Traza.",
    ca: "Això és una traça de Chrome, no un HAR: carrega-la amb el botó Traça.",
  },
  {
    code: "wrong-kind (a HAR as the trace)",
    onTrace: true,
    file: () => makeFile('{"log":{"entries":[]}}', "trace.json"),
    en: "This is a HAR, not a Chrome trace: load it as the page's HAR.",
    es: "Esto es un HAR, no una traza de Chrome: cárgalo como el HAR de la página.",
    ca: "Això és un HAR, no una traça de Chrome: carrega'l com a HAR de la pàgina.",
  },
  {
    code: "har-no-entries",
    file: () => makeFile('{"log":{"pages":[],"entries":[]}}', "site.har"),
    en: "HAR contains no entries",
    es: "El HAR no contiene ninguna entrada",
    ca: "L'HAR no conté cap entrada",
  },
  {
    code: "har-no-usable-entries",
    file: () => makeFile('{"log":{"entries":[{"foo":1}]}}', "site.har"),
    en: "No entry of the HAR has a request URL and a valid start time.",
    es: "Ninguna entrada del HAR tiene una URL de petición y una hora de inicio válida.",
    ca: "Cap entrada de l'HAR té una URL de petició i una hora d'inici vàlida.",
  },
  {
    code: "trace-no-navigation",
    onTrace: true,
    file: () => makeFile('{"traceEvents":[]}', "trace.json"),
    en: "No navigationStart found in trace",
    es: "No se ha encontrado navigationStart en la traza",
    ca: "No s'ha trobat navigationStart a la traça",
  },
  {
    code: "gzip-invalid",
    file: () => {
      const bytes = gzipSync(harJson);
      return new NodeFile([bytes.subarray(0, bytes.length - 20)], "site.har.gz") as unknown as File;
    },
    en: /^Could not decompress the file( \(.+\))?\. It may be truncated or not a gzip file\.$/,
    es: /^No se ha podido descomprimir el archivo( \(.+\))?\. Puede que esté incompleto o que no sea un archivo gzip\.$/,
    ca: /^No s'ha pogut descomprimir el fitxer( \(.+\))?\. Pot ser que estigui incomplet o que no sigui un fitxer gzip\.$/,
  },
];

// Parts of the app load on demand: load them before the tests use them (see lazy.ts).
beforeAll(loadOnDemandModules);

afterEach(() => {
  html.removeAttribute("lang");
  vi.unstubAllGlobals();
});

describe("file-loading errors in the interface language", () => {
  describe.each(cases)("$code", (c) => {
    it("is worded in English, Spanish and Catalan, and re-worded when the language changes", async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.upload(c.onTrace ? traceInput() : harInput(), c.file());

      const row = () => screen.getByText(c.en, { selector: "span" });
      expect(await screen.findByText(c.en, { selector: "span" })).toBeVisible();
      // The interface words it: no lang override of an English-only message.
      expect(row()).not.toHaveAttribute("lang");

      await user.keyboard("l");
      await waitFor(() => expect(html).toHaveAttribute("lang", "es"));
      expect(await screen.findByText(c.es, { selector: "span" })).toBeVisible();
      expect(screen.getByText(c.es, { selector: "span" })).not.toHaveAttribute("lang");

      await user.keyboard("l");
      await waitFor(() => expect(html).toHaveAttribute("lang", "ca"));
      expect(await screen.findByText(c.ca, { selector: "span" })).toBeVisible();

      await user.keyboard("l");
      await waitFor(() => expect(html).toHaveAttribute("lang", "en"));
      expect(await screen.findByText(c.en, { selector: "span" })).toBeVisible();
    });
  });

  it("words a browser without DecompressionStream in the interface language", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    const user = userEvent.setup();
    render(<App />);
    await user.upload(harInput(), gz(harJson, "site.har.gz"));

    expect(await screen.findByText(en.builder.parseErrors.gzipUnsupported)).toBeVisible();
    await user.keyboard("l");
    expect(
      await screen.findByText(
        "Este navegador no puede descomprimir archivos .gz (no tiene DecompressionStream): descomprime el archivo y vuelve a cargarlo."
      )
    ).toBeVisible();
    await user.keyboard("l");
    expect(
      await screen.findByText(
        "Aquest navegador no pot descomprimir fitxers .gz (no té DecompressionStream): descomprimeix el fitxer i torna'l a carregar."
      )
    ).toBeVisible();
  });

  it("keeps an error without a known code as the English message, marked as English", async () => {
    const t = es.builder;
    expect(describeEntryError({ kind: "message", message: "Disk on fire" }, t)).toBe(
      "Disk on fire"
    );
    expect(
      describeEntryError({ kind: "parse", code: "from-the-future", params: {}, message: "Odd" }, t)
    ).toBe("Odd");
    expect(
      describeEntryError(
        { kind: "parse", code: "har-no-entries", params: {}, message: "x" },
        ca.builder
      )
    ).toBe(ca.builder.parseErrors.harNoEntries);
    // Also a code that is a property of every object.
    const odd = { kind: "parse", code: "toString", params: {}, message: "Odd" } as const;
    expect(describeEntryError(odd, es.builder)).toBe("Odd");
    expect(isWordedByInterface(odd)).toBe(false);
    expect(isWordedByInterface({ kind: "message", message: "x" })).toBe(false);
    expect(
      isWordedByInterface({ kind: "parse", code: "wrong-kind", params: {}, message: "x" })
    ).toBe(true);
    expect(isWordedByInterface({ kind: "har-extension" })).toBe(true);
  });

  it("shows an English-only message marked as English inside a Spanish interface", async () => {
    // A plain Error from the reading of a file has no code.
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard("l");
    await waitFor(() => expect(html).toHaveAttribute("lang", "es"));
    const input = harInput();
    const broken = {
      name: "site.har",
      size: 1,
      stream: () => {
        throw new Error("Disk on fire");
      },
    } as unknown as File;
    await user.upload(input, broken);

    expect(await screen.findByText("Disk on fire", { selector: "span" })).toHaveAttribute(
      "lang",
      "en"
    );
  });
});
