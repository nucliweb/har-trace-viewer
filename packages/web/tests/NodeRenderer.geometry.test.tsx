import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { generateFlow, nodeKind, parseHar } from "@htv/core";
import type { ClientRegion, PathId } from "@htv/core";
import type { ComponentProps } from "react";
import { NodeRenderer } from "../src/components/NodeRenderer.js";

/**
 * Geometry regression guard for the diagram. Every layout is rendered with `react-dom/server`
 * in several step states; node centres, path data and text positions are extracted into plain
 * numbers and compared with a baseline recorded from the hand-tuned coordinate tables.
 *
 * Regenerate the baseline (only when a geometry change is intended) with:
 *   UPDATE_BASELINE=1 npx vitest run tests/NodeRenderer.geometry.test.tsx
 */

const BASELINE_PATH = resolve(import.meta.dirname, "__fixtures__/node-renderer-baseline.json");

// Every point (node centre, text anchor, path start and end) must stay within this distance.
const POINT_TOLERANCE = 2;
// Curves are compared by shape: the largest distance between the old and the new curve.
// Control points themselves are not compared one by one; the old ones were placed by hand.
const CURVE_TOLERANCE = 5;
// Timing labels on the paths were also placed by hand, path by path.
const LABEL_TOLERANCE = 3;

// A path starts and ends on the outline of its nodes: no glyph is wider than this.
const ATTACH_DISTANCE = 25;

// Captions are centred under their glyph; the last baseline gets a few pixels for descenders.
// A bypassing path keeps this far below the caption while within its half-width.
const CAPTION_HALF_WIDTH = { gfw: 50, edge: 75, origin: 75 } as const;
const CAPTION_DESCENT = 4;
const CAPTION_CLEARANCE = 12;

// Geometry that changes on purpose, per layout, compared for structure only. The hand-written
// tables drew browser → 3rd parties from x = 150 in every 3-zone layout, so with the GFW column
// (browser at x = 90) the path started 60 px away from the browser.
// Browser → 3rd parties also dips under the captions of the GFW and edge nodes it passes.
const INTENTIONAL_CHANGES: Record<string, readonly string[]> = {
  noGfw_cdn: ["browser-third-parties"],
  gfw_cdn: ["browser-third-parties"],
  gfw_cdn_4: ["browser-third-parties"],
  gfw_noCdn: ["browser-third-parties"],
};

type Header = [string, string];

interface Scenario {
  layout: string;
  clientRegion: ClientRegion;
  documentHeaders: Header[];
  thirdPartyUrl?: string;
  // Third-party requests served from several CDNs and regions: one node per cluster.
  thirdParties?: { url: string; headers: Header[] }[];
}

const request = (url: string, headers: Header[] = []) => ({ url, headers });
const CLOUDFLARE_LAX = (n: number) =>
  request(`https://cdnjs.cloudflare.com/lib-${n}.js`, [["cf-ray", "8a1b2c3d4e5f-LAX"]]);
const CLOUDFRONT_FRA = (n: number) =>
  request(`https://d1.cloudfront.net/tag-${n}.js`, [["x-amz-cf-pop", "FRA56-P1"]]);
const AZURE_IAD = (n: number) =>
  request(`https://media-us2.digital.vendor.com/m-${n}.js`, [
    ["x-azure-ref", "Ref A: 1 Ref B: IAD30EDGE0815 Ref C: 2026-01-01"],
  ]);
const DIRECT_LONG_HOST = (n: number) =>
  request(`https://a-very-long-subdomain.of.some-analytics-vendor.com/${n}.js`);

// Two clusters: Cloudflare in the United States and CloudFront in Europe.
const TWO_CLUSTERS = [CLOUDFLARE_LAX(1), CLOUDFLARE_LAX(2), CLOUDFRONT_FRA(1)];
const GOOGLE = (n: number) =>
  request(`https://fonts.googleapis.com/css-${n}`, [["server", "Google Frontend"]]);
const FASTLY = (n: number) =>
  request(`https://cdn.fastly-vendor.net/${n}.js`, [["x-served-by", "cache-sin18034-SIN"]]);
