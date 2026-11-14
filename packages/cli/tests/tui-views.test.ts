import { describe, expect, it } from "vitest";
import stringWidth from "string-width";
import { buildWaterfall, collectFindings, generateFlow } from "@htv/core";
import { lineText } from "../src/tui/lines";
import type { Line } from "../src/tui/lines";
import { findingsRegion } from "../src/tui/findings-view";
import { helpRegion } from "../src/tui/help-view";
import { requestRegion } from "../src/tui/request-view";
import { resourcesRegion } from "../src/tui/resources-view";
import { cacheRegion, hostsRegion, overviewRegion } from "../src/tui/views";
import { waterfallRegion } from "../src/tui/waterfall-view";
import {
  criticalCss,
  makeEntry,
  makeHar,
  makeTrace,
  thirdPartyScript,
} from "../../core/tests/helpers/synthetic-har";

const text = (lines: Line[]) => lines.map(lineText).join("\n");
const lineWith = (lines: Line[], needle: string) =>
  lines.find((l) => lineText(l).includes(needle)) ?? [];

const script = makeEntry({
  url: "https://cdn.example.com/static/js/a-rather-long-bundle-name-that-wraps.js?v=1234567890",
  method: "GET",
  startTime: 120,
  timing: { blocked: 4, dns: 10, connect: 32, ssl: 12, send: 1, wait: 40, receive: 13 },
  ttfb: 40,
  mimeType: "application/javascript",
  resourceType: "script",
  priority: "High",
  httpVersion: "h2",
  contentEncoding: "br",
  transferSize: 12_000,
  bodySize: 48_000,
  responseHeaders: { "cache-control": "max-age=31536000, immutable", "x-cache": "HIT" },
});

function page() {
  const har = makeHar([criticalCss(100), script, thirdPartyScript(300)]);
  const trace = {
    ...makeTrace(150, 400),
    requests: [
      {
        url: "https://example.com/critical-100.css",
        resourceType: "Stylesheet",
        renderBlocking: "blocking",
        sentAtMs: 100,
      },
    ],
  };
  return { har, trace, waterfall: buildWaterfall(har, trace) };
}

const listState = { search: "", searching: false, party: null };

describe("the row cursor", () => {
  it("points at the cursor row of the waterfall and inverts its text, not its bar", () => {
    const { waterfall } = page();
    const { lines } = waterfallRegion(
      waterfall,
      waterfall.rows,
      { ...listState, axis: "end", cursor: 1 },
      100
    );
    const row = lineWith(lines, "critical-100.css");

    expect(lineText(row)).toMatch(/^│▸B {2}critical-100\.css/);
    expect(row.find((s) => s.text.includes("critical-100.css"))).toMatchObject({ inverse: true });
    expect(row.filter((s) => /[░▒█▓]/.test(s.text)).every((s) => !s.inverse)).toBe(true);
    expect(lineText(lineWith(lines, "example.com"))).toMatch(/^│ /);
  });

  it("points at the cursor row of the resources and inverts it", () => {
    const { waterfall } = page();
    const { lines } = resourcesRegion(
      waterfall.rows.length,
      waterfall.rows,
      { ...listState, sort: { key: "start", direction: "asc" }, cursor: 3 },
      120
    );
    const row = lineWith(lines, "tag-300.js");

    expect(lineText(row)).toMatch(/^│▸/);
    const content = row.slice(2, -1).filter((s) => s.text.trim());
    expect(content.length).toBeGreaterThan(5);
    expect(content.every((s) => s.inverse)).toBe(true);
  });

  it("names Enter among the keys of the request lists", () => {
    const { waterfall } = page();
    const { lines } = waterfallRegion(
      waterfall,
      waterfall.rows,
      { ...listState, axis: "end" },
      100
    );
    expect(text(lines)).toContain("Enter details");
  });
});

