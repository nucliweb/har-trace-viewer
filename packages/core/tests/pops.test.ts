import { describe, it, expect } from "vitest";
import { POPS, detectPop, lookupPop } from "../src/inference/pops.js";

describe("POPS table", () => {
  it("covers at least 60 PoPs, each with city, country and region", () => {
    const codes = Object.keys(POPS);
    expect(codes.length).toBeGreaterThanOrEqual(60);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z]{3}$/);
      expect(POPS[code].city).not.toBe("");
      expect(POPS[code].country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it.each([
    ["fra", "Frankfurt", "DE", "europe"],
    ["lax", "Los Angeles", "US", "united-states"],
    ["hkg", "Hong Kong", "HK", "asia-pacific"],
    ["syd", "Sydney", "AU", "asia-pacific"],
    ["akl", "Auckland", "NZ", "asia-pacific"],
    ["gru", "Sao Paulo", "BR", "south-america"],
    ["eze", "Buenos Aires", "AR", "south-america"],
    ["jnb", "Johannesburg", "ZA", "africa"],
    ["dxb", "Dubai", "AE", "middle-east"],
    ["tlv", "Tel Aviv", "IL", "middle-east"],
    ["yyz", "Toronto", "CA", "north-america"],
    ["mex", "Mexico City", "MX", "north-america"],
    ["hel", "Helsinki", "FI", "europe"],
  ])("maps %s to %s (%s, %s)", (code, city, country, region) => {
    expect(lookupPop(code)).toEqual({ city, country, region });
  });

  it("looks codes up case-insensitively and returns null for unknown codes", () => {
    expect(lookupPop("FRA")?.city).toBe("Frankfurt");
    expect(lookupPop("xyz")).toBeNull();
  });
});

describe("detectPop", () => {
  it("reads the cf-ray suffix", () => {
    expect(detectPop({ "cf-ray": "a51d5608791cf7dd-LAX" })).toEqual({
      code: "lax",
      city: "Los Angeles",
      country: "US",
      region: "united-states",
      provider: "cloudflare",
    });
  });

  it("reads the first three letters of x-amz-cf-pop", () => {
    expect(detectPop({ "x-amz-cf-pop": "FRA56-P14" })).toMatchObject({
      code: "fra",
      city: "Frankfurt",
      provider: "cloudfront",
    });
  });

  it("reads the Fastly PoP from x-served-by, preferring the last (client-facing) entry", () => {
    expect(detectPop({ "x-served-by": "cache-fra-eddf8230045-FRA" })).toMatchObject({
      code: "fra",
      provider: "fastly",
    });
    expect(
      detectPop({ "x-served-by": "cache-iad-kcgs7200123-IAD, cache-ams21030-AMS" })
    ).toMatchObject({ code: "ams", provider: "fastly" });
    expect(detectPop({ "x-served-by": "cache-lhr7355-LHR" })).toMatchObject({ code: "lhr" });
  });

  it("ignores x-served-by values that are not Fastly cache nodes", () => {
    expect(detectPop({ "x-served-by": "cp1234 cache" })).toBeNull();
  });

  it("reads the first region of x-vercel-id", () => {
    expect(detectPop({ "x-vercel-id": "cdg1::pt4z5-1779186962459-6cff682e889a" })).toMatchObject({
      code: "cdg",
      city: "Paris",
      region: "europe",
      provider: "vercel",
    });
    expect(detectPop({ "x-vercel-id": "fra1::iad1::abc-123" })).toMatchObject({ code: "fra" });
  });

  it("reads the Fly.io region suffix", () => {
    expect(detectPop({ "fly-request-id": "01HXYZ-mad" })).toMatchObject({
      code: "mad",
      provider: "fly",
    });
  });

  it("maps KeyCDN x-edge-location codes", () => {
    expect(detectPop({ "x-edge-location": "defr" })).toMatchObject({
      code: "fra",
      provider: "keycdn",
    });
    expect(detectPop({ "x-edge-location": "usda" })).toMatchObject({ code: "dfw" });
  });

  it("reads the Azure edge reference when it carries a PoP", () => {
    expect(
      detectPop({ "x-msedge-ref": "Ref A: ABC Ref B: AMS04EDGE1210 Ref C: 2024-01-01T00:00:00Z" })
    ).toMatchObject({ code: "ams", provider: "azure-front-door" });
    expect(detectPop({ "x-azure-ref": "Ref B: FRA30EDGE0123" })).toMatchObject({ code: "fra" });
    expect(detectPop({ "x-azure-ref": "20240101T000000Z-r1abcdef" })).toBeNull();
  });

  it("returns null for Akamai, unknown codes and empty headers", () => {
    expect(detectPop({ "x-akamai-transformed": "9 - 0 pmb=mRUM" })).toBeNull();
    expect(detectPop({ "cf-ray": "abc-XYZ" })).toBeNull();
    expect(detectPop({})).toBeNull();
  });
});
