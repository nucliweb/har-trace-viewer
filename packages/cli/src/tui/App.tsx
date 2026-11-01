import { useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import type { Key } from "ink";
import {
  buildWaterfall,
  collectFindings,
  compareFlows,
  filterWaterfallRows,
  stepAtPair,
} from "@htv/core";
import type { Flow, WaterfallAxis, WaterfallParty } from "@htv/core";
import { findingsRegion } from "./findings-view.js";
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

const TABS = ["Findings", "Waterfall", "Overview", "Steps", "Hosts", "Cache & network"] as const;
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
  // Six tabs and the pages of a flow share the line: the padding inside each label keeps
  // them apart.
  const tabs: Line = TABS.map((name, i) =>
    seg(` ${i + 1} ${name} `, i === tab ? { inverse: true, bold: true, color: "cyan" } : {})
  );
  const strip: Line = pages
    ? [
        seg("Pages ", { dim: true }),
        ...pages.names.flatMap((name, i) => [
          seg(` ${name} `, i === pages.current ? { inverse: true } : { dim: true }),
          seg(" "),
        ]),
      ]
    : [];
  const inner = width - 4;
  // The strip is a convenience: when it does not fit next to the tabs, the context names the page.
  if (lineWidth(tabs) + 2 + lineWidth(strip) > inner) strip.length = 0;
  const gap = Math.max(1, inner - lineWidth(tabs) - lineWidth(strip));
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
 * The report in the terminal: the findings, the request waterfall, an overview of the metrics,
 * the diagram's steps, the hosts and the cache analysis, one tab each, drawn as framed panels. A comparison shows
 * both flows with their B − A deltas.
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
    tabName === "Findings" || tabName === "Waterfall" || tabName === "Cache & network";
  const stepCount = comparison ? comparison.pairs.length : flow.steps.length;
  const pageCount = flow.pages.length;
  const width = Math.max(MIN_COLUMNS, size.columns);
  const viewport = Math.max(1, size.rows - HEADER_LINES - STATUS_LINES);
  const current = TABS[tab];

  // The page the waterfall shows: the current page, or the side picked in a comparison.
  const shownPage = compare ? (side === "a" ? flow : compare).pages[0] : flow.pages[page];
  const waterfall = useMemo(
    () => (current === "Waterfall" ? buildWaterfall(shownPage.har, shownPage.trace) : null),
    [current, shownPage]
  );
  const waterfallView = useMemo(() => {
    if (!waterfall) return null;
    const rows = filterWaterfallRows(waterfall.rows, { search, party: party ?? undefined });
    return waterfallRegion(waterfall, rows, { search, searching, party, axis }, width);
  }, [waterfall, search, searching, party, axis, width]);

  const region = useMemo((): Line[] => {
    switch (current) {
      case "Findings": {
        const list = compare ? findings[side] : findings.a.filter((f) => f.page.index === page);
        return findingsRegion(list, width);
      }
      case "Waterfall":
        return waterfallView?.lines ?? [];
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
    waterfallView,
  ]);

  // Lines at the top of the region that stay in view while the rest scrolls.
  const pinned = current === "Waterfall" ? (waterfallView?.pinned ?? 0) : 0;
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
    if (searching) {
      editSearch(input, key);
      return;
    }
    if (current === "Waterfall" && key.escape && search) {
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
    else if (input === "/" && current === "Waterfall") {
      setSearching(true);
      setScroll(0);
    } else if (input === "f" && current === "Waterfall") {
      setParty(nextParty);
      setScroll(0);
    } else if (input === "z" && current === "Waterfall") {
      setAxis((a) => (a === "end" ? "load" : "end"));
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

  const waterfallHelp = searching
    ? ["type to search", "Enter keep", "Esc clear"]
    : current === "Waterfall"
      ? ["/ search", "f party", "z axis", search ? "Esc clear search" : null]
      : [];
  const help = searching
    ? waterfallHelp.join("  ·  ")
    : [
        `1-${TABS.length}/Tab tabs`,
        current === "Steps" ? "←/→ step" : pages ? "←/→ page" : null,
        maxScroll > 0 ? (width < 100 ? "↑/↓ scroll" : "↑/↓ PgUp/PgDn scroll") : null,
        compare && sided(current) ? "a/b side" : null,
        ...waterfallHelp,
        "q quit",
      ]
        .filter(Boolean)
        // Narrow terminals get a tighter separator, so that the help fits beside the position.
        .join(width < 100 ? " · " : "  ·  ");
  const shownRows = Math.min(rowsViewport, Math.max(0, scrolled.length - scroll));
  const position = maxScroll > 0 ? `${scroll + 1}-${scroll + shownRows}/${scrolled.length} ` : "";
  const statusText = ` ${help}`;
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
