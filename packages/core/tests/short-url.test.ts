import { describe, expect, it } from "vitest";
import { matchesResourceQuery, parseResourceQuery } from "../src/analysis/resource-query.js";
import { buildWaterfall } from "../src/analysis/waterfall.js";
import { shortUrl } from "../src/utils/format.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

const name = (path: string) => shortUrl(`https://example.cn/${path}`);

describe("shortUrl decoding", () => {
  it("shows non-ASCII path segments and query values as text", () => {
    expect(name("静态资源/样式表.css")).toBe("样式表.css");
    expect(name("a/%E6%A0%B7%E5%BC%8F%E8%A1%A8.css")).toBe("样式表.css");
    expect(name("img/%F0%9F%8E%89-party.png?q=%C3%A9t%C3%A9")).toBe("🎉-party.png?q=été");
  });

  it("leaves malformed escapes as they are and never throws", () => {
    expect(name("a%E6%ZZ.css")).toBe("a%E6%ZZ.css");
    expect(name("100%.css")).toBe("100%.css");
    expect(name("%E6%A0.css")).toBe("%E6%A0.css");
    expect(name("%C0%AF.css")).toBe("%C0%AF.css");
    expect(name("%ED%A0%80.css")).toBe("%ED%A0%80.css");
  });

  it("keeps the characters that would change the meaning of the path encoded", () => {
    expect(name("a%2Fb%3Fc%23d%25e.css")).toBe("a%2Fb%3Fc%23d%25e.css");
    expect(name("a%20b%26c%3Dd.css")).toBe("a%20b%26c%3Dd.css");
  });

  it("keeps control characters, bidi overrides and line separators encoded", () => {
    for (const escape of [
      "%00",
      "%1B",
      "%7F",
      "%C2%80",
      "%C2%9B",
      "%E2%80%AE",
      "%E2%80%AA",
      "%E2%81%A6",
      "%E2%81%A9",
      "%E2%80%8E",
      "%E2%80%A8",
    ]) {
      expect(name(`a${escape}b.css`)).toBe(`a${escape}b.css`);
    }
    expect(name("%E6%A0%B7%E2%80%AE.css")).toBe("样%E2%80%AE.css");
  });

  it("decodes before it truncates, without splitting a surrogate pair", () => {
    const label = name(`a${"%F0%9F%8E%89".repeat(40)}.css`);
    expect(label.endsWith("…")).toBe(true);
    expect(label).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    );
  });

  it("keeps a bare origin and an invalid URL as before", () => {
    expect(shortUrl("https://例え.jp/")).toBe("xn--r8jz45g.jp");
    expect(shortUrl("not%E6%A0%B7 a url")).toBe("not%E6%A0%B7 a url");
  });
});

describe("filtering a request by its decoded name", () => {
  const [, row] = buildWaterfall(
    makeHar([makeEntry({ url: "https://example.cn/%E9%9D%99/%E6%A0%B7%E5%BC%8F%E8%A1%A8.css" })])
  ).rows;
  const keeps = (query: string) => matchesResourceQuery(row!, parseResourceQuery(query));

  it("matches what the list shows and what the HAR recorded", () => {
    expect(row!.shortName).toBe("样式表.css");
    expect(keeps("样式")).toBe(true);
    expect(keeps("%E6%A0%B7")).toBe(true);
    expect(keeps("example.cn/%E9%9D%99")).toBe(true);
    expect(keeps("样式 -zzz")).toBe(true);
    expect(keeps("-样式")).toBe(false);
    expect(keeps("样式x")).toBe(false);
  });
});
