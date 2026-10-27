import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  RESPONSE_HEADER_ALLOW_LIST,
  RESPONSE_HEADER_ALLOW_PREFIXES,
  parseHar,
  pickResponseHeaders,
} from "../src/parsers/har-parser.js";
import { generateFlow } from "../src/steps/step-generator.js";
import { getStepCacheResources, getStepResources } from "../src/steps/step-resources.js";
import type { Flow, ParsedHar } from "../src/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

type RawHar = Parameters<typeof parseHar>[0];

const FIXTURES = {
  chrome: join(__dirname, "fixtures/webperf-snippets.har.fixture.json"),
  noCache: join(
    __dirname,
    "../../../fixtures/webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har"
  ),
  cache: join(
    __dirname,
    "../../../fixtures/webperf-snippets.nucliweb.net_Cache-20260519T123746.har"
  ),
};

function loadRaw(path: string): RawHar {
  return JSON.parse(readFileSync(path, "utf8")) as RawHar;
}

// Test-only path: the same parse with every response header restored, as the
// parser produced it before the allow-list existed.
function parseUnfiltered(raw: RawHar): ParsedHar {
  const parsed = parseHar(raw);
  const entries = parsed.entries.map((entry, i) => {
    const responseHeaders: Record<string, string> = {};
    for (const h of raw.log.entries![i].response.headers) {
      responseHeaders[h.name.toLowerCase()] = h.value;
    }
    return { ...entry, responseHeaders };
  });
  const documentEntry = entries[parsed.entries.indexOf(parsed.documentEntry)];
  return { ...parsed, entries, documentEntry };
}

// Everything a reader of the flow sees, with step resources compared by identity-free content.
function observable(flow: Flow) {
  return {
    hints: flow.hints,
    pageAnalyses: flow.pageAnalyses,
    preconnectHints: flow.pages.map((p) => p.har.preconnectHints),
    steps: flow.steps.map((step) => ({
      ...step,
      resources: getStepResources(flow, step).map((e) => e.url),
      cacheResources: getStepCacheResources(flow, step).map((e) => e.url),
    })),
  };
}

describe("pickResponseHeaders", () => {
  it("keeps allow-listed headers and drops the rest", () => {
    const picked = pickResponseHeaders({
      "cache-control": "max-age=60",
      age: "3",
      server: "Vercel",
      "x-matched-path": "/",
      "content-disposition": "inline",
      "referrer-policy": "no-referrer",
      "strict-transport-security": "max-age=63072000",
    });

    expect(picked).toEqual({ "cache-control": "max-age=60", age: "3", server: "Vercel" });
  });

  it("keeps any header with a CDN prefix", () => {
    const headers = {
      "x-cache-something": "HIT",
      "x-akamai-request-id": "1",
      "cf-anything": "x",
      "x-amz-cf-whatever": "y",
      "x-vercel-new-header": "z",
    };

    expect(pickResponseHeaders(headers)).toEqual(headers);
  });

  it("matches header names case-insensitively and returns them lowercased", () => {
    expect(pickResponseHeaders({ "Cache-Control": "no-store", "X-Foo": "1" })).toEqual({
      "cache-control": "no-store",
    });
  });

  it("allows every header the analyzers read", () => {
    const read = [
      "age",
      "cache-control",
      "cf-cache-status",
      "cf-ray",
      "fly-request-id",
      "link",
      "server",
      "via",
      "x-akamai-transformed",
      "x-amz-cf-pop",
      "x-amz-id-2",
      "x-amz-request-id",
      "x-azure-ref",
      "x-cache",
      "x-cache-status",
      "x-fastly-request-id",
      "x-ms-request-id",
      "x-msedge-ref",
      "x-vercel-cache",
      "x-vercel-id",
    ];
    const headers = Object.fromEntries(read.map((name) => [name, "v"]));

    expect(Object.keys(pickResponseHeaders(headers)).sort()).toEqual(read);
  });

  it("exposes the allow-list and prefixes in lowercase", () => {
    for (const name of [...RESPONSE_HEADER_ALLOW_LIST, ...RESPONSE_HEADER_ALLOW_PREFIXES]) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

describe("parsed HAR response headers", () => {
  it("only carry allow-listed headers", () => {
    const { entries } = parseHar(loadRaw(FIXTURES.chrome));

    for (const entry of entries) {
      expect(entry.responseHeaders).toEqual(pickResponseHeaders(entry.responseHeaders));
    }
    const names = new Set(entries.flatMap((e) => Object.keys(e.responseHeaders)));
    expect(names.has("x-matched-path")).toBe(false);
    expect(names.has("content-disposition")).toBe(false);
    expect(names.has("cache-control")).toBe(true);
    expect(names.has("x-vercel-cache")).toBe(true);
  });

  for (const [name, path] of Object.entries(FIXTURES)) {
    it(`leave detection and cache analysis unchanged on the ${name} fixture`, () => {
      const raw = loadRaw(path);
      const filtered = parseHar(raw);
      const unfiltered = parseUnfiltered(raw);
      expect(JSON.stringify(unfiltered).length).toBeGreaterThan(JSON.stringify(filtered).length);

      for (const clientRegion of ["default", "cn"] as const) {
        const before = generateFlow([{ name: "Home", har: unfiltered }], { clientRegion });
        const after = generateFlow([{ name: "Home", har: filtered }], { clientRegion });
        expect(observable(after)).toEqual(observable(before));
      }
    });
  }
});
