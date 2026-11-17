import { describe, it, expect } from "vitest";
import { parseHar, parseHarPages } from "../src/parsers/har-parser.js";
import { generateFlow, FLOW_VERSION, normalizeFlow } from "../src/steps/step-generator.js";
import { redactFlow, redactHar } from "../src/analysis/redact.js";
import type { Flow } from "../src/types.js";
import { secretHar, SECRETS, HEADER_SECRETS, SSO_URL } from "./helpers/secret-har.js";

type RawHar = Parameters<typeof parseHar>[0];

const flowOf = (raw: unknown): Flow =>
  generateFlow(parseHarPages(raw as RawHar).map((har) => ({ name: "Home", har })));

const leaks = (value: unknown, secrets: string[]) => {
  const json = JSON.stringify(value);
  return secrets.filter((secret) => json.includes(secret));
};

function harWithHeaders(
  requestHeaders: { name: string; value: string }[],
  responseHeaders: { name: string; value: string }[]
): RawHar {
  return {
    log: {
      pages: [{ id: "p", title: "https://site.example/", startedDateTime: "2026-01-01T00:00:00Z" }],
      entries: [
        {
          pageref: "p",
          startedDateTime: "2026-01-01T00:00:00Z",
          time: 10,
          request: { url: "https://site.example/", method: "GET", headers: requestHeaders },
          response: {
            status: 200,
            headers: responseHeaders,
            content: { mimeType: "text/html", size: 100 },
          },
          timings: { send: 1, wait: 5, receive: 4 },
        },
      ],
    },
  };
}

describe("the header lists of an entry", () => {
  it("keeps every request and response header as a line, in order, repeated ones included", () => {
    const har = parseHar(
      harWithHeaders(
        [
          { name: ":authority", value: "site.example" },
          { name: "Accept", value: "text/html" },
          { name: "Accept", value: "*/*" },
          { name: "X-Empty", value: "" },
        ],
        [
          { name: "Content-Type", value: "text/html" },
          { name: "Vary", value: "Accept" },
          { name: "Vary", value: "Cookie" },
        ]
      )
    );

    expect(har.entries[0].headers).toEqual({
      request: [":authority: site.example", "Accept: text/html", "Accept: */*", "X-Empty: "],
      response: ["Content-Type: text/html", "Vary: Accept", "Vary: Cookie"],
    });
  });

  it("keeps empty lists for an entry without headers", () => {
    expect(parseHar(harWithHeaders([], [])).entries[0].headers).toEqual({
      request: [],
      response: [],
    });
  });

  it("masks the values of credential headers, keeping their names and cookie names", () => {
    const har = parseHar(
      harWithHeaders(
        [
          { name: "Cookie", value: "sid=SID_VALUE_123456; theme=dark" },
          { name: "Authorization", value: "Bearer BEARER_VALUE" },
          { name: "Proxy-Authorization", value: "Basic PROXY_VALUE" },
          { name: "X-Api-Key", value: "KEY_VALUE" },
          { name: "Referer", value: "https://login.example/cb?code=CODE_VALUE&lang=en" },
        ],
        [
          { name: "Set-Cookie", value: "sid=SET_VALUE_1234567; Path=/; HttpOnly" },
          { name: "Access-Control-Allow-Credentials", value: "true" },
        ]
      )
    );

    expect(har.entries[0].headers).toEqual({
      request: [
        "Cookie: sid=[redacted]******; theme=****",
        "Authorization: [redacted]",
        "Proxy-Authorization: [redacted]",
        "X-Api-Key: [redacted]",
        "Referer: https://login.example/cb?code=[redacted]&lang=en",
      ],
      response: [
        "Set-Cookie: sid=[redacted]*******; Path=/; HttpOnly",
        "Access-Control-Allow-Credentials: true",
      ],
    });
  });

  it("lets no secret of a header into the flow, its JSON or the allow-listed headers", () => {
    const flow = flowOf(secretHar());

    expect(leaks(flow, HEADER_SECRETS)).toEqual([]);
    const login = flow.pages[0].har.entries[0];
    expect(login.headers?.request).toContain(
      "referer: https://sso.vendor-three.example/callback?code=[redacted]&lang=en"
    );
    const document = flow.pages[0].har.documentEntry;
    expect(document.headers?.response).toEqual(
      expect.arrayContaining([
        "set-cookie: sid=[redacted]*********; Path=/; HttpOnly; Secure",
        "set-cookie: theme=****; Path=/",
        "x-session-id: [redacted]",
      ])
    );
  });

  it("keeps the allow-listed response headers the analyses read", () => {
    const flow = flowOf(secretHar());
    const document = flow.pages[0].har.documentEntry;

    expect(document.responseHeaders).toEqual({
      "cache-control": "private, no-store",
      "content-type": "text/html; charset=utf-8",
      server: "Vercel",
      "x-vercel-cache": "MISS",
      "x-vercel-id": "cdg1::iad1::abcde-1767225600000-0123456789ab",
      link: "<https://assets.vendor-two.net/fonts/brand.woff2>; rel=preload; as=font, <https://assets.vendor-two.net>; rel=preconnect",
    });
    expect(document.setsCookie).toBe(true);
    expect(document.sendsAuthorization).toBe(true);
  });
});

