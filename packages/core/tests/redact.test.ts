import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { redactHar, redactFlow, redactFlows, describeRedaction } from "../src/analysis/redact.js";
import { parseHarPages, parseHarJson } from "../src/parsers/har-parser.js";
import { generateFlow } from "../src/steps/step-generator.js";
import { summarizeFlowMetrics } from "../src/analysis/metrics-summary.js";
import { findingsDocument } from "../src/analysis/findings.js";
import type { Flow } from "../src/types.js";
import {
  secretHar,
  SECRETS,
  DOCUMENT_URL,
  PIXEL_URL,
  FONT_URL,
  GTAG_URL,
  JWT_HEADER,
} from "./helpers/secret-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(__dirname, "../../../fixtures");
const REAL_HARS = [
  "webperf-snippets.nucliweb.net_Cache-20260519T123746.har",
  "webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har",
];

type RawHar = ReturnType<typeof secretHar>;
type RawEntry = RawHar["log"]["entries"][number];

const SECRET_VALUES = Object.values(SECRETS);
const leaks = (value: unknown) => {
  const json = JSON.stringify(value);
  return [...SECRET_VALUES, JWT_HEADER].filter((secret) => json.includes(secret));
};
const headerValue = (headers: { name: string; value: string }[], name: string) =>
  headers.find((h) => h.name === name)?.value;
const redacted = (options?: Parameters<typeof redactHar>[1]) =>
  redactHar(secretHar(), options) as {
    har: RawHar;
    report: ReturnType<typeof redactHar>["report"];
  };
const documentEntry = (har: RawHar) => har.log.entries[1];

const plain = (text: string) => text.replace(/\[redacted-\d+\]/g, "[redacted]");

const flowOf = (raw: unknown, name = "Home"): Flow =>
  generateFlow(
    parseHarPages(raw as Parameters<typeof parseHarPages>[0]).map((har) => ({ name, har }))
  );

