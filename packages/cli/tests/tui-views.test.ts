import { describe, expect, it } from "vitest";
import stringWidth from "string-width";
import { buildWaterfall, collectFindings, generateFlow } from "@htv/core";
import { lineText } from "../src/tui/lines";
import type { Line } from "../src/tui/lines";
import { findingsRegion } from "../src/tui/findings-view";
import { helpRegion } from "../src/tui/help-view";
import { requestRegion } from "../src/tui/request-view";
import { resourcesRegion } from "../src/tui/resources-view";
import { cacheRegion, hostsRegion } from "../src/tui/views";
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