describe("the request detail", () => {
  const detail = (width: number) => {
    const { har, waterfall } = page();
    const row = waterfall.rows.find((r) => r.url === script.url)!;
    return requestRegion(row, har.entries[row.entryIndex], { index: 2, count: 4 }, width);
  };

  it("shows the whole URL, wrapped to the panel, and its position in the list", () => {
    const lines = detail(60);
    const body = lines.map(lineText).map((l) => l.slice(2, -2).trimEnd());

    expect(lineText(lines[0])).toContain("Request 3 of 4");
    expect(body.join("")).toContain(script.url);
    for (const line of lines) expect(stringWidth(lineText(line))).toBe(60);
  });

  it("lists the facts the report keeps about the request", () => {
    const all = text(detail(100));

    expect(all).toMatch(/Method\s+GET/);
    expect(all).toMatch(/Status\s+200/);
    expect(all).toMatch(/Type\s+script · application\/javascript/);
    expect(all).toMatch(/Priority\s+High/);
    expect(all).toMatch(/Protocol\s+h2/);
    expect(all).toMatch(/Host\s+cdn\.example\.com/);
    expect(all).toMatch(/Party\s+first/);
    expect(all).toMatch(/Transfer\s+12 KB/);
    expect(all).toMatch(/Content\s+48 KB/);
    expect(all).toMatch(/Encoding\s+br/);
    expect(all).toMatch(/Cache\s+network/);
    expect(all).toMatch(/Start\s+120 ms/);
    expect(all).toMatch(/LCP resource\s+no/);
    expect(all).toMatch(/Render blocking\s+no/);
  });

  it("draws each timing phase with its duration and a bar in the waterfall's glyphs", () => {
    const lines = detail(100);
    const phase = (name: string) => lineText(lineWith(lines, `${name} `));

    expect(phase("Blocked")).toMatch(/Blocked\s+4 ms\s+░+/);
    expect(phase("DNS")).toMatch(/DNS\s+10 ms\s+▒+/);
    expect(phase("Connect")).toMatch(/Connect\s+20 ms\s+▒+/);
    expect(phase("TLS")).toMatch(/TLS\s+12 ms\s+▒+/);
    expect(phase("Wait")).toMatch(/Wait \(TTFB\)\s+40 ms\s+█+/);
    expect(phase("Receive")).toMatch(/Receive\s+13 ms\s+▓+/);
    // Each bar starts where the phase before it ended.
    expect(phase("DNS").indexOf("▒")).toBeGreaterThan(phase("Blocked").indexOf("░"));
    expect(text(lines)).toMatch(/Total\s+100 ms/);
  });

  it("lists the response headers the report keeps, and says that it keeps only some", () => {
    const all = text(detail(100));

    expect(all).toContain("Response headers · 2");
    expect(all).toMatch(/cache-control: max-age=31536000, immutable/);
    expect(all).toMatch(/x-cache: HIT/);
    expect(all).toContain("allow-list");
  });

  it("flags the LCP resource and the render-blocking requests", () => {
    const { har, waterfall } = page();
    const row = waterfall.rows.find((r) => r.url.endsWith("critical-100.css"))!;
    const all = text(requestRegion(row, har.entries[row.entryIndex], { index: 1, count: 4 }, 100));

    expect(all).toMatch(/Render blocking\s+yes/);
  });

  it("says where a cached response came from instead of drawing empty phases", () => {
    const har = makeHar([{ ...criticalCss(100), fromCache: "disk" as const }]);
    const waterfall = buildWaterfall(har);
    const row = waterfall.rows[1];
    const all = text(requestRegion(row, har.entries[row.entryIndex], { index: 1, count: 2 }, 80));

    expect(all).toMatch(/Cache\s+disk cache/);
    expect(all).toContain("Served from the browser's disk cache");
  });
});

describe("the findings evidence", () => {
  const flow = () =>
    generateFlow([
      {
        name: "Broken",
        har: makeHar(
          [1, 2, 3, 4, 5].map((n) =>
            makeEntry({ url: `https://example.com/missing-${n}.js`, status: 404 })
          )
        ),
      },
    ]);

  it("says how to show the evidence rows beyond the first three", () => {
    const all = text(findingsRegion(collectFindings(flow()), 120));
    expect(all).not.toContain("missing-4.js");
    expect(all).toContain("… 2 more (e shows all)");
  });

  it("shows every evidence row when expanded", () => {
    const all = text(findingsRegion(collectFindings(flow()), 120, true));
    expect(all).toContain("missing-4.js");
    expect(all).toContain("missing-5.js");
    expect(all).not.toContain("more (e");
  });
});