// Four providers, with the widest captions a cluster can have.
const FOUR_CLUSTERS = [
  AZURE_IAD(1),
  AZURE_IAD(2),
  AZURE_IAD(3),
  AZURE_IAD(4),
  CLOUDFLARE_LAX(1),
  CLOUDFLARE_LAX(2),
  CLOUDFLARE_LAX(3),
  DIRECT_LONG_HOST(1),
  DIRECT_LONG_HOST(2),
  request("https://pixel.tracker.io/p.gif"),
  GOOGLE(1),
];
// Six providers capped to five clusters: the two smallest CDNs merge into Other.
const FIVE_CLUSTERS = [...FOUR_CLUSTERS, GOOGLE(2), CLOUDFRONT_FRA(1), FASTLY(1)];

const CLOUDFLARE: Header[] = [
  ["cf-ray", "8a1b2c3d4e5f-LHR"],
  ["server", "cloudflare"],
];

const SCENARIOS: Scenario[] = [
  {
    layout: "noGfw_cdn",
    clientRegion: "default",
    documentHeaders: CLOUDFLARE,
    thirdPartyUrl: "https://widgets.thirdparty.com/embed.js",
  },
  { layout: "noGfw_noCdn", clientRegion: "default", documentHeaders: [] },
  {
    layout: "noGfw_noCdn_thirdParties",
    clientRegion: "default",
    documentHeaders: [],
    thirdPartyUrl: "https://widgets.thirdparty.com/embed.js",
  },
  {
    layout: "gfw_cdn",
    clientRegion: "cn",
    documentHeaders: CLOUDFLARE,
    thirdPartyUrl: "https://widgets.thirdparty.com/embed.js",
  },
  {
    // A European third party gets its own zone between the edge and the origin.
    layout: "gfw_cdn_4",
    clientRegion: "cn",
    documentHeaders: CLOUDFLARE,
    thirdPartyUrl: "https://static.analytics.de/tag.js",
  },
  {
    layout: "gfw_noCdn",
    clientRegion: "cn",
    documentHeaders: [],
    thirdPartyUrl: "https://widgets.thirdparty.com/embed.js",
  },
  {
    layout: "noGfw_cdn_2clusters",
    clientRegion: "default",
    documentHeaders: CLOUDFLARE,
    thirdParties: TWO_CLUSTERS,
  },
  {
    layout: "noGfw_noCdn_4clusters",
    clientRegion: "default",
    documentHeaders: [],
    thirdParties: FOUR_CLUSTERS,
  },
  {
    layout: "noGfw_cdn_5clusters",
    clientRegion: "default",
    documentHeaders: CLOUDFLARE,
    thirdParties: FIVE_CLUSTERS,
  },
  {
    layout: "gfw_cdn_5clusters",
    clientRegion: "cn",
    documentHeaders: CLOUDFLARE,
    thirdParties: FIVE_CLUSTERS,
  },
  {
    layout: "gfw_noCdn_2clusters",
    clientRegion: "cn",
    documentHeaders: [],
    thirdParties: TWO_CLUSTERS,
  },
];

function rawEntry(url: string, mimeType: string, headers: Header[] = []) {
  return {
    pageref: "page_1",
    startedDateTime: "2026-01-01T00:00:00.000Z",
    time: 40,
    request: { url, method: "GET" },
    response: {
      status: 200,
      headers: headers.map(([name, value]) => ({ name, value })),
      content: { mimeType, size: 5000 },
      bodySize: 1200,
      headersSize: 300,
    },
    timings: { blocked: -1, dns: 5, connect: 10, ssl: -1, send: 1, wait: 20, receive: 4 },
  };
}

function syntheticFlow(scenario: Scenario) {
  const entries = [
    rawEntry("https://example.com/", "text/html", scenario.documentHeaders),
    rawEntry("https://example.com/app.css", "text/css", scenario.documentHeaders),
    rawEntry("https://example.com/app.js", "application/javascript", scenario.documentHeaders),
  ];
  if (scenario.thirdPartyUrl) entries.push(rawEntry(scenario.thirdPartyUrl, "text/javascript"));
  for (const { url, headers } of scenario.thirdParties ?? []) {
    entries.push(rawEntry(url, "text/javascript", headers));
  }
  const har = parseHar({
    log: {
      pages: [
        {
          id: "page_1",
          title: "Example",
          startedDateTime: "2026-01-01T00:00:00.000Z",
          pageTimings: { onContentLoad: 120, onLoad: 300 },
        },
      ],
      entries,
    },
  } as unknown as Parameters<typeof parseHar>[0]);
  return generateFlow([{ name: "Home", har }], { clientRegion: scenario.clientRegion });
}

type Props = ComponentProps<typeof NodeRenderer>;
type Direction = "request" | "response" | undefined;

