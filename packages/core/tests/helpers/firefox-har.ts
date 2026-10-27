// Synthetic Firefox-style HAR: no `_` fields, onLoad never fired, sizes via bodySize/headersSize.
export function firefoxEntry(
  url: string,
  mimeType: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    pageref: "page_1",
    startedDateTime: "2026-01-01T00:00:00.000Z",
    time: 20,
    request: { url, method: "GET" },
    response: {
      status: 200,
      headers: [],
      content: { mimeType, size: 5000 },
      bodySize: 1200,
      headersSize: 300,
    },
    timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 1, wait: 10, receive: 9 },
    ...overrides,
  };
}

export function firefoxHar() {
  const entries = [
    firefoxEntry("https://example.com/", "text/html; charset=utf-8"),
    firefoxEntry("https://example.com/app.css", "text/css"),
    firefoxEntry("https://example.com/app.js", "application/javascript"),
    firefoxEntry("https://example.com/hero.png", "image/png"),
    firefoxEntry("https://example.com/font.woff2", "font/woff2"),
  ];
  return {
    log: {
      pages: [
        {
          id: "page_1",
          title: "Example",
          startedDateTime: "2026-01-01T00:00:00.000Z",
          pageTimings: { onContentLoad: 120, onLoad: -1 },
        },
      ],
      entries,
    },
  };
}

// Synthetic HAR with two pages (two navigations). Page "page_2" starts 10 s after "page_1".
export function twoPageHar() {
  const p2 = (url: string, mime: string, extra: Record<string, unknown> = {}) =>
    firefoxEntry(url, mime, {
      pageref: "page_2",
      startedDateTime: "2026-01-01T00:00:10.000Z",
      ...extra,
    });
  return {
    log: {
      pages: [
        {
          id: "page_2",
          title: "Checkout",
          startedDateTime: "2026-01-01T00:00:10.100Z",
          pageTimings: { onContentLoad: 50, onLoad: 90 },
        },
        {
          id: "page_1",
          title: "Home",
          startedDateTime: "2026-01-01T00:00:00.000Z",
          pageTimings: { onContentLoad: 120, onLoad: -1 },
        },
      ],
      entries: [
        firefoxEntry("https://example.com/", "text/html"),
        firefoxEntry("https://example.com/app.js", "application/javascript", {
          pageref: undefined,
        }),
        p2("https://example.com/checkout", "text/html"),
        p2("https://example.com/checkout.css", "text/css", {
          startedDateTime: "2026-01-01T00:00:10.250Z",
        }),
      ],
    },
  };
}