describe("redactHar", () => {
  it("leaves none of the secrets in the HAR", () => {
    expect(leaks(secretHar()).length).toBeGreaterThan(10);
    expect(leaks(redacted().har)).toEqual([]);
  });

  it("keeps cookie names and masks their values with as many characters", () => {
    const { har, report } = redacted();
    const doc = documentEntry(har);

    expect(doc.request.cookies).toEqual([
      { name: "sid", value: "[redacted]*********" },
      { name: "theme", value: "****" },
    ]);
    expect(doc.response.cookies).toEqual([{ name: "sid", value: "[redacted]*********" }]);
    expect(headerValue(doc.request.headers, "cookie")).toBe("sid=[redacted]*********; theme=****");
    expect(headerValue(doc.request.headers, "cookie")).toHaveLength(
      `sid=${SECRETS.cookieSid}; theme=dark`.length
    );
    expect(headerValue(doc.response.headers, "set-cookie")).toBe(
      "sid=[redacted]*********; Path=/; HttpOnly; Secure"
    );
    // sid and theme in the cookie list and the Cookie header, sid in Set-Cookie and its list.
    expect(report.cookies).toBe(6);
  });

  it("redacts the values of credential headers and keeps their names", () => {
    const { har } = redacted();
    const headers = documentEntry(har).request.headers;

    expect(headerValue(headers, "authorization")).toBe("[redacted]");
    expect(headerValue(headers, "x-api-key")).toBe("[redacted]");
    expect(headerValue(headers, "x-csrf-token")).toBe("[redacted]");
    expect(headers.map((h) => h.name)).toEqual(
      secretHar().log.entries[1].request.headers.map((h) => h.name)
    );
  });

  it("redacts a JWT inside any other header", () => {
    const { har } = redacted();

    expect(headerValue(documentEntry(har).request.headers, "x-request-context")).toBe(
      "user=[redacted]"
    );
  });

  it("keeps CORS headers, whose names mention credentials", () => {
    const raw = secretHar();
    raw.log.entries[2].response.headers.push({
      name: "access-control-allow-credentials",
      value: "true",
    });
    const { har } = redactHar(raw) as { har: RawHar };

    expect(
      headerValue(har.log.entries[2].response.headers, "access-control-allow-credentials")
    ).toBe("true");
  });

  it("redacts raw header lines, as WebPageTest lists them", () => {
    const raw = {
      log: {
        entries: [
          {
            _headers: {
              request: [
                `Cookie: sid=${SECRETS.cookieSid}`,
                `Authorization: Bearer ${SECRETS.bearer}`,
                "Accept: */*",
              ],
            },
          },
        ],
      },
    };
    const { har } = redactHar(raw);

    expect(har.log.entries[0]._headers.request).toEqual([
      "Cookie: sid=[redacted]*********",
      "Authorization: [redacted]",
      "Accept: */*",
    ]);
  });

  it("counts the redacted header values", () => {
    // cookie, set-cookie, authorization, x-api-key, x-csrf-token and the JWT header.
    expect(redacted().report.headers).toBe(6);
  });

  it("drops response bodies and redacts request bodies, keeping their sizes", () => {
    const { har, report } = redacted();
    const api = har.log.entries[2];

    expect(api.response.content).toEqual({ size: 4000, mimeType: "application/json" });
    expect(documentEntry(har).response.content).toEqual({ size: 4000, mimeType: "text/html" });
    expect(api.request).toMatchObject({
      postData: { mimeType: "application/json", text: "[redacted]" },
    });
    expect(report.bodies).toBe(3);
  });

  it("redacts the values of form parameters", () => {
    const raw = secretHar();
    raw.log.entries[2].request.postData = {
      mimeType: "application/x-www-form-urlencoded",
      params: [{ name: "password", value: SECRETS.password }],
      text: `password=${SECRETS.password}`,
    };
    const { har } = redactHar(raw) as { har: RawHar };

    expect(har.log.entries[2].request.postData).toEqual({
      mimeType: "application/x-www-form-urlencoded",
      params: [{ name: "password", value: "[redacted]" }],
      text: "[redacted]",
    });
  });

  it("redacts sensitive query values by name, whatever their case", () => {
    const raw = secretHar();
    raw.log.entries[6].request.url =
      "https://shop.example.com/x?Token=a1&AUTH=a2&key=a3&apikey=a4&api_key=a5&sid=a6&pwd=a7&secret=a8&id_token=a9&code=b1&state=b2&user=b3&signature=b4&refresh_token=b5&page=2&v=3";
    const { har } = redactHar(raw) as { har: RawHar };

    expect(plain(har.log.entries[6].request.url)).toBe(
      "https://shop.example.com/x?Token=[redacted]&AUTH=[redacted]&key=[redacted]&apikey=[redacted]&api_key=[redacted]&sid=[redacted]&pwd=[redacted]&secret=[redacted]&id_token=[redacted]&code=[redacted]&state=[redacted]&user=[redacted]&signature=[redacted]&refresh_token=[redacted]&page=2&v=3"
    );
  });

  it("redacts query values that look like a JWT or a long hex or base64 token", () => {
    const raw = secretHar();
    raw.log.entries[6].request.url = `https://shop.example.com/x?a=${SECRETS.headerJwt}&b=${SECRETS.hexSignature}&c=Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MEFCQ0RFRg&d=a-long-but-harmless-slug-for-a-blog-post`;
    const { har } = redactHar(raw) as { har: RawHar };

    expect(plain(har.log.entries[6].request.url)).toBe(
      "https://shop.example.com/x?a=[redacted]&b=[redacted]&c=[redacted]&d=a-long-but-harmless-slug-for-a-blog-post"
    );
  });

  it("numbers the placeholders in document order, the same value always with the same number", () => {
    const { har } = redacted();

    expect(har.log.pages[0].title).toBe(har.log.entries[1].request.url);
    expect(har.log.entries[0].response.redirectURL).toBe(har.log.entries[1].request.url);
    expect(har.log.entries[1].request.url).toBe(
      "https://shop.example.com/account?email=[email]&token=[redacted-1]&lang=en"
    );
    expect(har.log.entries[0].request.url).toBe(
      "https://shop.example.com/login?session=[redacted-2]&next=%2Faccount"
    );
  });

  it("redacts the parsed query string the same way as the URL", () => {
    const { har } = redacted();

    expect(har.log.entries[1].request.queryString).toEqual([
      { name: "email", value: "[email]" },
      { name: "token", value: "[redacted-1]" },
      { name: "lang", value: "en" },
    ]);
  });

  it("redacts tokens in URL fragments and credentials in URLs", () => {
    const raw = secretHar();
    raw.log.entries[0].response.redirectURL = `https://user:${SECRETS.password}@shop.example.com/cb#access_token=${SECRETS.accessToken}&expires_in=3600`;
    const { har } = redactHar(raw) as { har: RawHar };

    expect(har.log.entries[0].response.redirectURL).toBe(
      "https://[redacted]@shop.example.com/cb#access_token=[redacted-3]&expires_in=3600"
    );
  });

  it("redacts emails anywhere in URLs, raw or percent-encoded, and leaves @2x images alone", () => {
    const { har, report } = redacted();

    expect(har.log.entries[5].request.url).toBe(
      "https://shop.example.com/avatars/[email]/logo@2x.png"
    );
    expect(report.emails).toBeGreaterThanOrEqual(3);
  });

  it("redacts the initiator URLs and the URLs in Referer, Location and Link headers", () => {
    const { har } = redacted();
    const [login, doc, api, pixel] = har.log.entries as (RawEntry & { _initiator?: unknown })[];

    expect(headerValue(login.response.headers, "location")).toBe(doc.request.url);
    expect(headerValue(doc.request.headers, "referer")).toBe(login.request.url);
    expect(JSON.stringify(api._initiator)).toContain("app.js?key=[redacted-");
    expect(JSON.stringify(pixel._initiator)).toContain("app.js?key=[redacted-");
  });

  it("keeps timings, sizes, statuses and the cache and CDN headers", () => {
    const { har } = redacted();
    const original = secretHar();

    har.log.entries.forEach((entry, i) => {
      const before = original.log.entries[i];
      expect(entry.timings).toEqual(before.timings);
      expect(entry.time).toBe(before.time);
      expect(entry._transferSize).toBe(before._transferSize);
      expect(entry.response.status).toBe(before.response.status);
      expect(entry.response.bodySize).toBe(before.response.bodySize);
      expect(entry.response.content.size).toBe(before.response.content.size);
      for (const name of ["cache-control", "x-vercel-cache", "x-vercel-id", "cf-ray", "server"]) {
        expect(headerValue(entry.response.headers, name)).toBe(
          headerValue(before.response.headers, name)
        );
      }
    });
  });

  it("keeps hostnames by default", () => {
    const { har, report } = redacted();

    expect(har.log.entries[3].request.url).toContain("tracker.vendor-one.io");
    expect(report.hosts).toBe(0);
  });

  it("masks third-party hostnames consistently, keeping the first party and well-known services", () => {
    const { har, report } = redacted({ hosts: "mask" });
    const urls = har.log.entries.map((e) => e.request.url);

    expect(urls[3]).toBe(
      "https://host-1.redacted/pixel.gif?uid=[redacted-5]&sig=[redacted-6]&page=home"
    );
    expect(urls[4]).toBe(FONT_URL.replace("assets.vendor-two.net", "host-2.redacted"));
    expect(urls[2]).toMatch(/^https:\/\/api\.example\.com\//);
    expect(urls[6]).toBe(GTAG_URL);
    expect(headerValue(har.log.entries[3].request.headers, ":authority")).toBe("host-1.redacted");
    expect(headerValue(documentEntry(har).response.headers, "link")).toBe(
      "<https://host-2.redacted/fonts/brand.woff2>; rel=preload; as=font, <https://host-2.redacted>; rel=preconnect"
    );
    expect(JSON.stringify(har)).not.toMatch(/vendor-one|vendor-two/);
    expect(report.hosts).toBe(2);
  });

  it("redacts WebSocket messages", () => {
    const raw = secretHar() as RawHar & { log: { entries: Record<string, unknown>[] } };
    raw.log.entries[2]._webSocketMessages = [
      { type: "send", time: 1, opcode: 1, data: SECRETS.bodyJwt },
    ];
    const { har } = redactHar(raw) as { har: typeof raw };

    expect(har.log.entries[2]._webSocketMessages).toEqual([
      { type: "send", time: 1, opcode: 1, data: "[redacted]" },
    ]);
  });

  it("does not change its input", () => {
    const raw = secretHar();
    redactHar(raw, { hosts: "mask" });

    expect(raw).toEqual(secretHar());
  });

  it("changes nothing when redacting a redacted HAR again", () => {
    for (const hosts of ["keep", "mask"] as const) {
      const once = redactHar(secretHar(), { hosts });
      const twice = redactHar(once.har, { hosts });

      expect(twice.har).toEqual(once.har);
      expect(twice.report).toEqual({
        cookies: 0,
        headers: 0,
        queryParams: 0,
        bodies: 0,
        hosts: 0,
        emails: 0,
        tokens: 0,
      });
    }
  });

  it("returns a HAR the parser reads into the same analysis", () => {
    const original = flowOf(secretHar());
    const redactedFlow = flowOf(redacted().har);

    expect(summarizeFlowMetrics(redactedFlow)).toEqual(summarizeFlowMetrics(original));
    expect(redactedFlow.pages[0].har.documentEntry.url).toBe(
      redacted().har.log.entries[1].request.url
    );
    expect(redactedFlow.pageAnalyses[0].cacheReport).toEqual(
      redactFlow(original).flow.pageAnalyses[0].cacheReport
    );
  });
});

describe("redactHar on real recordings", () => {
  for (const file of REAL_HARS) {
    const json = readFileSync(join(FIXTURES, file), "utf8");

    it(`counts what it redacts in ${file}`, () => {
      const { report } = redactHar(JSON.parse(json));

      // 25 response bodies and the POST body of a beacon; the Google Analytics client id (cid)
      // and session id (sid) in the URL, the :path header and the parsed query string.
      expect(report).toEqual({
        cookies: 0,
        headers: 0,
        queryParams: 6,
        bodies: 26,
        hosts: 0,
        emails: 0,
        tokens: 0,
      });
    });

    it(`keeps the metrics, CDN and cache findings of ${file}`, () => {
      const original = generateFlow([{ name: "Home", har: parseHarJson(json) }]);
      const fromRedacted = generateFlow([
        { name: "Home", har: parseHarPages(redactHar(JSON.parse(json)).har as never)[0] },
      ]);
      const findings = (flow: Flow) =>
        findingsDocument([{ flow }], {
          htvVersion: "test",
          generatedAt: "now",
          schema: "s",
        }).pages[0].findings.map((f) => [f.id, f.severity, f.summary]);

      expect(summarizeFlowMetrics(fromRedacted)).toEqual(summarizeFlowMetrics(original));
      expect(fromRedacted.pageAnalyses[0].nodes).toEqual(original.pageAnalyses[0].nodes);
      expect(fromRedacted.pageAnalyses[0].thirdPartyClusters).toEqual(
        original.pageAnalyses[0].thirdPartyClusters
      );
      expect(findings(fromRedacted)).toEqual(findings(original));
      // Analysing the redacted HAR gives the original analysis with redacted URLs.
      expect(normalizePlaceholders(fromRedacted)).toEqual(
        normalizePlaceholders(redactFlow(original).flow)
      );
    });

    it(`keeps the analysis of ${file} with masked hosts`, () => {
      const original = generateFlow([{ name: "Home", har: parseHarJson(json) }]);
      const fromMasked = generateFlow([
        {
          name: "Home",
          har: parseHarPages(redactHar(JSON.parse(json), { hosts: "mask" }).har as never)[0],
        },
      ]);

      expect(summarizeFlowMetrics(fromMasked)).toEqual(summarizeFlowMetrics(original));
      expect(fromMasked.pageAnalyses[0].nodes).toEqual(original.pageAnalyses[0].nodes);
    });
  }
});

// Placeholders are numbered in the order each redaction meets the values.
function normalizePlaceholders(flow: Flow): unknown {
  return JSON.parse(plain(JSON.stringify(flow)));
}

describe("redactFlow", () => {
  const original = () => flowOf(secretHar());

  it("leaves none of the URL secrets in a generated flow", () => {
    // Bodies, cookies and credential headers never reach a flow; URLs, titles and evidence do.
    expect(leaks(original())).toEqual(
      expect.arrayContaining([
        SECRETS.pageToken,
        SECRETS.session,
        SECRETS.email,
        SECRETS.accessToken,
      ])
    );

    const { flow, report } = redactFlow(original());

    expect(leaks(flow)).toEqual([]);
    expect(report.queryParams).toBeGreaterThan(0);
    expect(report.emails).toBeGreaterThan(0);
  });

  it("redacts the evidence of the findings built from it", () => {
    const { flow } = redactFlow(original());
    const doc = findingsDocument([{ flow }], {
      htvVersion: "test",
      generatedAt: "now",
      schema: "s",
    });

    expect(leaks(doc)).toEqual([]);
  });

  it("redacts page names and step descriptions", () => {
    const flow = original();
    flow.pages[0].name = `Account of ${SECRETS.email}`;
    flow.steps[0].description = `Opened ${DOCUMENT_URL}`;
    const { flow: result } = redactFlow(flow);

    expect(result.pages[0].name).toBe("Account of [email]");
    expect(plain(result.steps[0].description)).toBe(
      "Opened https://shop.example.com/account?email=[email]&token=[redacted]&lang=en"
    );
  });

  it("masks third-party hostnames when asked", () => {
    const { flow, report } = redactFlow(original(), { hosts: "mask" });
    const json = JSON.stringify(flow);

    expect(json).not.toMatch(/vendor-one|vendor-two/);
    expect(json).toContain("host-1.redacted");
    expect(json).toContain("shop.example.com");
    expect(json).toContain("www.googletagmanager.com");
    expect(report.hosts).toBe(2);
  });

  it("does not change its input", () => {
    const flow = original();
    const copy = structuredClone(flow);
    redactFlow(flow, { hosts: "mask" });

    expect(flow).toEqual(copy);
  });

  it("changes nothing when redacting a redacted flow again", () => {
    const once = redactFlow(original(), { hosts: "mask" });
    const twice = redactFlow(once.flow, { hosts: "mask" });

    expect(twice.flow).toEqual(once.flow);
    expect(twice.report).toEqual({
      cookies: 0,
      headers: 0,
      queryParams: 0,
      bodies: 0,
      hosts: 0,
      emails: 0,
      tokens: 0,
    });
  });

  it("redacts a JWT outside the query string and counts it as a token", () => {
    const flow = original();
    flow.pages[0].har.entries[6].url = `https://shop.example.com/reset/${SECRETS.headerJwt}`;
    const { flow: result, report } = redactFlow(flow);

    expect(result.pages[0].har.entries[6].url).toBe("https://shop.example.com/reset/[redacted]");
    expect(report.tokens).toBe(1);
  });
});

describe("redactFlows", () => {
  it("uses the same placeholders and hosts across the flows of a comparison", () => {
    const a = flowOf(secretHar());
    const b = flowOf(secretHar());
    const { flows } = redactFlows([a, b], { hosts: "mask" });

    expect(flows[1].pages[0].har.entries.map((e) => e.url)).toEqual(
      flows[0].pages[0].har.entries.map((e) => e.url)
    );
    expect(flows[0].pages[0].har.entries[3].url).toMatch(/^https:\/\/host-1\.redacted\//);
    expect(PIXEL_URL).toContain("tracker.vendor-one.io");
  });
});

describe("describeRedaction", () => {
  it("names each count, leaving out the zeros", () => {
    expect(
      describeRedaction({
        cookies: 5,
        headers: 1,
        queryParams: 12,
        bodies: 0,
        hosts: 2,
        emails: 3,
        tokens: 0,
      })
    ).toBe("5 cookie values, 1 header value, 12 query values, 3 emails, 2 hosts masked");
    expect(
      describeRedaction({
        cookies: 0,
        headers: 0,
        queryParams: 0,
        bodies: 0,
        hosts: 0,
        emails: 0,
        tokens: 0,
      })
    ).toBe("nothing to redact");
  });
});