// Every path active (or historical) with a timing label, in each lane.
function states(base: Pick<Props, "nodes" | "paths">): Record<string, Props> {
  const present = base.nodes.filter((n) => n.present).map((n) => n.id);
  const ids = base.paths.map((p) => p.id);
  // Paths to stacked clusters carry their average, as wide as it gets in practice.
  const timing = (id: string) => (id.startsWith("browser-third-parties:") ? "avg 1234ms" : "120ms");
  const timings = Object.fromEntries(ids.map((id) => [id, timing(id)])) as Record<PathId, string>;
  const directions = (direction: Direction) =>
    direction
      ? (Object.fromEntries(ids.map((id) => [id, direction])) as Record<PathId, typeof direction>)
      : undefined;
  const active = (direction: Direction): Props => ({
    ...base,
    activeNodes: present,
    activePaths: ids,
    pathTimings: timings,
    pathDirections: directions(direction),
  });
  const history = (direction: Direction): Props => ({
    ...base,
    activeNodes: [],
    activePaths: [],
    historicalPaths: Object.fromEntries(
      ids.map((id) => [id, { timing: timing(id), direction }])
    ) as Props["historicalPaths"],
  });
  return {
    idle: { ...base, activeNodes: [], activePaths: [] },
    center: active(undefined),
    request: active("request"),
    response: active("response"),
    historyCenter: history(undefined),
    historyRequest: history("request"),
    historyResponse: history("response"),
  };
}

interface TextGeometry {
  text: string;
  x: number;
  y: number;
  // Only recorded for text that starts at x (captions beside a stacked cluster); the rest
  // is centred on it.
  anchor?: "start";
}

interface PathGeometry {
  // Every <path> of the group: the base path, or the dimmed and the active lane.
  d: { id: string | null; d: string }[];
  labels: TextGeometry[];
}

interface Geometry {
  zones: TextGeometry[];
  paths: Record<string, PathGeometry>;
  nodes: { centre: [number, number]; texts: TextGeometry[] }[];
}

const numbers = (value: string) => (value.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const commands = (d: string) => d.replace(/[^A-Za-z]/g, "");

const texts = (root: Element): TextGeometry[] =>
  [...root.querySelectorAll("text")].map((t) => ({
    text: t.textContent ?? "",
    x: Number(t.getAttribute("x")),
    y: Number(t.getAttribute("y")),
    ...(t.getAttribute("text-anchor") === "start" ? { anchor: "start" as const } : {}),
  }));

// The SVG children are: <defs>, the zone bands group, one group per path, one group per node.
function extract(markup: string, pathIds: string[]): Geometry {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const groups = [...host.querySelector("#diagram-svg")!.children].filter(
    (el) => el.tagName.toLowerCase() === "g"
  );
  const [zones, ...rest] = groups;
  const pathGroups = rest.slice(0, pathIds.length);
  const nodeGroups = rest.slice(pathIds.length);
  return {
    zones: texts(zones),
    paths: Object.fromEntries(
      pathGroups.map((g, i) => [
        pathIds[i],
        {
          d: [...g.querySelectorAll("path")].map((p) => ({
            id: p.getAttribute("id"),
            d: p.getAttribute("d")!,
          })),
          labels: texts(g),
        },
      ])
    ),
    nodes: nodeGroups.map((g) => {
      const [x, y] = numbers(g.querySelector("g[transform]")!.getAttribute("transform")!);
      return { centre: [x, y], texts: texts(g) };
    }),
  };
}

function renderGeometry(): Record<string, Record<string, Geometry>> {
  const result: Record<string, Record<string, Geometry>> = {};
  for (const scenario of SCENARIOS) {
    const flow = syntheticFlow(scenario);
    const { nodes, paths } = flow.pageAnalyses[0];
    const ids = paths.map((p) => p.id);
    result[scenario.layout] = Object.fromEntries(
      Object.entries(states({ nodes, paths })).map(([name, props]) => [
        name,
        extract(renderToStaticMarkup(<NodeRenderer {...props} />), ids),
      ])
    );
  }
  return result;
}

type Point = [number, number];

function cubic(d: number[], t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return [a * d[0] + b * d[2] + c * d[4] + e * d[6], a * d[1] + b * d[3] + c * d[5] + e * d[7]];
}

// Symmetric Hausdorff distance between two cubic Bezier curves, sampled.
function curveDistance(a: number[], b: number[]): number {
  const sample = (d: number[]) => Array.from({ length: 81 }, (_, i) => cubic(d, i / 80));
  const pa = sample(a);
  const pb = sample(b);
  const oneWay = (from: Point[], to: Point[]) =>
    Math.max(...from.map(([x, y]) => Math.min(...to.map(([u, v]) => Math.hypot(x - u, y - v)))));
  return Math.max(oneWay(pa, pb), oneWay(pb, pa));
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Separate boxes keep at least this far apart, horizontally or vertically.
const BOX_SEPARATION = 8;
// Monospace glyphs are 0.6 em wide; node captions use 12-13 px, path labels 12 px.
const CHAR_WIDTH = 0.6 * 13;
const LABEL_CHAR_WIDTH = 0.6 * 12;
const GLYPH_RADIUS = 22;

const textBox = ({ text, x, y, anchor }: TextGeometry): Box => {
  const width = text.length * CHAR_WIDTH;
  return {
    x0: anchor === "start" ? x : x - width / 2,
    x1: anchor === "start" ? x + width : x + width / 2,
    y0: y - 11,
    y1: y + CAPTION_DESCENT,
  };
};

// TimingLabel draws its background 14 px tall, ending at the baseline, a few pixels wider
// than the text.
const labelBox = ({ text, x, y }: TextGeometry): Box => {
  const width = text.length * LABEL_CHAR_WIDTH + 8;
  return { x0: x - width / 2, x1: x + width / 2, y0: y - 14, y1: y };
};

const glyphBox = ([x, y]: [number, number]): Box => ({
  x0: x - GLYPH_RADIUS,
  x1: x + GLYPH_RADIUS,
  y0: y - GLYPH_RADIUS,
  y1: y + GLYPH_RADIUS,
});

const union = (boxes: Box[]): Box => ({
  x0: Math.min(...boxes.map((b) => b.x0)),
  y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)),
  y1: Math.max(...boxes.map((b) => b.y1)),
});

