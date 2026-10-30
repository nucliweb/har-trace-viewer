import { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { compareFlows, stepAtPair } from "@htv/core";
import type { Flow } from "@htv/core";
import type { Line } from "./lines.js";
import {
  cacheLines,
  compareOverviewLines,
  hostDeltaLines,
  hostLines,
  overviewLines,
  pageLabel,
  pairLines,
  stepLines,
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

const TABS = ["Overview", "Steps", "Hosts", "Cache"] as const;
type Side = "a" | "b";

// Title and tab bar above the content, key help below it.
const CHROME_LINES = 3;
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

function LineView({ line }: { line: Line }) {
  return (
    <Text wrap="truncate-end">
      {line.length === 0
        ? " "
        : line.map((s, i) => (
            <Text key={i} color={s.color} bold={s.bold} dimColor={s.dim}>
              {s.text}
            </Text>
          ))}
    </Text>
  );
}

/**
 * The report in the terminal: an overview of the metrics, the diagram's steps, the hosts and
 * the cache analysis, one tab each. A comparison shows both flows with their B − A deltas.
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
  const stepCount = comparison ? comparison.pairs.length : flow.steps.length;
  const width = Math.max(40, size.columns - 2);
  const viewport = Math.max(1, size.rows - CHROME_LINES - 1);

  const content = useMemo((): Line[] => {
    switch (TABS[tab]) {
      case "Overview":
        return comparison
          ? compareOverviewLines(comparison, names, width)
          : overviewLines(flow, page, width);
      case "Steps":
        if (comparison && compare) {
          const views = {
            a: stepAtPair(comparison.pairs, step, "a"),
            b: stepAtPair(comparison.pairs, step, "b"),
          };
          return pairLines(flow, compare, views, { index: step, total: stepCount }, width);
        }
        return stepLines(flow, step, width);
      case "Hosts":
        return comparison ? hostDeltaLines(comparison, names) : hostLines(flow, page);
      case "Cache": {
        if (compare) {
          const shown = side === "a" ? flow : compare;
          const title = `Cache · ${side.toUpperCase()} ${names[side]}`;
          return cacheLines(shown.pageAnalyses[0].cacheReport, title, width);
        }
        return cacheLines(
          flow.pageAnalyses[page].cacheReport,
          `Cache · ${pageLabel(flow, page)}`,
          width
        );
      }
    }
  }, [tab, step, page, side, width, flow, compare, comparison, names, stepCount]);

  const maxScroll = Math.max(0, content.length - viewport);
  const scrollTo = (value: number) => setScroll(Math.min(maxScroll, Math.max(0, value)));
  const showTab = (index: number) => {
    setTab((index + TABS.length) % TABS.length);
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
    else if (key.rightArrow && TABS[tab] === "Steps") {
      setStep((s) => Math.min(stepCount - 1, s + 1));
      setScroll(0);
    } else if (key.leftArrow && TABS[tab] === "Steps") {
      setStep((s) => Math.max(0, s - 1));
      setScroll(0);
    } else if (key.downArrow) scrollTo(scroll + 1);
    else if (key.upArrow) scrollTo(scroll - 1);
    else if (key.pageDown || input === " ") scrollTo(scroll + viewport);
    else if (key.pageUp) scrollTo(scroll - viewport);
    else if (input === "p" && !compare && flow.pages.length > 1) {
      setPage((p) => (p + 1) % flow.pages.length);
      setScroll(0);
    } else if ((input === "a" || input === "b") && compare) {
      setSide(input);
      setScroll(0);
    }
  });

  const title = compare
    ? `A ${names.a}  ·  B ${names.b}`
    : flow.pages.map((p) => p.name).join(" → ");
  const visible = content.slice(scroll, scroll + viewport);
  const help = [
    "1-4/Tab tabs",
    TABS[tab] === "Steps" ? "←/→ step" : null,
    maxScroll > 0 ? "↑/↓ PgUp/PgDn scroll" : null,
    !compare && flow.pages.length > 1 ? "p page" : null,
    compare && TABS[tab] === "Cache" ? "a/b side" : null,
    "q quit",
  ]
    .filter(Boolean)
    .join(" · ");
  const position =
    maxScroll > 0 ? `  ${scroll + 1}-${scroll + visible.length}/${content.length}` : "";

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color="cyan">
          htv v{version}
        </Text>
        <Text dimColor> · </Text>
        <Text>{title}</Text>
      </Text>
      <Text wrap="truncate-end">
        {TABS.map((name, i) => (
          <Text key={name} inverse={i === tab} color={i === tab ? "cyan" : undefined}>
            {` ${i + 1} ${name} `}
          </Text>
        ))}
      </Text>
      {visible.map((line, i) => (
        <LineView key={scroll + i} line={line} />
      ))}
      {Array.from({ length: viewport - visible.length }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
      <Text dimColor wrap="truncate-end">
        {help}
        {position}
      </Text>
    </Box>
  );
}
