import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  detectCdnPopCity,
  detectCdnRegion,
  detectOriginRegion,
} from "../src/inference/node-detector.js";
import { detectPop } from "../src/inference/pops.js";
import { parseHarJson } from "../src/parsers/har-parser.js";
import { generateFlow } from "../src/steps/step-generator.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const redirectFixturePath = join(__dirname, "fixtures/redirect-iframe.har.fixture.json");

// x-vercel-id lists the regions a request crossed, the edge first, then the region
// the function ran in, then a request id: "cdg1::iad1::w8x2k-1779186962459-6cff682e889a".
describe("x-vercel-id regions", () => {
  const functionInUs = { "x-vercel-id": "cdg1::iad1::w8x2k-1779186962459-6cff682e889a" };

  it("places the edge at the first region", () => {
    expect(detectPop(functionInUs)).toMatchObject({ code: "cdg", city: "Paris" });
    expect(detectCdnRegion(functionInUs)).toBe("europe");
    expect(detectCdnPopCity(functionInUs, "vercel", false)).toBe("Paris");
  });

  it("places the origin where the function ran", () => {
    expect(detectOriginRegion(functionInUs)).toBe("united-states");
    expect(detectOriginRegion({ "x-vercel-id": "fra1::hnd1::abc12-1779186962459" })).toBe(
      "asia-pacific"
    );
  });

  it("takes the last region before the request id as the function region", () => {
    expect(detectOriginRegion({ "x-vercel-id": "cdg1::fra1::syd1::abc12-1779186962459" })).toBe(
      "asia-pacific"
    );
  });

  it("does not read the edge or the request id as the origin region", () => {
    // Served by the edge alone: no function region, so Vercel's default (iad1) applies.
    expect(detectOriginRegion({ "x-vercel-id": "cdg1::pt4z5-1779186962459-6cff682e889a" })).toBe(
      "united-states"
    );
    expect(detectOriginRegion({ "x-vercel-id": "gru1::syd1abcd2-1779186962459" })).toBe(
      "united-states"
    );
  });

  it("draws the edge in Europe and the origin in the United States for a function run in iad1", () => {
    const har = parseHarJson(readFileSync(redirectFixturePath, "utf8"));
    const flow = generateFlow([{ name: "Home", har }]);
    const node = (id: string) => flow.pageAnalyses[0].nodes.find((n) => n.id === id);
    expect(node("edge")).toMatchObject({
      label: "Vercel Edge",
      subLabel: "Paris",
      region: "europe",
    });
    expect(node("origin")).toMatchObject({ region: "united-states" });
  });
});