// Distance between two boxes along the axis that separates them; negative when they overlap.
const gap = (a: Box, b: Box) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);

interface Deviation {
  points: number;
  labels: number;
  curves: number;
  failures: string[];
}

function compare(
  actual: Geometry,
  expected: Geometry,
  label: string,
  dev: Deviation,
  changed: readonly string[]
) {
  const within = (kind: "points" | "labels", where: string, a: number, b: number) => {
    const delta = Math.abs(a - b);
    dev[kind] = Math.max(dev[kind], delta);
    const tolerance = kind === "points" ? POINT_TOLERANCE : LABEL_TOLERANCE;
    if (delta > tolerance) dev.failures.push(`${label} ${where}: ${a} vs ${b}`);
  };
  const sameTexts = (
    kind: "points" | "labels",
    where: string,
    a: TextGeometry[],
    b: TextGeometry[]
  ) => {
    expect(
      a.map((t) => t.text),
      `${label} ${where} texts`
    ).toEqual(b.map((t) => t.text));
    a.forEach((t, i) => {
      within(kind, `${where} "${t.text}".x`, t.x, b[i].x);
      within(kind, `${where} "${t.text}".y`, t.y, b[i].y);
    });
  };

  sameTexts("points", "zones", actual.zones, expected.zones);

  expect(actual.nodes.length, `${label} node count`).toBe(expected.nodes.length);
  actual.nodes.forEach((node, i) => {
    within("points", `node[${i}].x`, node.centre[0], expected.nodes[i].centre[0]);
    within("points", `node[${i}].y`, node.centre[1], expected.nodes[i].centre[1]);
    sameTexts("points", `node[${i}]`, node.texts, expected.nodes[i].texts);
  });

  expect(Object.keys(actual.paths), `${label} path ids`).toEqual(Object.keys(expected.paths));
  for (const [id, path] of Object.entries(actual.paths)) {
    const old = expected.paths[id];
    expect(
      path.d.map((p) => [p.id, commands(p.d), numbers(p.d).length]),
      `${label} ${id} path structure`
    ).toEqual(old.d.map((p) => [p.id, commands(p.d), numbers(p.d).length]));
    expect(path.labels.length, `${label} ${id} label count`).toBe(old.labels.length);
    if (changed.includes(id)) continue;

    path.d.forEach((p, i) => {
      const d = numbers(p.d);
      const was = numbers(old.d[i].d);
      const last = was.length - 2;
      within("points", `${id}[${i}] start.x`, d[0], was[0]);
      within("points", `${id}[${i}] start.y`, d[1], was[1]);
      within("points", `${id}[${i}] end.x`, d[last], was[last]);
      within("points", `${id}[${i}] end.y`, d[last + 1], was[last + 1]);
      const distance = curveDistance(d, was);
      dev.curves = Math.max(dev.curves, distance);
      if (distance > CURVE_TOLERANCE) dev.failures.push(`${label} ${id}[${i}] curve: ${distance}`);
    });
    sameTexts("labels", `${id} label`, path.labels, old.labels);
  }
}

