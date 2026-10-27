import { describe, it, expect } from "vitest";
import { getRootDomain } from "../src/utils/domain.js";

describe("getRootDomain", () => {
  it("keeps one label before a multi-label public suffix", () => {
    expect(getRootDomain("https://www.bbc.co.uk/x")).toBe("bbc.co.uk");
    expect(getRootDomain("https://static.example.com.au/a.js")).toBe("example.com.au");
  });

  it("does not collapse different registrable domains under the same suffix", () => {
    expect(getRootDomain("https://bbc.co.uk")).not.toBe(getRootDomain("https://news.co.uk"));
  });

  it("uses the last two labels for ordinary TLDs", () => {
    expect(getRootDomain("https://cdn.example.com/a")).toBe("example.com");
    expect(getRootDomain("https://example.com")).toBe("example.com");
  });

  it("returns localhost and IP hostnames as is", () => {
    expect(getRootDomain("http://localhost:3000/")).toBe("localhost");
    expect(getRootDomain("http://127.0.0.1/")).toBe("127.0.0.1");
  });

  it("returns the input for invalid URLs", () => {
    expect(getRootDomain("not a url")).toBe("not a url");
  });
});
