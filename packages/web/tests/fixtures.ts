import { File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expandPageFlows, generateFlow, parseHarPagesJson, parseTraceJson } from "@htv/core";
import type { Flow } from "@htv/core";
import {
  criticalCss,
  makeHar,
  makeTrace,
  secondaryImage,
  thirdPartyScript,
} from "../../core/tests/helpers/synthetic-har";

const dir = resolve(import.meta.dirname, "../../core/tests/fixtures");

export const harJson = readFileSync(resolve(dir, "webperf-snippets.har.fixture.json"), "utf8");
export const traceJson = readFileSync(resolve(dir, "webperf-snippets.trace.fixture.json"), "utf8");

/**
 * jsdom's File has no `stream()`, which the main-thread parser relies on. Node's File
 * (same Web API, with streams) is accepted by the file input and exercises the real parser.
 */
export function makeFile(content: string, name: string): File {
  return new NodeFile([content], name, { type: "application/json" }) as unknown as File;
}

export function makeFlow(): Flow {
  const pages = expandPageFlows({
    name: "Home",
    har: parseHarPagesJson(harJson),
    trace: parseTraceJson(traceJson),
  });
  return generateFlow(pages);
}

/**
 * A first view and a cached repeat view of the same synthetic page: the repeat view serves
 * its resources from the browser cache, loads no third party and fires onLoad earlier.
 */
export function makeCompareFlows(): [Flow, Flow] {
  const a = makeHar(
    [criticalCss(100), secondaryImage(200), secondaryImage(250), thirdPartyScript(300)],
    { onContentLoad: 300, onLoad: 500 }
  );
  const b = makeHar(
    [
      { ...criticalCss(100), fromCache: "disk" },
      { ...secondaryImage(200), fromCache: "memory" },
    ],
    { onContentLoad: 150, onLoad: 200 }
  );
  return [
    generateFlow([{ name: "First view", har: a, trace: makeTrace(150, 400) }]),
    generateFlow([{ name: "Repeat view", har: b, trace: makeTrace(110, 250) }]),
  ];
}