describe("the hosts' columns", () => {
  const flow = () => generateFlow([{ name: "Hosts", har: makeHar([thirdPartyScript(300)]) }]);

  it("keeps the host column and says that more columns exist on a narrow terminal", () => {
    const { lines, maxOffset } = hostsRegion(flow(), 0, 80);
    const all = text(lines);

    expect(maxOffset).toBeGreaterThan(0);
    expect(all).toMatch(/Host\s+Requests\s+Cached/);
    expect(all).not.toContain("Party");
    expect(all).toMatch(/more columns ▸ {2}< > scroll/);
    for (const line of lines.filter((l) => l.length > 0)) {
      expect(stringWidth(lineText(line))).toBe(80);
    }
  });

  it("scrolls the columns after the host", () => {
    const { lines } = hostsRegion(flow(), 0, 80, 20);
    const all = text(lines);

    expect(all).toMatch(/Host\s+.*Party/);
    expect(all).not.toMatch(/Host\s+Requests/);
    expect(all).toMatch(/example\.com\s/);
    expect(all).toMatch(/◂ \d+ more columns? {2}< > scroll/);
  });

  it("draws every column without a note when they fit", () => {
    const { lines, maxOffset } = hostsRegion(flow(), 0, 200);
    expect(maxOffset).toBe(0);
    expect(text(lines)).not.toContain("< > scroll");
  });
});

describe("the help", () => {
  it("lists the keys of the cursor, the details, the evidence and the columns", () => {
    const all = text(helpRegion(120));

    expect(all).toMatch(/↑\/↓, PgUp\/PgDn, Home\/End, Space\s+scroll, or move the cursor/);
    expect(all).toMatch(/Enter\s+the details of the request under the cursor/);
    expect(all).toMatch(/n\/N\s+the next and previous request/);
    expect(all).toMatch(/e\s+all the evidence of the findings/);
    expect(all).toMatch(/< >\s+scroll the columns/);
    expect(all).toMatch(/q, Ctrl\+C\s+quit; q closes the help and the details first/);
  });
});

// An API capture: JSON only, no page timings, so no entry is the page's HTML document.
function apiCapture() {
  const api = (path: string, startTime: number) =>
    makeEntry({
      url: `https://api.example.cn/${path}`,
      startTime,
      mimeType: "application/json",
      resourceType: "fetch",
    });
  const primary = api("v1/session", 0);
  const base = makeHar([]);
  return {
    ...base,
    pages: [{ id: "p", title: "API", onContentLoad: null, onLoad: null }],
    entries: [primary, api("v1/items", 300)],
    documentEntry: primary,
  };
}

describe("the waterfall legend", () => {
  const legend = (har: ReturnType<typeof makeHar>, trace?: ReturnType<typeof makeTrace>) => {
    const waterfall = buildWaterfall(har, trace);
    const hasDocument = har.documentEntry.isDocument;
    return text(
      waterfallRegion(waterfall, waterfall.rows, { ...listState, axis: "end" }, 120, {
        hasDocument,
      }).lines
    );
  };

  it("names the LCP resource and render-blocking flags for a page with a document and a trace", () => {
    const { har, trace } = page();

    expect(legend(har, trace)).toMatch(/L LCP resource\s+B render-blocking/);
  });

  it("leaves the LCP flag out without a trace, since only a trace names an LCP resource", () => {
    const shown = legend(makeHar([criticalCss(100)]));

    expect(shown).not.toContain("LCP resource");
    expect(shown).toContain("B render-blocking");
  });

  it("names neither flag for a page without an HTML document", () => {
    const shown = legend(apiCapture(), makeTrace(150, 400));

    expect(shown).not.toContain("LCP resource");
    expect(shown).not.toContain("render-blocking");
    expect(shown).toContain("request/wait");
  });

  it("does the same in the resources table", () => {
    const { waterfall } = page();
    const state = { ...listState, sort: { key: "start" as const, direction: "asc" as const } };
    const shown = (options: { hasDocument?: boolean; hasLcp?: boolean }) =>
      text(resourcesRegion(waterfall.rows.length, waterfall.rows, state, 100, options).lines);

    expect(shown({})).toMatch(/L LCP resource\s+B render-blocking/);
    expect(shown({ hasLcp: false })).not.toContain("LCP resource");
    expect(shown({ hasLcp: false })).toContain("B render-blocking");
    expect(shown({ hasDocument: false })).not.toContain("LCP resource");
    expect(shown({ hasDocument: false })).not.toContain("render-blocking");
  });
});