describe("the header lists in a redacted report", () => {
  it("are left as they are by a redaction, which already finds them masked", () => {
    const flow = flowOf(secretHar());
    const { flow: redacted } = redactFlow(flow);

    expect(redacted.pages[0].har.documentEntry.headers?.request).toContain(
      "authorization: [redacted]"
    );
    expect(redactFlow(redacted).report).toMatchObject({ headers: 0, cookies: 0 });
  });

  it("mask third-party hosts in Host, Origin and Referer, and hosts only a header names", () => {
    const { flow } = redactFlow(flowOf(secretHar()), { hosts: "mask" });
    const json = JSON.stringify(flow);

    expect(json).not.toMatch(/vendor-one|vendor-two|vendor-three/);
    const login = flow.pages[0].har.entries[0];
    expect(login.headers?.request).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^referer: https:\/\/host-\d+\.redacted\/callback\?code=\[redacted\]/
        ),
        expect.stringMatching(/^origin: https:\/\/host-\d+\.redacted$/),
      ])
    );
    const pixel = flow.pages[0].har.entries.find((e) => e.url.includes("pixel.gif"))!;
    expect(pixel.headers?.request[0]).toMatch(/^:authority: host-\d+\.redacted$/);
  });

  it("masks in a raw HAR the hosts that only its headers name", () => {
    const { har } = redactHar(secretHar(), { hosts: "mask" });

    expect(JSON.stringify(har)).not.toContain("vendor-three");
    expect(SSO_URL).toContain("vendor-three");
  });
});

describe("the flow version", () => {
  it("is 8, the first with header lists", () => {
    expect(FLOW_VERSION).toBe(8);
    expect(flowOf(secretHar()).version).toBe(8);
  });

  it("reads a flow of version 7, whose entries have no header lists", () => {
    const flow = flowOf(secretHar());
    const old = structuredClone(flow);
    old.version = 7;
    for (const entry of old.pages[0].har.entries) delete entry.headers;

    const read = normalizeFlow(old);

    expect(read.version).toBe(7);
    expect(read.pages[0].har.entries[0].headers).toBeUndefined();
    expect(read.pages[0].har.entries[0].responseHeaders).toEqual(
      flow.pages[0].har.entries[0].responseHeaders
    );
  });
});

describe("secrets outside the headers", () => {
  it("are still in the URLs of a report that is not redacted", () => {
    expect(leaks(flowOf(secretHar()), [SECRETS.pageToken])).toEqual([SECRETS.pageToken]);
  });
});
