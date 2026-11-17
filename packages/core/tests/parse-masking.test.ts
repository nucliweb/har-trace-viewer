import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHar, parseHarPages, parseHarJson } from "../src/parsers/har-parser.js";
import { parseTrace } from "../src/parsers/trace-parser.js";
import { parseRecording } from "../src/parsers/recording.js";
import { SecretRules } from "../src/analysis/secret-rules.js";
import { buildWaterfall } from "../src/analysis/waterfall.js";
import { attributeLcp } from "../src/analysis/lcp.js";
import { analyzeMainThread } from "../src/analysis/main-thread.js";
import { FLOW_VERSION, generateFlow, normalizeFlow } from "../src/steps/step-generator.js";
import { redactFlow } from "../src/analysis/redact.js";
import type { Flow } from "../src/types.js";
import {
  secretHar,
  secretTrace,
  SECRETS,
  JWT_HEADER,
  FONT_URL,
  GTAG_URL,
} from "./helpers/secret-har.js";
import { firefoxEntry } from "./helpers/firefox-har.js";
import { wptHar } from "./helpers/wpt-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

type RawHar = Parameters<typeof parseHarPages>[0];

const leaks = (value: unknown) => {
  const json = JSON.stringify(value);
  return [...Object.values(SECRETS), JWT_HEADER, "jane.doe%40example.org"].filter((secret) =>
    json.includes(secret)
  );
};

const MASKED_DOCUMENT_URL =
  "https://shop.example.com/account?email=[email]&token=[redacted]&lang=en";
const MASKED_APP_JS_URL = "https://shop.example.com/app.js?key=[redacted]";
const MASKED_CHUNK_URL = "https://shop.example.com/chunk.js?sig=[redacted]";
const MASKED_STYLE_URL = "https://shop.example.com/styles.css?token=[redacted]";
const MASKED_HERO_URL = "https://shop.example.com/hero.jpg?auth=[redacted]&w=1200";

const harOf = () => parseHarPages(secretHar() as RawHar)[0];
const traceOf = () => parseTrace(secretTrace());

