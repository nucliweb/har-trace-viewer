import { describe, it, expect } from "vitest";
import { parseHarPages } from "../src/parsers/har-parser.js";
import { firefoxEntry } from "./helpers/firefox-har.js";

type RawHar = Parameters<typeof parseHarPages>[0];

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
const page = (id: string, seconds: number) => ({
  id,
  title: id,
  startedDateTime: at(seconds),
  pageTimings: { onLoad: -1 },
});
const entry = (url: string, seconds: number, pageref: string | undefined, mime = "text/css") =>
  firefoxEntry(url, mime, { pageref, startedDateTime: at(seconds) });
const harOf = (log: Record<string, unknown>) => ({ log }) as unknown as RawHar;
const urlsOf = (raw: RawHar) =>
  parseHarPages(raw).map((parsed) =>
    parsed.entries.map((e) => e.url.replace("https://x.test", ""))
  );

describe("parseHarPages — which page each entry belongs to", () => {
  it("keeps an entry with a pageref on its page, in capture order", () => {
    const raw = harOf({
      pages: [page("c", 20), page("a", 0), page("b", 10)],
      entries: [
        entry("https://x.test/b/doc", 10, "b", "text/html"),
        entry("https://x.test/c/doc", 20, "c", "text/html"),
        entry("https://x.test/a/doc", 0, "a", "text/html"),
        entry("https://x.test/a/2", 2, "a"),
        entry("https://x.test/b/2", 12, "b"),
        entry("https://x.test/a/1", 1, "a"),
        entry("https://x.test/c/1", 21, "c"),
      ],
    });

    expect(urlsOf(raw)).toEqual([
      ["/a/doc", "/a/2", "/a/1"],
      ["/b/doc", "/b/2"],
      ["/c/doc", "/c/1"],
    ]);
  });

  it("puts an entry without a pageref on the first page by start time", () => {
    const raw = harOf({
      pages: [page("b", 10), page("a", 0)],
      entries: [
        entry("https://x.test/b/doc", 10, "b", "text/html"),
        entry("https://x.test/a/doc", 0, "a", "text/html"),
        entry("https://x.test/loose", 15, undefined),
      ],
    });

    expect(urlsOf(raw)).toEqual([["/a/doc", "/loose"], ["/b/doc"]]);
  });

  it("puts an entry with an unknown pageref on the page running when it started", () => {
    const raw = harOf({
      pages: [page("a", 0), page("b", 10), page("c", 20)],
      entries: [
        entry("https://x.test/a/doc", 0, "a", "text/html"),
        entry("https://x.test/b/doc", 10, "b", "text/html"),
        entry("https://x.test/c/doc", 20, "c", "text/html"),
        entry("https://x.test/early", -5, "ghost"),
        entry("https://x.test/during-b", 12, "ghost"),
        entry("https://x.test/during-c", 25, "other"),
      ],
    });

    expect(urlsOf(raw)).toEqual([
      ["/a/doc", "/early"],
      ["/b/doc", "/during-b"],
      ["/c/doc", "/during-c"],
    ]);
  });

  it("reads a HAR without pages as one page of every entry", () => {
    const raw = harOf({
      entries: [
        entry("https://x.test/doc", 0, undefined, "text/html"),
        entry("https://x.test/1", 1, undefined),
        entry("https://x.test/2", 2, "page_1"),
      ],
    });

    expect(urlsOf(raw)).toEqual([["/doc", "/1", "/2"]]);
  });
});

describe("parseHarPages — cost on a capture of many pages", () => {
  it("reads each entry's pageref a bounded number of times, not once per page", () => {
    const PAGES = 60;
    const PER_PAGE = 50;
    let reads = 0;
    const counted = (raw: Record<string, unknown>) => {
      const { pageref } = raw as { pageref?: string };
      return Object.defineProperty({ ...raw }, "pageref", {
        enumerable: true,
        get: () => {
          reads++;
          return pageref;
        },
      });
    };
    const pages = Array.from({ length: PAGES }, (_, p) => page(`p${p}`, p * 100));
    const entries = pages.flatMap((p, i) =>
      Array.from({ length: PER_PAGE }, (_, j) =>
        counted(
          entry(`https://x.test/p${i}/${j}`, i * 100 + j, p.id, j === 0 ? "text/html" : "text/css")
        )
      )
    );

    const parsed = parseHarPages(harOf({ pages, entries }));

    expect(parsed).toHaveLength(PAGES);
    expect(parsed.every((p) => p.entries.length === PER_PAGE)).toBe(true);
    expect(reads).toBeLessThanOrEqual(entries.length * 5);
  });
});