describe("NodeRenderer geometry", () => {
  const actual = renderGeometry();

  if (process.env.UPDATE_BASELINE) {
    writeFileSync(BASELINE_PATH, JSON.stringify(actual) + "\n");
  }

  const baseline = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as ReturnType<typeof renderGeometry>)
    : {};

  it("has a baseline for every layout", () => {
    expect(Object.keys(baseline)).toEqual(SCENARIOS.map((s) => s.layout));
  });

  for (const scenario of SCENARIOS) {
    it(`attaches every ${scenario.layout} path to the nodes it joins`, () => {
      const { nodes, paths } = syntheticFlow(scenario).pageAnalyses[0];
      const geometry = actual[scenario.layout].idle;
      const present = nodes.filter((n) => n.present);
      const centres = new Map(present.map((n, i) => [n.id, geometry.nodes[i].centre]));
      for (const path of paths) {
        const from = centres.get(path.from);
        const to = centres.get(path.to);
        if (!from || !to) continue;
        const d = numbers(geometry.paths[path.id].d[0].d);
        const [endX, endY] = d.slice(-2);
        expect(Math.hypot(d[0] - from[0], d[1] - from[1]), `${path.id} start`).toBeLessThan(
          ATTACH_DISTANCE
        );
        expect(Math.hypot(endX - to[0], endY - to[1]), `${path.id} end`).toBeLessThan(
          ATTACH_DISTANCE
        );
      }
    });

    it(`routes the ${scenario.layout} third-party paths below the captions they pass`, () => {
      const { nodes, paths } = syntheticFlow(scenario).pageAnalyses[0];
      const geometry = actual[scenario.layout].idle;
      const present = nodes.filter((n) => n.present);
      const centre = (id: string) => geometry.nodes[present.findIndex((n) => n.id === id)].centre;
      const thirdPartyPaths = paths.filter(
        (p) => nodeKind(p.to) === "third-parties" && present.some((n) => n.id === p.to)
      );
      const clustered = thirdPartyPaths.length > 1;
      let checked = 0;
      for (const path of thirdPartyPaths) {
        const d = numbers(geometry.paths[path.id].d[0].d);
        const label = actual[scenario.layout].center.paths[path.id].labels[0];
        const [browserX] = centre("browser");
        const [targetX] = centre(path.to);
        for (const id of ["gfw", "edge", "origin"] as const) {
          const index = present.findIndex((n) => n.id === id);
          if (index < 0) continue;
          const node = geometry.nodes[index];
          // Only the nodes the path passes on its way: origin shares the column of a
          // single third-parties node, or sits past it in its own zone.
          if (node.centre[0] <= browserX || node.centre[0] >= targetX) continue;
          checked++;
          const bottom = Math.max(...node.texts.map((t) => t.y)) + CAPTION_DESCENT;
          // Coarse samples (t = 0.1 ... 0.9) plus a fine pass over the part below the glyph.
          const samples = [
            ...Array.from({ length: 9 }, (_, i) => (i + 1) / 10),
            ...Array.from({ length: 101 }, (_, i) => i / 100),
          ];
          for (const t of samples) {
            const [x, y] = cubic(d, t);
            if (Math.abs(x - node.centre[0]) > CAPTION_HALF_WIDTH[id]) continue;
            expect(y, `${path.id} under ${id} t=${t} at x=${Math.round(x)}`).toBeGreaterThanOrEqual(
              bottom + CAPTION_CLEARANCE
            );
          }
          // A single path labels the lowest point of its dip; clusters label their arrival.
          if (!clustered)
            expect(label.y, `${id} label`).toBeGreaterThan(bottom + CAPTION_CLEARANCE);
        }
      }
      // Without a CDN, a single third-parties node shares the origin column: nothing to pass.
      const passesNothing = scenario.layout.startsWith("noGfw_noCdn") && !clustered;
      if (!passesNothing) expect(checked, "captions passed").toBeGreaterThan(0);
    });

    if (scenario.thirdParties) {
      it(`keeps the ${scenario.layout} captions and timing labels apart`, () => {
        for (const state of ["center", "historyCenter"] as const) {
          const geometry = actual[scenario.layout][state];
          // Every glyph, caption line and timing label, with what it belongs to: the lines
          // of one caption stack by design.
          const boxes = [
            ...geometry.nodes.flatMap((node, i) => [
              { owner: `node[${i}]`, name: `node[${i}] glyph`, ...glyphBox(node.centre) },
              ...node.texts.map((t) => ({
                owner: `node[${i}]`,
                name: `"${t.text}"`,
                ...textBox(t),
              })),
            ]),
            ...Object.entries(geometry.paths).flatMap(([id, path]) =>
              path.labels.map((label) => ({ owner: id, name: `${id} label`, ...labelBox(label) }))
            ),
          ];
          for (const [i, a] of boxes.entries()) {
            for (const b of boxes.slice(i + 1)) {
              if (a.owner === b.owner) continue;
              expect(gap(a, b), `${state}: ${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(
                BOX_SEPARATION
              );
            }
          }
        }
      });

      it(`keeps the ${scenario.layout} cluster paths off every caption but the browser's`, () => {
        const { nodes, paths } = syntheticFlow(scenario).pageAnalyses[0];
        const geometry = actual[scenario.layout].idle;
        const present = nodes.filter((n) => n.present);
        // The browser caption sits where every path leaves; the paths avoid it when they can.
        const captions = [
          ...geometry.nodes.flatMap((node, i) =>
            present[i].id === "browser" ? [] : node.texts.map((t) => ({ t, ...textBox(t) }))
          ),
          // Zone captions below the zone names: the GFW zone and the cache sub-zone.
          ...geometry.zones.filter((z) => z.y > 40).map((t) => ({ t, ...textBox(t) })),
        ];
        for (const path of paths.filter((p) => p.id.startsWith("browser-third-parties:"))) {
          const d = numbers(geometry.paths[path.id].d[0].d);
          for (let i = 0; i <= 200; i++) {
            const [x, y] = cubic(d, i / 200);
            for (const c of captions) {
              const inside = x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1;
              expect(
                inside,
                `${path.id} at (${Math.round(x)}, ${Math.round(y)}) crosses "${c.t.text}"`
              ).toBe(false);
            }
          }
        }
      });

      it(`stacks the ${scenario.layout} cluster nodes inside the diagram, in their own zone`, () => {
        const { nodes } = syntheticFlow(scenario).pageAnalyses[0];
        const geometry = actual[scenario.layout].idle;
        const present = nodes.filter((n) => n.present);
        const clusters = present
          .map((n, i) => ({ n, node: geometry.nodes[i] }))
          .filter(({ n }) => n.id.startsWith("third-parties:"));
        expect(clusters.length).toBe(Number(/(\d)clusters/.exec(scenario.layout)![1]));
        // Zone captions sit along the top; the cache and firewall captions further down.
        const lastZone = geometry.zones.filter((z) => z.y < 40).at(-1)!;
        expect(lastZone.text).toMatch(/THIRD PARTIES|[A-Z]/);
        const ys = clusters.map(({ node }) => node.centre[1]);
        expect(ys).toEqual([...ys].sort((a, b) => a - b));
        for (const { node } of clusters) {
          expect(node.centre[0], "same column").toBe(clusters[0].node.centre[0]);
          const box = union([glyphBox(node.centre), ...node.texts.map(textBox)]);
          expect(box.x0).toBeGreaterThanOrEqual(0);
          expect(box.x1).toBeLessThanOrEqual(900);
          expect(box.y0, "below the zone captions").toBeGreaterThan(lastZone.y + 8);
          expect(box.y1).toBeLessThanOrEqual(480);
        }
      });
    }

    it(`keeps the ${scenario.layout} geometry`, () => {
      const expected = baseline[scenario.layout];
      expect(Object.keys(actual[scenario.layout])).toEqual(Object.keys(expected));
      const dev: Deviation = { points: 0, labels: 0, curves: 0, failures: [] };
      const changed = INTENTIONAL_CHANGES[scenario.layout] ?? [];
      for (const [state, geometry] of Object.entries(actual[scenario.layout])) {
        compare(geometry, expected[state], `${scenario.layout}/${state}`, dev, changed);
      }
      if (process.env.REPORT_DEVIATION) {
        console.info(
          `${scenario.layout}: points ${dev.points.toFixed(2)} px, path labels ${dev.labels.toFixed(2)} px, curves ${dev.curves.toFixed(2)} px`
        );
      }
      expect(dev.failures).toEqual([]);
    });
  }
});
