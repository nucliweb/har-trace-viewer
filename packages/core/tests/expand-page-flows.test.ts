import { describe, it, expect } from "vitest";
import { parseHarPages } from "../src/parsers/har-parser.js";
import { expandPageFlows } from "../src/steps/expand-page-flows.js";
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
});