describe("the overview of a page without an HTML document", () => {
  const rows = (flow: Parameters<typeof overviewRegion>[0]) => text(overviewRegion(flow, 0, 100));

  it("lists no metric that needs a document, and keeps the ones that do not", () => {
    const shown = rows(generateFlow([{ name: "API", har: apiCapture() }]));

    for (const label of ["TTFB", "Server wait", "FCP", "LCP", "CLS", "INP", "TBT", "DCL", "onLoad"])
      expect(shown).not.toContain(label);
    expect(shown).not.toContain("n/a");
    expect(shown).toMatch(/Requests\s+2/);
    expect(shown).toContain("Transfer");
  });

  it("still shows a metric the capture does carry", () => {
    const har = {
      ...apiCapture(),
      pages: [{ id: "p", title: "API", onContentLoad: 90, onLoad: 120 }],
    };
    const shown = rows(generateFlow([{ name: "API", har }]));

    expect(shown).toMatch(/DCL\s+90 ms/);
    expect(shown).toMatch(/onLoad\s+120 ms/);
    expect(shown).not.toContain("TTFB");
  });

  it("keeps n/a for the metrics a page with a document has no trace for", () => {
    const shown = rows(generateFlow([{ name: "Page", har: makeHar([criticalCss(100)]) }]));

    for (const label of ["FCP", "LCP", "CLS", "INP", "TBT"])
      expect(shown).toMatch(new RegExp(`${label}\\s+n/a`));
    expect(shown).toMatch(/TTFB \(from navigation\)\s+81 ms/);
  });
});

describe("the request names", () => {
  it("shows a percent-encoded CJK name as text in the waterfall and the resources", () => {
    const har = makeHar([
      makeEntry({ url: "https://example.cn/%E9%9D%99%E6%80%81/%E6%A0%B7%E5%BC%8F%E8%A1%A8.css" }),
    ]);
    const waterfall = buildWaterfall(har);
    const wf = text(
      waterfallRegion(waterfall, waterfall.rows, { ...listState, axis: "end" }, 100).lines
    );
    const res = text(
      resourcesRegion(
        waterfall.rows.length,
        waterfall.rows,
        { ...listState, sort: { key: "start", direction: "asc" } },
        100
      ).lines
    );

    expect(wf).toContain("样式表.css");
    expect(res).toContain("样式表.css");
    expect(wf + res).not.toContain("%E6");
  });

  it("keeps the full URL of the detail exactly as recorded", () => {
    const url = "https://example.cn/%E9%9D%99/%E6%A0%B7%E5%BC%8F%E8%A1%A8.css?a=%2F";
    const har = makeHar([makeEntry({ url })]);
    const row = buildWaterfall(har).rows[1];
    const shown = requestRegion(row, har.entries[row.entryIndex], { index: 1, count: 2 }, 120)
      .map(lineText)
      .map((l) => l.slice(2, -2).trimEnd())
      .join("");

    expect(shown).toContain(url);
  });
});

describe("the timing phases of a request", () => {
  const phases = (receive: number) => {
    const har = makeHar([
      makeEntry({
        timing: { dns: 0, connect: 0, ssl: 0, send: 1, wait: 40, receive, blocked: 0 },
      }),
    ]);
    const row = buildWaterfall(har).rows[1];
    return requestRegion(row, har.entries[row.entryIndex], { index: 1, count: 2 }, 100);
  };

  it("reads a phase under a millisecond as <1 ms and still draws its cell", () => {
    const receive = lineText(lineWith(phases(0.3), "Receive "));

    expect(receive).toMatch(/Receive\s+<1 ms\s+▓/);
  });

  it("draws no cell for a phase that took no time", () => {
    const receive = lineText(lineWith(phases(0), "Receive "));

    expect(receive).toMatch(/Receive\s+0 ms/);
    expect(receive).not.toContain("▓");
  });
});

describe("cacheRegion", () => {
  const report = () =>
    generateFlow([{ name: "Cache", har: makeHar([criticalCss(100)]) }]).pageAnalyses[0].cacheReport;

  it("titles the first panel Document for a page with an HTML document", () => {
    expect(text(cacheRegion(report(), 80))).toContain("─ Document ─");
  });

  it("calls it the primary request for a page without one, as an API capture", () => {
    const shown = text(cacheRegion(report(), 80, undefined, { hasDocument: false }));
    expect(shown).toContain("─ Primary request ─");
    expect(shown).not.toContain("Document");
  });
});
