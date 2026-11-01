import { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { collectFindings, compareFlows, stepAtPair } from "@htv/core";
import type { Flow } from "@htv/core";
import { findingsRegion } from "./findings-view.js";
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
  /** Terminal size; read from stdout when omitted. */
  rows?: number;
  columns?: number;
}

const TABS = ["Findings", "Overview", "Steps", "Hosts", "Cache & network"] as const;
type Side = "a" | "b";

// The header block and the status bar around the scrolling region.
const HEADER_LINES = 3;
const STATUS_LINES = 1;
const MIN_COLUMNS = 60;
const DEFAULT_SIZE = { rows: 24, columns: 100 };

function useTerminalSize(rows?: number, columns?: number) {
  const { stdout } = useStdout();
  const read = () => ({
    rows: rows ?? (stdout.rows || DEFAULT_SIZE.rows),
    columns: columns ?? (stdout.columns || DEFAULT_SIZE.columns),
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  });
  return size;
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
  const tabs: Line = TABS.flatMap((name, i) => [
    seg(` ${i + 1} ${name} `, i === tab ? { inverse: true, bold: true, color: "cyan" } : {}),
    seg(" "),
  ]);
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
 * The report in the terminal: the findings, an overview of the metrics, the diagram's steps,
 * the hosts and the cache analysis, one tab each, drawn as framed panels. A comparison shows
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

  const names = useMemo(
    () => ({ a: flow.pages[0].name, b: compare?.pages[0].name ?? "" }),
    [flow, compare]
  );
  const findings = useMemo(
    () => ({ a: collectFindings(flow), b: compare ? collectFindings(compare) : [] }),
    [flow, compare]
  );
  // The tabs that show one side of a comparison at a time, picked with a/b.
  const sided = (tabName: string) => tabName === "Findings" || tabName === "Cache & network";
  const stepCount = comparison ? comparison.pairs.length : flow.steps.length;
  const pageCount = flow.pages.length;
  const width = Math.max(MIN_COLUMNS, size.columns);
  const viewport = Math.max(1, size.rows - HEADER_LINES - STATUS_LINES);
  const current = TABS[tab];

  const region = useMemo((): Line[] => {
    switch (current) {
      case "Findings": {
        const list = compare ? findings[side] : findings.a.filter((f) => f.page.index === page);
        return findingsRegion(list, width);
      }
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
  }, [current, step, page, side, width, viewport, flow, compare, comparison, names, findings]);

  const maxScroll = Math.max(0, region.length - viewport);
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

  useInput((input, key) => {
    if (input === "q" || key.escape || (key.ctrl && input === "c")) {
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
    else if (key.pageDown || input === " ") scrollTo(scroll + viewport);
    else if (key.pageUp) scrollTo(scroll - viewport);
    else if ((input === "p" || input === "P") && !compare && pageCount > 1) {
      movePage(input === "p" ? 1 : -1);
    } else if ((input === "a" || input === "b") && compare) {
      setSide(input);
      setScroll(0);
    }
  });

  const context = compare
    ? sided(current)
      ? `${current === "Findings" ? "Findings" : "Cache"} · ${side.toUpperCase()} ${names[side]}`
      : `A ${names.a} · B ${names.b}`
    : pageLabel(flow, page);
  const pages =
    !compare && pageCount > 1 ? { names: flow.pages.map((p) => p.name), current: page } : null;
  const header = headerLines(width, version, context, tab, pages);
  const visible = region.slice(scroll, scroll + viewport);

  const help = [
    `1-${TABS.length}/Tab tabs`,
    current === "Steps" ? "←/→ step" : pages ? "←/→ page" : null,
    maxScroll > 0 ? "↑/↓ PgUp/PgDn scroll" : null,
    compare && sided(current) ? "a/b side" : null,
    "q quit",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const position =
    maxScroll > 0 ? `${scroll + 1}-${scroll + visible.length}/${region.length} ` : "";
  const statusText = ` ${help}`;
  const statusGap = Math.max(1, width - statusText.length - position.length);
  const status: Line = [seg(`${statusText}${" ".repeat(statusGap)}${position}`, { inverse: true })];

  return (
    <Box flexDirection="column">
      {header.map((line, i) => (
        <LineView key={`h${i}`} line={line} />
      ))}
      {visible.map((line, i) => (
        <LineView key={scroll + i} line={line} />
      ))}
      {Array.from({ length: viewport - visible.length }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
      <LineView line={status} />
    </Box>
  );
}
