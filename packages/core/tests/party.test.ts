import { describe, it, expect } from "vitest";
import { analyzeHops } from "../src/analysis/hops.js";
import { analyzeMainThread } from "../src/analysis/main-thread.js";
import { analyzeRenderBlocking } from "../src/analysis/critical-path.js";
import { isOwnResource, isThirdParty } from "../src/analysis/network-requests.js";
import { buildWaterfall } from "../src/analysis/waterfall.js";
import { getRootDomain } from "../src/utils/domain.js";
import type { MainThreadProfile, ParsedTrace } from "../src/types.js";
import { makeEntry, makeHar, makeTrace } from "./helpers/synthetic-har.js";

// Every place that tells the page's own requests from the third parties asks the same question:
// does the URL's registrable domain differ from the document's? These inputs run it through each
// call site, so the sites cannot drift apart.
const DOCUMENT = "https://www.example.co.uk/";
const ROOT = getRootDomain(DOCUMENT);

const CASES: [string, "first" | "third"][] = [
  ["https://www.example.co.uk/app.js", "first"],
  ["https://cdn.static.example.co.uk/app.js", "first"],
  ["https://WWW.EXAMPLE.CO.UK/app.js", "first"],
  ["https://example.co.uk:8443/app.js", "first"],
  ["https://other.co.uk/app.js", "third"],
  ["https://example.com/app.js", "third"],
  ["https://notexample.co.uk/app.js", "third"],
  ["https://192.0.2.10/app.js", "third"],
  ["http://localhost:3000/app.js", "third"],
  ["https://[2001:db8::1]/app.js", "third"],
  ["data:text/javascript,1", "third"],
  ["not a url", "third"],
];

const profile = (urls: string[]): MainThreadProfile => ({
  busyMs: 100,
  byCategory: { scripting: 100, rendering: 0, painting: 0, parsing: 0, gc: 0, other: 0 },
  scripts: urls.map((url) => ({ url, ms: 10, blockingMs: 0, tasks: 1 })),
  longTasks: [],
  tbtMs: 0,
  tbtFromMs: 0,
  tbtToMs: 1000,
  tbtEndedBy: "recording",
  extensionMs: 0,
});

describe("first and third party across the call sites", () => {
  const entries = CASES.map(([url]) =>
    makeEntry({ url, resourceType: "script", mimeType: "application/javascript" })
  );
  const har = makeHar(entries);
  har.documentEntry.url = DOCUMENT;
  har.entries[0].url = DOCUMENT;

  it("isThirdParty and isOwnResource agree on every input", () => {
    for (const [url, party] of CASES) {
      expect(isThirdParty({ url }, ROOT), url).toBe(party === "third");
      expect(isOwnResource(makeEntry({ url }), ROOT), url).toBe(party === "first");
    }
  });

  it("labels the waterfall rows", () => {
    const rows = buildWaterfall(har).rows;
    expect(rows.slice(1).map((r) => [r.url, r.party])).toEqual(CASES);
  });

  it("labels the hosts of the hosts table", () => {
    const hops = analyzeHops(har, DOCUMENT);
    for (const [url, party] of CASES) {
      const host = new URL(url, "https://x/").hostname;
      if (!url.startsWith("http")) continue;
      expect(hops.find((h) => h.host === host)?.party, url).toBe(party);
    }
  });

  it("labels the scripts of the main-thread report", () => {
    const trace: ParsedTrace = {
      ...makeTrace(100, 400),
      mainThread: profile(CASES.map(([u]) => u)),
    };
    const report = analyzeMainThread(har, trace);
    expect(report.scripts.map((s) => [s.url, s.party])).toEqual(CASES);
  });

  it("flags the third-party blocking resources of the render-blocking report", () => {
    const trace: ParsedTrace = {
      ...makeTrace(100, 400),
      requests: CASES.map(([url], i) => ({
        url,
        resourceType: "Script",
        priority: "VeryHigh",
        renderBlocking: "blocking",
        sentAtMs: i,
        startMs: i,
        endMs: i + 1,
      })),
    };
    const report = analyzeRenderBlocking(har, trace);
    expect(report.resources.map((r) => [r.url, r.thirdParty ? "third" : "first"])).toEqual(CASES);
  });
});
