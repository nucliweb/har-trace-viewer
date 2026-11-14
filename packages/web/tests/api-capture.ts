import { expandPageFlows, generateFlow, parseHarPages } from "@htv/core";
import type { Flow } from "@htv/core";

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

function json(url: string, ms: number, headers: { name: string; value: string }[] = []) {
  return {
    startedDateTime: at(ms),
    time: 120,
    request: { url, method: "GET" },
    response: {
      status: 200,
      headers: [{ name: "Content-Type", value: "application/json" }, ...headers],
      content: { mimeType: "application/json", size: 4000 },
      bodySize: 4000,
      headersSize: 200,
    },
    timings: { blocked: 1, dns: 20, connect: 30, ssl: 0, send: 1, wait: 80, receive: 9 },
  };
}

/** An API capture as a proxy records it: JSON only, no pages, no HTML document. */
export function apiCaptureHar() {
  return {
    log: {
      entries: [
        json("https://api.example.com/v1/session", 0, [
          { name: "Cache-Control", value: "no-store" },
        ]),
        json("https://api.example.com/v1/items", 300),
        json("https://api.example.com/v1/items?page=2", 450),
        json("https://telemetry.vendor.io/collect", 500),
      ],
    },
  };
}

/** The same requests under a listed page that has no document. */
export function apiCaptureWithPageHar() {
  const { entries } = apiCaptureHar().log;
  return {
    log: {
      pages: [
        {
          id: "page_1",
          title: "API run",
          startedDateTime: at(0),
          pageTimings: { onContentLoad: -1, onLoad: -1 },
        },
      ],
      entries: entries.map((e) => ({ ...e, pageref: "page_1" })),
    },
  };
}

/** Two listed pages, one per host, neither with a document; the second has no title. */
export function apiCaptureTwoPagesHar() {
  const { entries } = apiCaptureHar().log;
  const page = (id: string, title: string, ms: number) => ({
    id,
    title,
    startedDateTime: at(ms),
    pageTimings: { onContentLoad: -1, onLoad: -1 },
  });
  return {
    log: {
      pages: [page("page_1", "Orders API", 0), page("page_2", "", 20000)],
      entries: [
        ...entries.map((e) => ({ ...e, pageref: "page_1" })),
        ...entries.slice(0, 2).map((e, i) => ({
          ...e,
          pageref: "page_2",
          startedDateTime: at(20000 + i * 100),
          request: { ...e.request, url: e.request.url.replace("api.example.com", "api.other.org") },
        })),
      ],
    },
  };
}

export function makeApiFlow(raw: object = apiCaptureHar(), name = "API"): Flow {
  return generateFlow(expandPageFlows({ name, har: parseHarPages(raw as never) }));
}
