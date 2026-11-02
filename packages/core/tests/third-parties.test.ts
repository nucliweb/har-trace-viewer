import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { analyzeThirdParties } from "../src/analysis/third-parties.js";
import { identifyThirdParty } from "../src/analysis/third-party-entities.js";
import { collectFindings } from "../src/analysis/findings.js";
import { generateFlow } from "../src/steps/step-generator.js";
import type { HarEntry, ParsedTrace, ThirdPartyReport } from "../src/types.js";
import { makeEntry, makeHar, makeTrace } from "./helpers/synthetic-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixture = (name: string) =>
  parseHarJson(readFileSync(join(__dirname, `fixtures/${name}`), "utf8"));

// A third-party script of `bytes` on the wire, sent at `startTime`.
function script(url: string, startTime: number, bytes = 10_000, over: Partial<HarEntry> = {}) {
  return makeEntry({
    url,
    startTime,
    mimeType: "application/javascript",
    resourceType: "script",
    priority: "Low",
    transferSize: bytes,
    bodySize: bytes,
    ...over,
  });
}

const own = (path: string, bytes = 10_000) =>
  makeEntry({ url: `https://example.com/${path}`, transferSize: bytes, bodySize: bytes });

const byName = (report: ThirdPartyReport, name: string) =>
  report.entities.find((e) => e.name === name);
const labels = (report: ThirdPartyReport) => report.recommendations.map((r) => r.label);

describe("identifyThirdParty", () => {
  it("names the known services of a host and its category", () => {
    expect(identifyThirdParty("https://www.googletagmanager.com/gtm.js?id=GTM-1")).toEqual({
      name: "Google Tag Manager",
      category: "tag-manager",
      known: true,
    });
    expect(identifyThirdParty("https://region1.google-analytics.com/g/collect")).toMatchObject({
      name: "Google Analytics",
      category: "analytics",
    });
    expect(identifyThirdParty("https://cdn.cookielaw.org/scripttemplates/otSDKStub.js")).toEqual({
      name: "OneTrust",
      category: "consent",
      known: true,
    });
    expect(identifyThirdParty("https://fonts.gstatic.com/s/inter/v12/x.woff2").name).toBe(
      "Google Fonts"
    );
  });

  it("matches subdomains of a catalogue host, not look-alike domains", () => {
    expect(identifyThirdParty("https://eu.cdn.debugbear.com/rum.js").name).toBe("DebugBear");
    expect(identifyThirdParty("https://notgoogletagmanager.com/x.js").known).toBe(false);
  });

  it("tells reCAPTCHA apart from the rest of google.com by its path", () => {
    expect(identifyThirdParty("https://www.google.com/recaptcha/api.js").name).toBe("reCAPTCHA");
    expect(identifyThirdParty("https://www.google.com/maps/embed").name).not.toBe("reCAPTCHA");
  });

  it("falls back to the registrable domain for an unknown host", () => {
    expect(identifyThirdParty("https://widgets.acme-partner.co.uk/w.js")).toEqual({
      name: "acme-partner.co.uk",
      category: "other",
      known: false,
    });
  });
});

