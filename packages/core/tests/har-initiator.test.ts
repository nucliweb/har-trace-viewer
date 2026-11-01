import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseHar, parseHarJson } from "../src/parsers/har-parser.js";
import { firefoxEntry, firefoxHar } from "./helpers/firefox-har.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const chromeHarPath = join(
  __dirname,
  "../../../fixtures/webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har"
);

describe("parseHar — request initiators", () => {
  const withInitiator = (initiator: unknown) => {
    const raw = firefoxHar();
    raw.log.entries.push(
      firefoxEntry("https://example.com/app.js", "text/javascript", { _initiator: initiator })
    );
    return parseHar(raw).entries.at(-1)!;
  };

  it("keeps the parser initiator with the URL and line that referenced the resource", () => {
    expect(
      withInitiator({ type: "parser", url: "https://example.com/", lineNumber: 13 }).initiator
    ).toEqual({ type: "parser", url: "https://example.com/", lineNumber: 13 });
  });

  it("takes a script initiator's URL from the first stack frame with one, parents included", () => {
    const initiator = withInitiator({
      type: "script",
      stack: {
        callFrames: [],
        parent: {
          description: "Promise.then",
          callFrames: [
            { functionName: "", url: "", lineNumber: 0 },
            { functionName: "load", url: "https://example.com/main.js", lineNumber: 4 },
          ],
        },
      },
    }).initiator;

    expect(initiator).toEqual({
      type: "script",
      url: "https://example.com/main.js",
      lineNumber: 4,
    });
  });

  it("keeps an initiator without a URL as its type alone", () => {
    expect(withInitiator({ type: "other" }).initiator).toEqual({ type: "other" });
  });

  it("has no initiator when the HAR carries none", () => {
    expect(withInitiator(undefined).initiator).toBeUndefined();
    expect(withInitiator("parser").initiator).toBeUndefined();
  });

  it("reads Chrome's initiators from a real HAR", () => {
    const har = parseHarJson(readFileSync(chromeHarPath, "utf8"));
    const byUrl = (part: string) => har.entries.find((e) => e.url.includes(part))!;

    expect(har.documentEntry.initiator).toEqual({ type: "other" });
    expect(byUrl("4f18b1ac3f22924b.css").initiator).toEqual({
      type: "parser",
      url: "https://webperf-snippets.nucliweb.net/",
      lineNumber: 13,
    });
    expect(byUrl("cdn.debugbear.com").initiator).toMatchObject({
      type: "script",
      url: "https://webperf-snippets.nucliweb.net/_next/static/chunks/main-93d7eb3c1c216c38.js",
    });
  });
});
