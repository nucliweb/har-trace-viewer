import { describe, expect, it } from "vitest";
import type { HarEntry } from "@htv/core";
import { preconnectCandidates } from "../src/lib/preconnect-candidates.js";

function entry(url: string, over: Partial<HarEntry> = {}): HarEntry {
  return {
    url,
    startTime: 100,
    duration: 100,
    timing: { dns: 0, connect: 0, ssl: 0, send: 0, wait: 50, receive: 0, blocked: 0 },
    ttfb: 50,
    status: 200,
    mimeType: "text/css",
    resourceType: "stylesheet",
    priority: "VeryHigh",
    responseHeaders: {},
    transferSize: 2000,
    bodySize: 2000,
    isDocument: false,
    fromCache: false,
    ...over,
  };
}

const font = (host: string, over: Partial<HarEntry> = {}) =>
  entry(`https://${host}/font.woff2`, { resourceType: "font", mimeType: "font/woff2", ...over });
const stylesheet = (host: string, over: Partial<HarEntry> = {}) =>
  entry(`https://${host}/style.css`, over);
const script = (host: string, over: Partial<HarEntry> = {}) =>
  entry(`https://${host}/script.js`, {
    resourceType: "script",
    mimeType: "application/javascript",
    priority: "High",
    ...over,
  });
const image = (host: string, over: Partial<HarEntry> = {}) =>
  entry(`https://${host}/hero.jpg`, {
    resourceType: "image",
    mimeType: "image/jpeg",
    priority: "High",
    ...over,
  });

const candidates = (resources: HarEntry[], renderDeadline: number | null = 1000) =>
  preconnectCandidates(resources, {
    documentHostname: "www.example.com",
    preconnectHints: {},
    renderDeadline,
  });

describe("preconnectCandidates", () => {
  it("suggests the hosts of render-critical resources, fonts and stylesheets first", () => {
    expect(
      candidates([
        image("images.example-cdn.com"),
        script("static.example-cdn.com"),
        stylesheet("css.example-cdn.com"),
        font("fonts.gstatic.com"),
      ])
    ).toEqual(["fonts.gstatic.com", "css.example-cdn.com", "static.example-cdn.com"]);
  });

  it("never suggests tag managers, analytics or ad hosts", () => {
    expect(
      candidates([
        script("www.googletagmanager.com", { priority: "High" }),
        script("www.google-analytics.com"),
        script("connect.facebook.net"),
        script("static.hotjar.com"),
        script("securepubads.g.doubleclick.net"),
        image("bat.bing.com"),
      ])
    ).toEqual([]);
  });

  it("leaves out late and low-priority scripts and images, which do not block rendering", () => {
    expect(
      candidates([
        script("cdn.debugbear.com", { priority: "Low" }),
        script("late.example-cdn.com", { startTime: 1500 }),
        image("lazy.example-cdn.com", { priority: "Low" }),
        image("res.cloudinary.com", { startTime: 56 }),
      ])
    ).toEqual(["res.cloudinary.com"]);
  });

  it("leaves out the document host and hosts already preconnected", () => {
    expect(
      preconnectCandidates([font("www.example.com"), font("fonts.gstatic.com")], {
        documentHostname: "www.example.com",
        preconnectHints: { "fonts.gstatic.com": "link-header" },
        renderDeadline: 1000,
      })
    ).toEqual([]);
  });

  it("caps the suggestion at three hosts", () => {
    const hosts = ["a", "b", "c", "d", "e"].map((name) => `${name}.example-cdn.com`);

    expect(candidates(hosts.map((host) => font(host)))).toHaveLength(3);
  });

  it("goes by priority alone without a trace to time the render", () => {
    expect(
      candidates(
        [
          stylesheet("css.example-cdn.com", { startTime: 5000 }),
          script("cdn.debugbear.com", { priority: "Low" }),
        ],
        null
      )
    ).toEqual(["css.example-cdn.com"]);
  });
});
