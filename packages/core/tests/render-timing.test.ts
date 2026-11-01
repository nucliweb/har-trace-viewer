import { describe, expect, it } from "vitest";
import { linkPreloadedUrls } from "../src/analysis/render-timing.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

describe("linkPreloadedUrls", () => {
  it("reads the preloads of the document's Link header and of its Early Hints", () => {
    const har = makeHar([
      makeEntry({
        url: "https://example.com/",
        status: 103,
        responseHeaders: { link: "</fonts/inter.woff2>; rel=preload; as=font" },
      }),
      makeEntry({ url: "https://example.com/hero.jpg", mimeType: "image/jpeg" }),
    ]);
    har.documentEntry.responseHeaders = {
      ...har.documentEntry.responseHeaders,
      link: "</hero.jpg>; rel=preload; as=image, <https://cdn.example.net>; rel=preconnect",
    };

    expect([...linkPreloadedUrls(har)].sort()).toEqual([
      "https://example.com/fonts/inter.woff2",
      "https://example.com/hero.jpg",
    ]);
  });
});
