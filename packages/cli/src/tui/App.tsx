import { useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import type { Key } from "ink";
import {
  buildWaterfall,
  collectFindings,
  compareFlows,
  filterWaterfallRows,
  pageDocument,
  parseResourceQuery,
  sortWaterfallRows,
  stepAtPair,
} from "@htv/core";
import type { Flow, ResourceSort, WaterfallAxis, WaterfallParty } from "@htv/core";
import { findingsRegion, hasHiddenEvidence } from "./findings-view.js";
import { helpRegion } from "./help-view.js";
import { requestRegion } from "./request-view.js";
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
import type { ColumnsRegion } from "./views.js";

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

// The request under the cursor: its entry, null until the cursor moves, and its row.
interface Cursor {
  entry: number | null;
  index: number;
}
const FIRST_ROW: Cursor = { entry: null, index: 0 };

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
  const fill = Math.max(1, width - 4 - lineWidth([seg(title + ctx)]));
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

// Any non-empty NO_COLOR turns the colours off (no-color.org); bold, dim and inverse stay.
const noColor = () => (process.env.NO_COLOR ?? "") !== "";

function LineView({ line }: { line: Line }) {
  const colored = !noColor();
  return (
    <Text wrap="truncate-end">
      {line.length === 0
        ? " "
        : line.map((s, i) => (
            <Text
              key={i}
              color={colored ? s.color : undefined}
              bold={s.bold}
              dimColor={s.dim}
              inverse={s.inverse}
            >
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
  // The request under the cursor of the waterfall and the resources: the entry it points at,
  // and its index in the list, which the cursor falls back to when a filter hides the entry.
  const [cursor, setCursor] = useState<Cursor>(FIRST_ROW);
  const [detail, setDetail] = useState(false);
  // The scroll of the list behind the details, restored when they close.
  const [listScroll, setListScroll] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [columnOffset, setColumnOffset] = useState(0);

  const names = useMemo(
    () => ({ a: flow.pages[0].name, b: compare?.pages[0].name ?? "" }),
    [flow, compare]
  );
  const findings = useMemo(
    () => ({ a: collectFindings(flow), b: compare ? collectFindings(compare) : [] }),
    [flow, compare]
  );
  const pageFindings = compare ? findings[side] : findings.a.filter((f) => f.page.index === page);
  // The tabs that show one side of a comparison at a time, picked with a/b.
  const sided = (tabName: string) =>
    ["Findings", "Waterfall", "Resources", "Cache & network"].includes(tabName);
  const stepCount = comparison ? comparison.pairs.length : flow.steps.length;
  const pageCount = flow.pages.length;
  const width = Math.max(MIN_COLUMNS, size.columns);
  const narrow = width < 100;
  const viewport = Math.max(1, size.rows - HEADER_LINES - STATUS_LINES);
  const current = TABS[tab];
  // The tabs that list the page's requests, which share the filter, the party and the cursor.
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
  // The requests in the order the tab lists them.
  const listRows = useMemo(() => {
    if (!filtered) return [];
    return current === "Resources" ? sortWaterfallRows(filtered.rows, sort) : filtered.rows;
  }, [current, filtered, sort]);
  const rowCount = listRows.length;
  const found =
    cursor.entry === null ? -1 : listRows.findIndex((row) => row.entryIndex === cursor.entry);
  const cursorIndex =
    rowCount === 0 ? -1 : found >= 0 ? found : Math.min(cursor.index, rowCount - 1);
  const cursorRow = cursorIndex >= 0 ? listRows[cursorIndex] : null;
  const showDetail = detail && listing && cursorRow !== null;

  const listView = useMemo(() => {
    if (!waterfall || !filtered) return null;
    const state = {
      search,
      searching,
      problems: filtered.problems,
      party,
      cursor: cursorIndex >= 0 ? cursorIndex : undefined,
    };
    return current === "Resources"
      ? resourcesRegion(waterfall.rows.length, listRows, { ...state, sort }, width)
      : waterfallRegion(waterfall, listRows, { ...state, axis }, width);
  }, [
    current,
    waterfall,
    filtered,
    listRows,
    cursorIndex,
    search,
    searching,
    party,
    axis,
    sort,
    width,
  ]);

  const hostsView = useMemo((): ColumnsRegion | null => {
    if (current !== "Hosts") return null;
    return comparison
      ? hostDeltaRegion(comparison, names, width, columnOffset)
      : hostsRegion(flow, page, width, columnOffset);
  }, [current, comparison, names, flow, page, width, columnOffset]);
  const maxColumnOffset = hostsView?.maxOffset ?? 0;

  const region = useMemo((): Line[] => {
    if (help) return helpRegion(width);
    if (showDetail && cursorRow) {
      const entry = shownPage.har.entries[cursorRow.entryIndex];
      return requestRegion(cursorRow, entry, { index: cursorIndex, count: rowCount }, width);
    }
    switch (current) {
      case "Findings":
        return findingsRegion(pageFindings, width, expanded);
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
        return hostsView?.lines ?? [];
      case "Cache & network": {
        const shown = compare ? (side === "a" ? flow : compare) : flow;
        const pageIndex = compare ? 0 : page;
        const { cacheReport, networkReport } = shown.pageAnalyses[pageIndex];
        const hasDocument = pageDocument(shown.pages[pageIndex].har) !== null;
        return cacheRegion(cacheReport, width, networkReport, { hasDocument });
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
    pageFindings,
    expanded,
    listView,
    hostsView,
    help,
    showDetail,
    cursorRow,
    cursorIndex,
    rowCount,
    shownPage,
  ]);

  // The list under the cursor, and not the help or the details over it.
  const onList = listing && !help && !showDetail;
  // Lines at the top of the region that stay in view while the rest scrolls.
  const pinned = onList ? (listView?.pinned ?? 0) : 0;
  const rowsViewport = Math.max(1, viewport - pinned);
  const maxScroll = Math.max(0, region.length - pinned - rowsViewport);
  // The scroll that keeps the row at `index` in view, moving `from` as little as it can.
  const follow = (index: number, from: number) =>
    index < from ? index : index >= from + rowsViewport ? index - rowsViewport + 1 : from;
  // A resize can leave the stored scroll past the new end, so the view clamps it; on a list,
  // a sort or a filter can move the cursor out of view, so the view follows it.
  const clamped = Math.min(scroll, maxScroll);
  const offset = onList && cursorIndex >= 0 ? follow(cursorIndex, clamped) : clamped;
  const scrollTo = (value: number) => setScroll(Math.min(maxScroll, Math.max(0, value)));
  const scrollKeys = (input: string, key: Key) => {
    if (key.downArrow) scrollTo(offset + 1);
    else if (key.upArrow) scrollTo(offset - 1);
    else if (key.pageDown || input === " ") scrollTo(offset + rowsViewport);
    else if (key.pageUp) scrollTo(offset - rowsViewport);
    else if (key.home) scrollTo(0);
    else if (key.end) scrollTo(maxScroll);
    else return false;
    return true;
  };
  // Moves the cursor to the row at `target` and the view by `scrollBy` lines, as far as the
  // cursor stays in view; on the last row the view shows the end of the list.
  const moveCursor = (target: number, scrollBy = 0) => {
    if (rowCount === 0) return;
    const index = Math.min(rowCount - 1, Math.max(0, target));
    setCursor({ entry: listRows[index].entryIndex, index });
    const from = Math.min(maxScroll, Math.max(0, offset + scrollBy));
    setScroll(index === rowCount - 1 ? maxScroll : follow(index, from));
  };
  const cursorKeys = (input: string, key: Key) => {
    if (key.downArrow) moveCursor(cursorIndex + 1);
    else if (key.upArrow) moveCursor(cursorIndex - 1);
    else if (key.pageDown || input === " ") moveCursor(cursorIndex + rowsViewport, rowsViewport);
    else if (key.pageUp) moveCursor(cursorIndex - rowsViewport, -rowsViewport);
    else if (key.home) moveCursor(0);
    else if (key.end) moveCursor(rowCount - 1);
    else return false;
    return true;
  };
  const showTab = (index: number) => {
    setTab((index + TABS.length) % TABS.length);
    setScroll(0);
  };
  const movePage = (delta: number) => {
    setPage((p) => (p + delta + pageCount) % pageCount);
    setCursor(FIRST_ROW);
    setScroll(0);
  };
  const moveStep = (delta: number) => {
    setStep((s) => Math.min(stepCount - 1, Math.max(0, s + delta)));
    setScroll(0);
  };
  const openDetail = () => {
    setListScroll(offset);
    setDetail(true);
    setScroll(0);
  };
  const closeDetail = () => {
    setDetail(false);
    setScroll(listScroll);
  };
  const stepRequest = (delta: number) => {
    const index = Math.min(rowCount - 1, Math.max(0, cursorIndex + delta));
    setCursor({ entry: listRows[index].entryIndex, index });
    setScroll(0);
  };
  const moveColumns = (delta: number) => {
    setColumnOffset(
      Math.min(maxColumnOffset, Math.max(0, Math.min(columnOffset, maxColumnOffset) + delta))
    );
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
      if (input === "?" || input === "q" || key.escape) {
        setHelp(false);
        setScroll(0);
      } else scrollKeys(input, key);
      return;
    }
    // The details close like the help: with Esc or q, and with the Enter that opened them.
    if (showDetail) {
      if (key.escape || key.return || input === "q") closeDetail();
      else if (input === "n" || input === "N") stepRequest(input === "n" ? 1 : -1);
      else if (input === "?") {
        setHelp(true);
        setScroll(0);
      } else scrollKeys(input, key);
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
    // Esc is not a quit key: an escape sequence split across reads arrives as a bare Esc.
    if (input === "q") {
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
    } else if (listing ? cursorKeys(input, key) : scrollKeys(input, key)) return;
    else if (key.return && listing && cursorRow) openDetail();
    else if (input === "?") {
      setHelp(true);
      setScroll(0);
    } else if (input === "/" && listing) {
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
    } else if (input === "e" && current === "Findings") {
      setExpanded((e) => !e);
    } else if ((input === "<" || input === ">") && current === "Hosts") {
      moveColumns(input === ">" ? 1 : -1);
    } else if ((input === "p" || input === "P") && !compare && pageCount > 1) {
      movePage(input === "p" ? 1 : -1);
    } else if ((input === "a" || input === "b") && compare) {
      setSide(input);
      setCursor(FIRST_ROW);
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
  const visible = [...region.slice(0, pinned), ...scrolled.slice(offset, offset + rowsViewport)];

  const scrollHint =
    maxScroll > 0 ? (narrow ? "↑/↓ scroll" : "↑/↓ PgUp/PgDn Home/End scroll") : null;
  // On a narrow terminal the keys of the list stay in the line above it, and a kept filter
  // names the key that clears it instead of the one that opens it.
  const listKeys = searching
    ? ["type to filter", "Enter keep", "Esc clear"]
    : narrow
      ? ["↑/↓ move", "Enter open", search ? "Esc clear filter" : "/ filter"]
      : [
          "↑/↓ move",
          "Enter details",
          "/ filter",
          ...(current === "Waterfall" ? ["f party", "z axis"] : ["f party", "s sort", "S reverse"]),
          search ? "Esc clear filter" : null,
        ];
  const parts: (string | null)[] = help
    ? [narrow ? "↑/↓ scroll" : "↑/↓ PgUp/PgDn Home/End scroll", "? q Esc close help"]
    : showDetail
      ? [
          scrollHint,
          narrow ? "n/N request" : "n/N next/previous request",
          narrow ? "Esc back" : "Esc/Enter/q back",
          "? help",
        ]
      : searching
        ? listKeys
        : [
            `1-${TABS.length}/Tab tabs`,
            current === "Steps" ? "←/→ step" : pages ? "←/→ page" : null,
            listing ? null : scrollHint,
            compare && sided(current) ? "a/b side" : null,
            ...(listing ? listKeys : []),
            current === "Findings" && hasHiddenEvidence(pageFindings)
              ? narrow
                ? "e evidence"
                : `e ${expanded ? "less" : "all"} evidence`
              : null,
            maxColumnOffset > 0 ? "< > columns" : null,
            "? help",
            "q quit",
          ];
  const shownRows = Math.min(rowsViewport, Math.max(0, scrolled.length - offset));
  const position =
    onList && rowCount > 0
      ? `${cursorIndex + 1}/${rowCount} `
      : maxScroll > 0
        ? `${offset + 1}-${offset + shownRows}/${scrolled.length} `
        : "";
  const shown = parts.filter(Boolean);
  // Narrow terminals, and keys too many for the wide separator, get a tighter one, so that the
  // help fits beside the position.
  const wide = shown.join("  ·  ");
  const keys = narrow || wide.length + position.length + 2 > width ? shown.join(" · ") : wide;
  const statusText = ` ${keys}`;
  const statusGap = Math.max(1, width - statusText.length - position.length);
  const status: Line = [seg(`${statusText}${" ".repeat(statusGap)}${position}`, { inverse: true })];

  return (
    <Box flexDirection="column">
      {header.map((line, i) => (
        <LineView key={`h${i}`} line={line} />
      ))}
      {visible.map((line, i) => (
        <LineView key={i < pinned ? `p${i}` : offset + i} line={line} />
      ))}
      {Array.from({ length: viewport - visible.length }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
      <LineView line={status} />
    </Box>
  );
}
