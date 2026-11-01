#!/usr/bin/env node
// Generates the large HAR fixture deterministically: one Chrome-style page with 1500 entries
// spread over 40 hosts, written gzipped (the same seed always produces the same bytes).
//
// Usage: node gen-large-har.mjs [output.json.gz] [entries]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const output =
  process.argv[2] ?? join(here, "..", "tests", "fixtures", "large.har.fixture.json.gz");
const count = Number(process.argv[3] ?? 1500);

// mulberry32: a small seeded PRNG.
function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(20260519);
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (list) => list[Math.floor(rand() * list.length)];

const ORIGIN = "https://www.bigsite.example";
const START = Date.parse("2026-05-19T08:00:00.000Z");

const hosts = [
  { name: "www.bigsite.example", cdn: "cloudflare" },
  { name: "static.bigsite.example", cdn: "fastly" },
  { name: "images.bigsite.example", cdn: "akamai" },
  ...Array.from({ length: 37 }, (_, i) => ({
    name: `t${String(i + 1).padStart(2, "0")}.thirdparty-${(i % 9) + 1}.example`,
    cdn: ["cloudflare", "fastly", "akamai", "cloudfront", "none"][i % 5],
  })),
];

const TYPES = [
  { type: "script", mime: "application/javascript", ext: "js", weight: 30 },
  { type: "image", mime: "image/webp", ext: "webp", weight: 35 },
  { type: "stylesheet", mime: "text/css", ext: "css", weight: 8 },
  { type: "fetch", mime: "application/json", ext: "json", weight: 15 },
  { type: "font", mime: "font/woff2", ext: "woff2", weight: 4 },
  { type: "image", mime: "image/gif", ext: "gif", weight: 8 },
];
const bag = TYPES.flatMap((t) => Array(t.weight).fill(t));

function cdnHeaders(cdn, hit, index) {
  const c = hit ? "HIT" : "MISS";
  switch (cdn) {
    case "cloudflare":
      return { server: "cloudflare", "cf-ray": `8f${String(index).padStart(14, "0")}-${pick(["FRA", "AMS", "MAD", "LHR"])}`, "cf-cache-status": c };
    case "fastly":
      return { "x-served-by": `cache-${pick(["fra", "ams", "mad"])}${int(1000, 9999)}-${pick(["FRA", "AMS", "MAD"])}`, "x-cache": c };
    case "akamai":
      return { "x-akamai-transformed": "9 - 0 pmb=mRUM,1", "x-cache": `TCP_${c}`, "server-timing": `cdn-cache; desc=${c}` };
    case "cloudfront":
      return { "x-amz-cf-pop": `${pick(["FRA", "AMS", "MAD"])}${int(50, 60)}-C1`, "x-cache": `${hit ? "Hit" : "Miss"} from cloudfront` };
    default:
      return { server: "nginx" };
  }
}

const hdrs = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));

const entries = [];
for (let i = 0; i < count; i++) {
  const isDoc = i === 0;
  const host = isDoc ? hosts[0] : pick(hosts);
  const spec = isDoc ? { type: "document", mime: "text/html", ext: "html" } : pick(bag);
  const at = isDoc ? 0 : int(150, 9000);
  const size = isDoc ? 52000 : int(300, 90000);
  const wire = Math.round(spec.type === "image" ? size : size * 0.35);
  const wait = int(15, 220);
  const fresh = i % 4 !== 0;
  const url = isDoc
    ? `${ORIGIN}/`
    : `https://${host.name}/${spec.type}/${(i * 7919).toString(36)}.${spec.ext}?v=${int(1, 99)}`;
  entries.push({
    _initiator: isDoc ? { type: "other" } : { type: "parser", url: `${ORIGIN}/`, lineNumber: int(1, 400) },
    _priority: isDoc ? "VeryHigh" : pick(["High", "Medium", "Low"]),
    _resourceType: spec.type,
    cache: {},
    connection: String(host.name.length * 10 + (i % 3)),
    request: { method: "GET", url, httpVersion: "h2", headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 0 },
    response: {
      status: i % 97 === 0 && !isDoc ? 404 : 200,
      statusText: "",
      httpVersion: "h2",
      headers: hdrs({
        "content-type": spec.mime,
        "cache-control": fresh ? "public, max-age=31536000, immutable" : "no-cache",
        ...(spec.type === "image" ? {} : { "content-encoding": "br" }),
        ...cdnHeaders(host.cdn, fresh, i),
      }),
      cookies: [],
      content: { size, mimeType: spec.mime },
      redirectURL: "",
      headersSize: -1,
      bodySize: -1,
      _transferSize: wire + 320,
    },
    serverIPAddress: `198.51.100.${(i % 200) + 1}`,
    startedDateTime: new Date(START + at).toISOString(),
    time: wait + 20,
    timings: {
      blocked: 1,
      dns: i % 17 === 0 ? 20 : -1,
      ssl: i % 17 === 0 ? 30 : -1,
      connect: i % 17 === 0 ? 40 : -1,
      send: 0.2,
      wait,
      receive: 19.8,
    },
    _connectionId: String(host.name.length * 10 + (i % 3)),
    pageref: "page_1",
  });
}
entries.sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime));

const har = {
  log: {
    version: "1.2",
    creator: { name: "WebInspector", version: "537.36" },
    pages: [
      {
        startedDateTime: new Date(START).toISOString(),
        id: "page_1",
        title: `${ORIGIN}/`,
        pageTimings: { onContentLoad: 1400, onLoad: 9300 },
      },
    ],
    entries,
  },
};

writeFileSync(output, gzipSync(JSON.stringify(har, null, 2), { level: 9 }));
console.error(`${output}: ${count} entries`);
