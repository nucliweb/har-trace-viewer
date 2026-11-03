import { useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import type { Key } from "ink";
import {
  buildWaterfall,
  collectFindings,
  compareFlows,
  filterWaterfallRows,
  parseResourceQuery,
  sortWaterfallRows,
  stepAtPair,
} from "@htv/core";
import type { Flow, ResourceSort, WaterfallAxis, WaterfallParty } from "@htv/core";
import { findingsRegion } from "./findings-view.js";
import { helpRegion } from "./help-view.js";
import { SORT_CYCLE, nextSort, resourcesRegion } from "./resources-view.js";
import { waterfallRegion } from "./waterfall-view.js";
import { frame, lineWidth, padLine, seg, truncateLine } from "./lines.js";
import type { Line } from "./lines.js";
import {
  cacheRegion,
  compareOverviewRegion,
  hostDeltaRegion,
  hostsRegion,
  overviewRegion,
  pageLabel,
  pairStepsRegion,
  stepsRegion,
} from "./views.js";

interface Props {
  flow: Flow;
  /** The second flow of a comparison (B); `flow` is A. */
  compare?: Flow;
  version: string;
  /** Terminal size; the window size of stdout when omitted. */
  rows?: number;
  columns?: number;
}

const TABS = [
  "Findings",
  "Waterfall",
  "Resources",
  "Overview",
  "Steps",
  "Hosts",
  "Cache & network",
] as const;
// Shorter tab labels for a terminal where the pages of a flow would not fit beside the tabs.
const SHORT_TABS: Partial<Record<(typeof TABS)[number], string>> = { "Cache & network": "Cache" };
type Side = "a" | "b";
// The party filter of the waterfall, cycled with f.
const PARTIES: (WaterfallParty | null)[] = [null, "first", "third"];
const nextParty = (party: WaterfallParty | null) =>
  PARTIES[(PARTIES.indexOf(party) + 1) % PARTIES.length];

// The header block and the status bar around the scrolling region.
const HEADER_LINES = 3;
const STATUS_LINES = 1;
const MIN_COLUMNS = 60;

/** The terminal size, which re-renders on resize; `rows` and `columns` override it. */
function useTerminalSize(rows?: number, columns?: number) {
  const size = useWindowSize();
  return { rows: rows ?? size.rows, columns: columns ?? size.columns };
}

/** The framed header: the version and the context in the top edge, the tabs and the pages inside. */
function headerLines(
  width: number,
  version: string,
  context: string,
  tab: number,
  pages: { names: string[]; current: number } | null
): Line[] {
  const title = ` htv v${version} `;
  const ctx = context ? ` ${context} ` : "";
  const fill = Math.max(1, width - 4 - title.length - ctx.length);
  const top: Line = [
    frame("╭─"),
    seg(title, { bold: true, color: "cyan" }),
    frame("─".repeat(fill)),
    seg(ctx, { bold: true }),
    frame("─╮"),
  ];
  // Seven tabs and the pages of a flow share the line. The tabs sit two spaces apart; the
  // highlight of the current one takes the space on each side of it.
  const tabLine = (short: boolean): Line => {
    const out: Line = [];
    TABS.forEach((name, i) => {
      const label = `${i + 1} ${short ? (SHORT_TABS[name] ?? name) : name}`;
      const selected = i === tab;
      if (i > 0) out.push(seg(selected || i - 1 === tab ? " " : "  "));
      out.push(
        seg(
          selected ? ` ${label} ` : label,
          selected ? { inverse: true, bold: true, color: "cyan" } : {}
        )
      );
    });
    return out;
  };
  const pageStrip = (label: boolean): Line =>
    pages
      ? [
          ...(label ? [seg("Pages ", { dim: true })] : []),
          ...pages.names.flatMap((name, i) => [
            seg(` ${name} `, i === pages.current ? { inverse: true } : { dim: true }),
            seg(" "),
          ]),
        ]
      : [];
  const inner = width - 4;
  // When the line is short of room, the tabs shorten first, then the strip loses its label,
  // then goes (a convenience: the context names the page anyway), then the tabs shorten alone.
  const fits = (tabs: Line, strip: Line) =>
    lineWidth(tabs) + (strip.length > 0 ? 2 + lineWidth(strip) : 0) <= inner;
  const [tabs, strip] = [
    [tabLine(false), pageStrip(true)],
    [tabLine(true), pageStrip(true)],
    [tabLine(true), pageStrip(false)],
    [tabLine(false), []],
  ].find(([t, s]) => fits(t, s)) ?? [tabLine(true), []];
  const gap = strip.length > 0 ? Math.max(1, inner - lineWidth(tabs) - lineWidth(strip)) : 0;
  const mid: Line = [
    frame("│ "),
    ...padLine(truncateLine([...tabs, seg(" ".repeat(gap)), ...strip], inner), inner),
    frame(" │"),
  ];
  const bottom: Line = [frame(`╰${"─".repeat(width - 2)}╯`)];
  return [top, mid, bottom];
}

function LineView({ line }: { line: Line }) {
  return (
    <Text wrap="truncate-end">
      {line.length === 0
        ? " "
        : line.map((s, i) => (
            <Text key={i} color={s.color} bold={s.bold} dimColor={s.dim} inverse={s.inverse}>
              {s.text}
            </Text>
          ))}
    </Text>
  );
}

/**
 * The report in the terminal: the findings, the request waterfall, the requests as a sortable
 * table, an overview of the metrics, the diagram's steps, the hosts and the cache analysis,
 * one tab each, drawn as framed panels. The waterfall and the resources share a filter with
 * the field language of parseResourceQuery. A comparison shows both flows with their B − A
 * deltas. `?` shows the keys and the filter syntax.
 */
export function TuiApp({ flow, compare, version, rows, columns }: Props) {
  const { exit } = useApp();
  const size = useTerminalSize(rows, columns);
  const comparison = useMemo(() => (compare ? compareFlows(flow, compare) : null), [flow, compare]);
  const [tab, setTab] = useState(0);
  const [step, setStep] = useState(0);
  const [page, setPage] = useState(0);
  const [side, setSide] = useState<Side>("a");
  const [scroll, setScroll] = useState(0);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [party, setParty] = useState<WaterfallParty | null>(null);
  const [axis, setAxis] = useState<WaterfallAxis>("end");
  const [sort, setSort] = useState<ResourceSort>(SORT_CYCLE[0]);
  const [help, setHelp] = useState(false);

  const names = useMemo(
    () => ({ a: flow.pages[0].name, b: compare?.pages[0].name ?? "" }),
    [flow, compare]
  );
  const findings = useMemo(
    () => ({ a: collectFindings(flow), b: compare ? collectFindings(compare) : [] }),
    [flow, compare]
  );
  // The tabs that show one side of a comparison at a time, picked with a/b.
  const sided = (tabName: string) =>
    ["Findings", "Waterfall", "Resources", "Cache & network"].includes(tabName);
  const stepCount = comparison ? comparison.pairs.length : flow.steps.length;
  const pageCount = flow.pages.length;
  const width = Math.max(MIN_COLUMNS, size.columns);
  const viewport = Math.max(1, size.rows - HEADER_LINES - STATUS_LINES);
  const current = TABS[tab];
  // The tabs that list the page's requests, which share the filter and the party.
  const listing = current === "Waterfall" || current === "Resources";

  // The page the waterfall and the resources show: the current page, or the side picked in a
  // comparison.
  const shownPage = compare ? (side === "a" ? flow : compare).pages[0] : flow.pages[page];
  const waterfall = useMemo(
    () => (listing ? buildWaterfall(shownPage.har, shownPage.trace) : null),
    [listing, shownPage]
  );
  const filtered = useMemo(() => {
    if (!waterfall) return null;
    const rows = filterWaterfallRows(waterfall.rows, { search, party: party ?? undefined });
    return { rows, problems: parseResourceQuery(search).problems };
  }, [waterfall, search, party]);
  const listView = useMemo(() => {
    if (!waterfall || !filtered) return null;
    const { rows, problems } = filtered;
    const filter = { search, searching, problems };
    if (current === "Resources") {
      const sorted = sortWaterfallRows(rows, sort);
      return resourcesRegion(waterfall.rows.length, sorted, { ...filter, party, sort }, width);
    }
    return waterfallRegion(waterfall, rows, { ...filter, party, axis }, width);
  }, [current, waterfall, filtered, search, searching, party, axis, sort, width]);

  const region = useMemo((): Line[] => {
    if (help) return helpRegion(width);
    switch (current) {
      case "Findings": {
        const list = compare ? findings[side] : findings.a.filter((f) => f.page.index === page);
        return findingsRegion(list, width);
      }
      case "Waterfall":
      case "Resources":
        return listView?.lines ?? [];
      case "Overview":
        return comparison
          ? compareOverviewRegion(comparison, width)
          : overviewRegion(flow, page, width);
      case "Steps":
        if (comparison && compare) {
          const views = {
            a: stepAtPair(comparison.pairs, step, "a"),
            b: stepAtPair(comparison.pairs, step, "b"),
          };
          return pairStepsRegion(flow, compare, comparison.pairs, step, views, width, viewport);
        }
        return stepsRegion(flow, step, width, viewport);
      case "Hosts":
        return comparison
          ? hostDeltaRegion(comparison, names, width)
          : hostsRegion(flow, page, width);
      case "Cache & network": {
        const shown = compare ? (side === "a" ? flow : compare) : flow;
        const pageIndex = compare ? 0 : page;
        const { cacheReport, networkReport } = shown.pageAnalyses[pageIndex];
        return cacheRegion(cacheReport, width, networkReport);
      }
    }
  }, [
    current,
    step,
    page,
    side,
    width,
    viewport,
    flow,
    compare,
    comparison,
    names,
    findings,
    listView,
    help,
  ]);

  // Lines at the top of the region that stay in view while the rest scrolls.
  const pinned = listing && !help ? (listView?.pinned ?? 0) : 0;
  const rowsViewport = Math.max(1, viewport - pinned);
  const maxScroll = Math.max(0, region.length - pinned - rowsViewport);
  const scrollTo = (value: number) => setScroll(Math.min(maxScroll, Math.max(0, value)));
  const showTab = (index: number) => {
    setTab((index + TABS.length) % TABS.length);
    setScroll(0);
  };
  const movePage = (delta: number) => {
    setPage((p) => (p + delta + pageCount) % pageCount);
    setScroll(0);
  };
  const moveStep = (delta: number) => {
    setStep((s) => Math.min(stepCount - 1, Math.max(0, s + delta)));
    setScroll(0);
  };

  const editSearch = (input: string, key: Key) => {
    if (key.escape) {
      setSearch("");
      setSearching(false);
    } else if (key.return) setSearching(false);
    else if (key.backspace || key.delete) setSearch((q) => q.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) setSearch((q) => q + input);
    setScroll(0);
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (help) {
      setHelp(false);
      return;
    }
    if (searching) {
      editSearch(input, key);
      return;
    }
    if (listing && key.escape && search) {
      setSearch("");
      setScroll(0);
      return;
    }
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    const digit = Number(input);
    if (digit >= 1 && digit <= TABS.length) showTab(digit - 1);
    else if (key.tab) showTab(tab + (key.shift ? -1 : 1));
    else if (key.rightArrow || key.leftArrow) {
      const delta = key.rightArrow ? 1 : -1;
      if (current === "Steps") moveStep(delta);
      else if (!compare && pageCount > 1) movePage(delta);
    } else if (key.downArrow) scrollTo(scroll + 1);
    else if (key.upArrow) scrollTo(scroll - 1);
    else if (key.pageDown || input === " ") scrollTo(scroll + rowsViewport);
    else if (key.pageUp) scrollTo(scroll - rowsViewport);
    else if (input === "?") setHelp(true);
    else if (input === "/" && listing) {
      setSearching(true);
      setScroll(0);
    } else if (input === "f" && listing) {
      setParty(nextParty);
      setScroll(0);
    } else if (input === "z" && current === "Waterfall") {
      setAxis((a) => (a === "end" ? "load" : "end"));
    } else if (input === "s" && current === "Resources") {
      setSort(nextSort);
      setScroll(0);
    } else if (input === "S" && current === "Resources") {
      setSort((s) => ({ ...s, direction: s.direction === "asc" ? "desc" : "asc" }));
      setScroll(0);
    } else if ((input === "p" || input === "P") && !compare && pageCount > 1) {
      movePage(input === "p" ? 1 : -1);
    } else if ((input === "a" || input === "b") && compare) {
      setSide(input);
      setScroll(0);
    }
  });

  const context = compare
    ? sided(current)
      ? `${current === "Cache & network" ? "Cache" : current} · ${side.toUpperCase()} ${names[side]}`
      : `A ${names.a} · B ${names.b}`
    : pageLabel(flow, page);
  const pages =
    !compare && pageCount > 1 ? { names: flow.pages.map((p) => p.name), current: page } : null;
  const header = headerLines(width, version, context, tab, pages);
  const scrolled = region.slice(pinned);
  const visible = [...region.slice(0, pinned), ...scrolled.slice(scroll, scroll + rowsViewport)];

  const listKeys = searching
    ? ["type to filter", "Enter keep", "Esc clear"]
    : current === "Waterfall"
      ? ["/ filter", "f party", "z axis", search ? "Esc clear filter" : null]
      : current === "Resources"
        ? ["/ filter", "f party", "s sort", "S reverse", search ? "Esc clear filter" : null]
        : [];
  const keys = help
    ? "any key closes the help"
    : searching
      ? listKeys.join("  ·  ")
      : [
          `1-${TABS.length}/Tab tabs`,
          current === "Steps" ? "←/→ step" : pages ? "←/→ page" : null,
          maxScroll > 0 ? (width < 100 ? "↑/↓ scroll" : "↑/↓ PgUp/PgDn scroll") : null,
          compare && sided(current) ? "a/b side" : null,
          ...listKeys,
          "? help",
          "q quit",
        ]
          .filter(Boolean)
          // Narrow terminals get a tighter separator, so that the help fits beside the position.
          .join(width < 100 ? " · " : "  ·  ");
  const shownRows = Math.min(rowsViewport, Math.max(0, scrolled.length - scroll));
  const position = maxScroll > 0 ? `${scroll + 1}-${scroll + shownRows}/${scrolled.length} ` : "";
  const statusText = ` ${keys}`;
  const statusGap = Math.max(1, width - statusText.length - position.length);
  const status: Line = [seg(`${statusText}${" ".repeat(statusGap)}${position}`, { inverse: true })];

  return (
    <Box flexDirection="column">
      {header.map((line, i) => (
        <LineView key={`h${i}`} line={line} />
      ))}
      {visible.map((line, i) => (
        <LineView key={i < pinned ? `p${i}` : scroll + i} line={line} />
      ))}
      {Array.from({ length: viewport - visible.length }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
      <LineView line={status} />
    </Box>
  );
}