describe("a HAR, as it is read", () => {
  it("keeps none of its secrets", () => {
    expect(leaks(secretHar()).length).toBeGreaterThan(15);
    expect(leaks(harOf())).toEqual([]);
    expect(leaks(parseHar(secretHar() as RawHar))).toEqual([]);
    expect(leaks(parseRecording("har", JSON.stringify(secretHar())))).toEqual([]);
  });

  it("masks the secrets of the URLs, keeping their hosts, paths and other values", () => {
    expect(harOf().entries.map((e) => e.url)).toEqual([
      "https://shop.example.com/login?session=[redacted]&next=%2Faccount",
      MASKED_DOCUMENT_URL,
      "https://api.example.com/v1/profile?access_token=[redacted]&lang=en",
      "https://tracker.vendor-one.io/pixel.gif?uid=[redacted]&sig=[redacted]&page=home",
      FONT_URL,
      "https://shop.example.com/avatars/[email]/logo@2x.png",
      GTAG_URL,
      MASKED_STYLE_URL,
      MASKED_HERO_URL,
      "https://shop.example.com/reset/[redacted]",
    ]);
  });

  it("masks the page title, the redirect, the initiators and the Server-Timing description", () => {
    const har = harOf();

    expect(har.pages[0].title).toBe(MASKED_DOCUMENT_URL);
    expect(har.entries[0].redirectURL).toBe(MASKED_DOCUMENT_URL);
    expect(har.entries[2].initiator).toEqual({
      type: "script",
      url: MASKED_APP_JS_URL,
      lineNumber: 3,
    });
    expect(har.entries[3].initiator?.url).toBe(MASKED_APP_JS_URL);
    expect(har.entries[9].initiator?.url).toBe(MASKED_CHUNK_URL);
    expect(har.documentEntry.serverTiming).toEqual([
      { name: "app", dur: 25, desc: "/account?session=[redacted]" },
    ]);
  });

  it("still follows the redirect to the document the title names", () => {
    const har = harOf();

    expect(har.documentEntry).toBe(har.entries[1]);
    expect(har.documentRedirects).toEqual([har.entries[0]]);
  });

  it("masks the same URL the same way, with placeholders a redaction does not number", () => {
    const [a, b] = [harOf(), harOf()];
    expect(b.entries.map((e) => e.url)).toEqual(a.entries.map((e) => e.url));

    const flow = generateFlow([{ name: "Home", har: harOf() }]);
    const { flow: redacted, report } = redactFlow(flow);
    expect(redacted.pages[0].har.entries.map((e) => e.url)).toEqual(a.entries.map((e) => e.url));
    expect(report.queryParams).toBe(0);
  });

  it("keeps a real recording as recorded but for the client and session ids of its analytics beacon", () => {
    const json = readFileSync(
      join(__dirname, "fixtures/webperf-snippets.har.fixture.json"),
      "utf-8"
    );
    const raw = JSON.parse(json) as { log: { entries: { request: { url: string } }[] } };

    const har = parseHarJson(json);

    expect(har.entries.map((e) => e.url)).toEqual(
      raw.log.entries.map((e) => e.request.url.replace(/([?&](?:cid|sid)=)[^&]*/g, "$1[redacted]"))
    );
    expect(har.entries.filter((e) => e.url.includes("[redacted]"))).toHaveLength(1);
  });

  it("masks a WebPageTest HAR's titles, URLs and inferred cache hits", () => {
    const raw = { log: { ...wptHar().log, creator: { name: "WebPagetest" } } };
    const token = `token=${SECRETS.pageToken}`;
    raw.log.pages = raw.log.pages.map((page) => ({ ...page, title: `${page.title}?${token}` }));
    for (const entry of raw.log.entries) {
      entry.request.url = `${entry.request.url}?${token}`;
      Object.assign(entry.response, {
        headers: [{ name: "cache-control", value: "max-age=3600" }],
      });
    }

    const pages = parseHarPages(raw as RawHar);

    expect(leaks(pages)).toEqual([]);
    expect(pages[0].pages[0].title).toBe(
      "Run 1, First View for https://example.com/?token=[redacted]"
    );
    expect(pages[1].inferredCacheHits?.map((hit) => hit.url)).toEqual([
      "https://example.com/a2.js?token=[redacted]",
    ]);
  });

  it("masks a Firefox HAR's title, which is the document's title", () => {
    const raw = {
      log: {
        pages: [
          {
            id: "page_1",
            title: `Inbox of ${SECRETS.email}`,
            startedDateTime: "2026-01-01T00:00:00.000Z",
          },
        ],
        entries: [firefoxEntry(`https://mail.example.com/?user=${SECRETS.userId}`, "text/html")],
      },
    };

    const [har] = parseHarPages(raw as RawHar);

    expect(har.pages[0].title).toBe("Inbox of [email]");
    expect(har.documentEntry.url).toBe("https://mail.example.com/?user=[redacted]");
  });
});

describe("a trace, as it is read", () => {
  it("keeps none of its secrets", () => {
    expect(leaks(secretTrace()).length).toBeGreaterThan(5);
    expect(leaks(traceOf())).toEqual([]);
    expect(leaks(parseRecording("trace", JSON.stringify(secretTrace())))).toEqual([]);
  });

  it("masks the document, the requests and their initiators, the LCP image and the scripts", () => {
    const trace = traceOf();

    expect(trace.url).toBe(MASKED_DOCUMENT_URL);
    expect(trace.requests?.map((r) => [r.url, r.initiator?.url])).toEqual([
      [MASKED_DOCUMENT_URL, undefined],
      [MASKED_STYLE_URL, MASKED_DOCUMENT_URL],
      [MASKED_HERO_URL, MASKED_CHUNK_URL],
    ]);
    expect(trace.lcpCandidate).toMatchObject({
      url: MASKED_HERO_URL,
      nodeName: "IMG id='[email]'",
    });
    expect(trace.mainThread?.scripts.map((s) => s.url)).toEqual([
      MASKED_CHUNK_URL,
      MASKED_APP_JS_URL,
    ]);
    expect(trace.mainThread?.longTasks.map((t) => t.url)).toEqual([
      MASKED_CHUNK_URL,
      MASKED_APP_JS_URL,
    ]);
  });

  it("masks a request as the HAR does, so the two still match", () => {
    const har = harOf();
    const trace = traceOf();
    const rows = buildWaterfall(har, trace).rows;
    const row = (url: string) => rows.find((r) => r.url === url);

    expect(trace.url).toBe(har.documentEntry.url);
    expect(row(MASKED_HERO_URL)?.isLcpResource).toBe(true);
    expect(row(MASKED_STYLE_URL)?.renderBlocking).toBe(true);
    expect(attributeLcp(har, trace)?.resource).toMatchObject({
      url: MASKED_HERO_URL,
      transferSize: 1500,
    });
    expect(analyzeMainThread(har, trace).scripts[0]).toMatchObject({ url: MASKED_CHUNK_URL });
  });
});

