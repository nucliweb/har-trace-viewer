import { describe, it, expect } from "vitest";
import { analyzeThirdParties } from "../src/analysis/third-parties.js";
import { medianTtfbByLoad } from "../src/analysis/host-ttfb.js";
import { clusterThirdParties } from "../src/steps/third-party-clusters.js";
import { makeEntry, makeHar } from "./helpers/synthetic-har.js";

const third = (url: string, over = {}) =>
  makeEntry({
    url,
    resourceType: "script",
    mimeType: "application/javascript",
    priority: "Low",
    ...over,
  });

// The hostnames of a group of requests are listed busiest first, the first request winning a
// tie, by the third-party report and by the diagram's clusters alike.
describe("hostnames by request count", () => {
  const entries = [
    third("https://a.third.com/1.js"),
    third("https://b.third.com/1.js"),
    third("https://b.third.com/2.js"),
    third("https://c.third.com/1.js"),
    third("https://a.third.com/2.js"),
    third("https://a.third.com/3.js"),
    third("https://d.third.com/1.js"),
  ];
  const expected = ["a.third.com", "b.third.com", "c.third.com", "d.third.com"];

  it("orders the hosts of a third-party entity", () => {
    const report = analyzeThirdParties(makeHar(entries), undefined);
    expect(report.entities).toHaveLength(1);
    expect(report.entities[0].hosts).toEqual(expected);
  });

  it("orders the hosts of a cluster", () => {
    const clusters = clusterThirdParties(entries, 500);
    expect(clusters.flatMap((c) => c.hosts)).toEqual(expected);
  });

  it("names a host that is not a URL by the text itself", () => {
    const report = analyzeThirdParties(
      makeHar([third("https://a.third.com/1.js"), third("not a url"), third("not a url")]),
      undefined
    );
    expect(report.entities.flatMap((e) => e.hosts)).toContain("not a url");
    const [cluster] = clusterThirdParties([third("not a url"), third("not a url")], 500);
    expect(cluster!.hosts).toEqual(["not a url"]);
  });
});

// A request counts as sent after the load event only when it started strictly after it; with no
// load event every request is before it. The third-party split and the TTFB split agree.
describe("requests before and after the load event", () => {
  const onLoad = 500;
  const entries = [
    third("https://cdn.third.com/before.js", { startTime: 499, ttfb: 10 }),
    third("https://cdn.third.com/at.js", { startTime: 500, ttfb: 30 }),
    third("https://cdn.third.com/after.js", { startTime: 501, ttfb: 400 }),
  ];

  it("splits the third-party cost at onLoad, a request starting at onLoad being before it", () => {
    const [entity] = analyzeThirdParties(
      makeHar(entries, { onContentLoad: 300, onLoad }),
      undefined
    ).entities;
    expect(entity.beforeLoad.requests).toBe(2);
    expect(entity.afterLoad.requests).toBe(1);
  });

  it("splits the median TTFB at onLoad the same way", () => {
    expect(medianTtfbByLoad(entries, onLoad)).toEqual({ beforeLoad: 20, afterLoad: 400 });
    expect(medianTtfbByLoad(entries, null)).toEqual({ beforeLoad: 30, afterLoad: null });
  });
});