describe("analyzeThirdParties", () => {
  it("groups the third-party requests of a page by entity, biggest first", () => {
    const har = makeHar([
      own("app.js", 50_000),
      script("https://www.googletagmanager.com/gtm.js", 100, 40_000),
      script("https://www.google-analytics.com/analytics.js", 200, 20_000),
      script("https://region1.google-analytics.com/g/collect", 300, 500, { method: "POST" }),
      script("https://widgets.acme-partner.com/w.js", 400, 60_000),
    ]);
    const report = analyzeThirdParties(har, undefined);

    expect(report.entities.map((e) => e.name)).toEqual([
      "acme-partner.com",
      "Google Tag Manager",
      "Google Analytics",
    ]);
    expect(byName(report, "Google Analytics")).toMatchObject({
      category: "analytics",
      known: true,
      hosts: ["www.google-analytics.com", "region1.google-analytics.com"],
      requests: 2,
      bytes: 20_500,
    });
    expect(byName(report, "acme-partner.com")).toMatchObject({ known: false, category: "other" });
  });

  it("leaves the document and own resources out and counts browser-cache hits apart", () => {
    const har = makeHar([
      own("app.js"),
      script("https://cdn.third.com/a.js", 100, 10_000),
      script("https://cdn.third.com/b.js", 150, 10_000, { fromCache: "disk", transferSize: 0 }),
    ]);
    const report = analyzeThirdParties(har, undefined);
    expect(report.entities).toHaveLength(1);
    expect(report.entities[0]).toMatchObject({ requests: 1, bytes: 10_000, cacheHits: 1 });
    // The document (makeHar's example.com) and app.js are first party.
    expect(report.page).toEqual({ requests: 3, bytes: 10_000 + 10_000 + 1024 });
    expect(report.totals.requests).toBe(1);
  });

  it("splits requests at the load event, every request before it when the event never fired", () => {
    const entries = [
      script("https://cdn.third.com/early.js", 100, 10_000),
      script("https://cdn.third.com/late.js", 900, 30_000),
    ];
    const report = analyzeThirdParties(
      makeHar(entries, { onContentLoad: 300, onLoad: 500 }),
      undefined
    );
    expect(report.entities[0].beforeLoad).toEqual({ requests: 1, bytes: 10_000 });
    expect(report.entities[0].afterLoad).toEqual({ requests: 1, bytes: 30_000 });
    expect(report.totals.beforeLoad).toEqual({ requests: 1, bytes: 10_000 });

    const noLoad = analyzeThirdParties(
      makeHar(entries, { onContentLoad: null, onLoad: null }),
      undefined
    );
    expect(noLoad.entities[0].beforeLoad).toEqual({ requests: 2, bytes: 40_000 });
    expect(noLoad.entities[0].afterLoad).toEqual({ requests: 0, bytes: 0 });
  });

  it("counts the requests of an entity that held the first paint", () => {
    const har = makeHar([
      script("https://cdn.cookielaw.org/otSDKStub.js", 50, 20_000, { priority: "High" }),
      script("https://cdn.third.com/async.js", 60, 5_000),
    ]);
    const trace: ParsedTrace = {
      ...makeTrace(400, 800),
      requests: [
        { url: "https://cdn.cookielaw.org/otSDKStub.js", sentAtMs: 50, renderBlocking: "blocking" },
        { url: "https://cdn.third.com/async.js", sentAtMs: 60, renderBlocking: "non_blocking" },
      ],
    };
    const report = analyzeThirdParties(har, trace);
    expect(byName(report, "OneTrust")?.renderBlocking).toBe(1);
    expect(byName(report, "third.com")?.renderBlocking).toBe(0);
    expect(report.totals.renderBlocking).toBe(1);
  });

  it("measures the share of the page's network requests and bytes that go to third parties", () => {
    const har = makeHar([
      own("app.js", 30_000), // + the 1 KB document
      script("https://cdn.third.com/a.js", 100, 31_024),
    ]);
    const report = analyzeThirdParties(har, undefined);
    expect(report.page).toEqual({ requests: 3, bytes: 62_048 });
    expect(report.requestShare).toBeCloseTo(1 / 3);
    expect(report.byteShare).toBeCloseTo(0.5);
  });

  describe("recommendations", () => {
    it("says so when the page has no third-party requests", () => {
      const report = analyzeThirdParties(makeHar([own("app.js")]), undefined);
      expect(report.entities).toEqual([]);
      expect(report.recommendations).toEqual([
        expect.objectContaining({ label: "No third-party requests", severity: "good" }),
      ]);
    });

    it("rates light third parties as good", () => {
      const har = makeHar([
        ...["app.js", "vendor.js", "styles.css", "hero.jpg", "logo.svg"].map((f) => own(f, 40_000)),
        script("https://www.google-analytics.com/analytics.js", 600, 5_000),
      ]);
      const report = analyzeThirdParties(har, undefined);
      expect(labels(report)).toEqual(["Third parties are light"]);
    });

    it("warns when third parties dominate the page weight, critical past 60%", () => {
      const warn = analyzeThirdParties(
        makeHar([own("app.js", 500_000), script("https://cdn.third.com/a.js", 100, 500_000)]),
        undefined
      );
      const dominate = warn.recommendations.find(
        (r) => r.label === "Third parties dominate the page weight"
      );
      expect(dominate?.severity).toBe("warning");
      expect(dominate?.description).toMatch(/50%/);
      expect(dominate?.resources?.[0]).toMatchObject({
        url: "https://cdn.third.com/",
        transferSize: 500_000,
        detail: expect.stringContaining("1 request"),
      });

      const critical = analyzeThirdParties(
        makeHar([own("app.js", 100_000), script("https://cdn.third.com/a.js", 100, 900_000)]),
        undefined
      );
      expect(
        critical.recommendations.find((r) => r.label === "Third parties dominate the page weight")
          ?.severity
      ).toBe("critical");
    });

    it("does not call a few hundred third-party bytes dominant on a cached repeat view", () => {
      const repeat = makeHar([
        { ...own("app.js", 0), fromCache: "disk" as const },
        script("https://www.google-analytics.com/g/collect", 100, 300, { method: "POST" }),
      ]);
      const report = analyzeThirdParties(repeat, undefined);
      expect(report.byteShare).toBeGreaterThan(0.2);
      expect(labels(report)).not.toContain("Third parties dominate the page weight");
    });

    it("flags the third-party requests that ran before the load event", () => {
      const entries = Array.from({ length: 12 }, (_, i) =>
        script(`https://cdn.third.com/${i}.js`, 100 + i, 10_000)
      );
      const report = analyzeThirdParties(makeHar([own("app.js", 500_000), ...entries]), undefined);
      const rec = report.recommendations.find(
        (r) => r.label === "Third-party requests before the load event"
      );
      expect(rec).toMatchObject({ severity: "warning" });
      expect(rec?.description).toMatch(/12 third-party requests \(120 KB\) ran before onLoad/);
    });

    it("reports a consent manager, as a warning when it holds the first paint", () => {
      const cmp = script("https://cdn.cookielaw.org/otSDKStub.js", 50, 20_000, {
        priority: "High",
      });
      const har = makeHar([own("app.js", 500_000), cmp]);
      const quiet = analyzeThirdParties(har, {
        ...makeTrace(400, 800),
        requests: [{ url: cmp.url, sentAtMs: 50, renderBlocking: "non_blocking" }],
      });
      expect(quiet.consentManager).toBe("OneTrust");
      const info = quiet.recommendations.find((r) => r.label === "Consent manager on the page");
      expect(info).toMatchObject({ severity: "info" });
      expect(info?.description).toMatch(/OneTrust/);
      expect(info?.description).toMatch(/htv before\.har --compare-with after\.har/);

      const blocking = analyzeThirdParties(har, {
        ...makeTrace(400, 800),
        requests: [{ url: cmp.url, sentAtMs: 50, renderBlocking: "blocking" }],
      });
      expect(
        blocking.recommendations.find((r) => r.label === "Consent manager on the page")?.severity
      ).toBe("warning");
    });
  });

  it("attributes the third parties of the webperf-snippets recording", () => {
    const report = analyzeThirdParties(fixture("webperf-snippets.har.fixture.json"), undefined);
    expect(report.entities.map((e) => e.name).sort()).toEqual(
      ["Cloudinary", "DebugBear", "Google Analytics", "Google Tag Manager"].sort()
    );
    expect(byName(report, "DebugBear")?.category).toBe("analytics");
    expect(report.consentManager).toBeNull();
  });
});

describe("findings from the third-party report", () => {
  it("carry the thirdParty source and stable rule ids", () => {
    const har = makeHar([
      own("app.js", 10_000),
      script("https://cdn.cookielaw.org/otSDKStub.js", 50, 20_000),
      script("https://cdn.third.com/a.js", 100, 90_000),
    ]);
    const flow = generateFlow([{ name: "Home", har }]);
    const findings = collectFindings(flow).filter((f) => f.source === "thirdParty");
    expect(findings.map((f) => f.id).sort()).toEqual(
      ["consent-manager", "third-party-weight"].sort()
    );
    expect(findings.find((f) => f.id === "third-party-weight")).toMatchObject({
      metric: "transfer",
      severity: "critical",
    });
    expect(flow.pageAnalyses[0].thirdPartyReport?.entities).toHaveLength(2);
  });
});