// A flow of version 8, generated before the parsers masked URLs: its entries, title, trace and
// the analyses built from them hold the recorded values.
function versionEightFlow(): Flow {
  const raw = secretHar();
  const flow = generateFlow([{ name: "Home", har: harOf(), trace: traceOf() }]);
  const page = flow.pages[0];
  page.har.entries.forEach((entry, i) => (entry.url = raw.log.entries[i].request.url));
  page.har.pages[0].title = raw.log.pages[0].title;
  page.trace!.url = raw.log.entries[1].request.url;
  flow.steps[0].description = `Requested ${raw.log.entries[1].request.url}`;
  return { ...flow, version: 8 };
}

describe("the flow version", () => {
  it("is 9, the first whose recordings are masked as they are read", () => {
    expect(FLOW_VERSION).toBe(9);
    expect(generateFlow([{ name: "Home", har: harOf() }]).version).toBe(9);
  });

  it("masks the secrets of an older flow as it is read, leaving the flow given as it was", () => {
    const old = versionEightFlow();
    const copy = structuredClone(old);
    expect(leaks(old)).toEqual(
      expect.arrayContaining([SECRETS.pageToken, SECRETS.session, SECRETS.email])
    );

    const read = normalizeFlow(old);

    expect(leaks(read)).toEqual([]);
    expect(read.version).toBe(8);
    expect(read.pages[0].har.entries[1].url).toBe(MASKED_DOCUMENT_URL);
    expect(read.pages[0].trace?.url).toBe(MASKED_DOCUMENT_URL);
    expect(read.steps[0].description).toBe(`Requested ${MASKED_DOCUMENT_URL}`);
    expect(read.steps.map((s) => s.resourceRefs)).toEqual(old.steps.map((s) => s.resourceRefs));
    expect(old).toEqual(copy);
  });

  it("keeps the numbered placeholders and masked hosts of an older flow redacted for sharing", () => {
    const { flow: redacted } = redactFlow(versionEightFlow(), { hosts: "mask" });

    expect(normalizeFlow(redacted)).toEqual(normalizeFlow(structuredClone(redacted)));
    expect(normalizeFlow(redacted).pages[0].har.entries[1].url).toMatch(
      /^https:\/\/shop\.example\.com\/account\?email=\[email\]&token=\[redacted-\d+\]&lang=en$/
    );
  });

  it("reads a flow of the current version as it is", () => {
    const flow = generateFlow([{ name: "Home", har: harOf(), trace: traceOf() }]);

    expect(normalizeFlow(flow).pages).toBe(flow.pages);
  });
});

describe("a token in a path segment", () => {
  const rules = () => new SecretRules(false);

  it("is masked when the whole segment is 32 or more letters and digits of mixed case", () => {
    const masked = rules();
    expect(masked.text(`https://a.example/reset/${SECRETS.resetPath}`, "text")).toBe(
      "https://a.example/reset/[redacted]"
    );
    expect(masked.text(`https://a.example/invite/${SECRETS.resetPath}/accept?x=1`, "text")).toBe(
      "https://a.example/invite/[redacted]/accept?x=1"
    );
    expect(masked.report.tokens).toBe(2);
  });

  it.each([
    ["a hashed asset name", "https://a.example/_next/static/chunks/main-93d7eb3c1c216c38.js"],
    [
      "a font file named by a long id",
      "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff2",
    ],
    [
      "a hex fingerprint",
      "https://a.example/assets/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08/app.js",
    ],
    ["a long slug", "https://a.example/blog/how-to-measure-the-largest-contentful-paint-2026/"],
    ["a short id of mixed case", "https://a.example/watch/dQw4w9WgXcQ"],
  ])("leaves %s as it is", (_case, url) => {
    expect(rules().text(url, "text")).toBe(url);
  });
});
