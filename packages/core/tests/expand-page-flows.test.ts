import { describe, it, expect } from "vitest";
import { parseHarPages } from "../src/parsers/har-parser.js";
import {
  defaultSelectedPageIds,
  expandPageFlows,
  listHarPages,
  parsePageSelection,
} from "../src/steps/expand-page-flows.js";
import { wptHar } from "./helpers/wpt-har.js";
import type { ParsedTrace } from "../src/types.js";
import { firefoxHar, twoPageHar } from "./helpers/firefox-har.js";

const trace = (url: string | null): ParsedTrace => ({
  navigationStart: 0,
  fcp: null,
  lcp: null,
  cls: null,
  inp: null,
  navigationId: null,
  url,
});

describe("expandPageFlows", () => {
  it("keeps the given name for a single-page HAR", () => {
    const flows = expandPageFlows({ name: "Landing", har: parseHarPages(firefoxHar()) });
    expect(flows.map((f) => f.name)).toEqual(["Landing"]);
  });

  it("defaults to Page 1 for a single-page HAR without a name", () => {
    expect(expandPageFlows({ har: parseHarPages(firefoxHar()) })[0].name).toBe("Page 1");
  });

  it("names pages after their titles when no name was chosen", () => {
    const har = parseHarPages(twoPageHar());
    expect(expandPageFlows({ har }).map((f) => f.name)).toEqual(["Home", "Checkout"]);
    expect(expandPageFlows({ name: "Page 1", har }).map((f) => f.name)).toEqual([
      "Home",
      "Checkout",
    ]);
  });

  it("prefixes an explicit name", () => {
    const har = parseHarPages(twoPageHar());
    expect(expandPageFlows({ name: "Shop", har }).map((f) => f.name)).toEqual([
      "Shop · Home",
      "Shop · Checkout",
    ]);
  });

  it("attaches the trace to the page whose document URL matches, ignoring hash and trailing slash", () => {
    const har = parseHarPages(twoPageHar());
    const t = trace("https://example.com/checkout/#top");
    const flows = expandPageFlows({ har, trace: t });
    expect(flows[0].trace).toBeUndefined();
    expect(flows[1].trace).toBe(t);
  });

  it("falls back to the first page when no URL matches", () => {
    const har = parseHarPages(twoPageHar());
    const t = trace("https://other.com/");
    const flows = expandPageFlows({ har, trace: t });
    expect(flows[0].trace).toBe(t);
    expect(flows[1].trace).toBeUndefined();
  });

  describe("selection and WebPageTest names", () => {
    const har = () => parseHarPages(wptHar());

    it("lists the pages with id, title, url and entry count", () => {
      expect(listHarPages(har())).toEqual([
        {
          id: "page_1_0_1",
          title: "Run 1, First View for https://example.com/",
          url: "https://example.com/",
          entries: 3,
        },
        {
          id: "page_1_1_1",
          title: "Run 1, Repeat View for https://example.com/",
          url: "https://example.com/",
          entries: 2,
        },
        {
          id: "page_2_0_1",
          title: "Run 2, First View for https://example.com/",
          url: "https://example.com/",
          entries: 4,
        },
      ]);
    });

    it("shortens WebPageTest titles", () => {
      expect(expandPageFlows({ har: har() }).map((f) => f.name)).toEqual([
        "Run 1 · First view",
        "Run 1 · Repeat view",
        "Run 2 · First view",
      ]);
    });

    it("keeps only the pages with the given ids, in flow order", () => {
      const flows = expandPageFlows({
        har: har(),
        select: { pageIds: ["page_2_0_1", "page_1_0_1"] },
      });
      expect(flows.map((f) => f.name)).toEqual(["Run 1 · First view", "Run 2 · First view"]);
    });

    it("keeps a single selected page named after its title, not Page 1", () => {
      const flows = expandPageFlows({ har: har(), select: { pageIds: ["page_1_1_1"] } });
      expect(flows.map((f) => f.name)).toEqual(["Run 1 · Repeat view"]);
    });

    it("matches by case-insensitive substring or by RegExp", () => {
      const names = (match: string | RegExp) =>
        expandPageFlows({ har: har(), select: { match } }).map((f) => f.name);
      expect(names("run 1, first")).toEqual(["Run 1 · First view"]);
      expect(names(/^Run \d, First/)).toEqual(["Run 1 · First view", "Run 2 · First view"]);
      expect(names(/first/gi)).toHaveLength(2);
    });

    it("lists the available pages when an id is unknown", () => {
      expect(() => expandPageFlows({ har: har(), select: { pageIds: ["nope"] } })).toThrow(
        /Unknown page id: nope\. Available pages:\n\s+page_1_0_1 {2}Run 1, First View/
      );
    });

    it("fails with the list when a match selects nothing", () => {
      expect(() => expandPageFlows({ har: har(), select: { match: "zzz" } })).toThrow(
        /No page matches the selection[\s\S]*page_2_0_1/
      );
    });

    it("attaches the trace to a selected page", () => {
      const t = trace("https://example.com/");
      const flows = expandPageFlows({ har: har(), trace: t, select: { pageIds: ["page_2_0_1"] } });
      expect(flows[0].trace).toBe(t);
    });

    it("proposes only the first page of a WebPageTest export, all pages otherwise", () => {
      expect(defaultSelectedPageIds(har())).toEqual(["page_1_0_1"]);
      expect(defaultSelectedPageIds(parseHarPages(twoPageHar()))).toEqual(["page_1", "page_2"]);
    });

    describe("parsePageSelection", () => {
      it("reads comma-separated ids", () => {
        expect(parsePageSelection(har(), "page_1_0_1, page_2_0_1")).toEqual({
          pageIds: ["page_1_0_1", "page_2_0_1"],
        });
      });
      it("treats text containing a comma as a substring when it matches a title", () => {
        expect(parsePageSelection(har(), "Run 1, First")).toEqual({ match: "Run 1, First" });
      });
      it("falls back to a case-insensitive pattern", () => {
        const sel = parsePageSelection(har(), "run [12], first");
        expect(expandPageFlows({ har: har(), select: sel })).toHaveLength(2);
      });
    });
  });
});
