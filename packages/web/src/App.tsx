import { useState } from "react";
import { generateFlow, normalizeFlow } from "@htv/core";
import type { Flow, FlowOptions, PageFlow } from "@htv/core";
import { CompareView } from "./components/CompareView.js";
import { DiagramView } from "./components/DiagramView.js";
import { FlowBuilder } from "./components/FlowBuilder.js";
import { RegionNotice } from "./components/RegionNotice.js";
import { useTheme } from "./hooks/useTheme.js";
import styles from "./App.module.css";

declare global {
  interface Window {
    __HTV_FLOW__?: Flow;
    /** Second flow of a comparison report: __HTV_FLOW__ is A, this is B. */
    __HTV_COMPARE__?: Flow;
  }
}

export function App() {
  // Reports embed the flow without the raw pages, so it cannot be regenerated.
  const embedded = window.__HTV_FLOW__;
  const [flow, setFlow] = useState<Flow | null>(() => (embedded ? normalizeFlow(embedded) : null));
  // B of a comparison, drawn below `flow`; null for a single flow.
  const [compare, setCompare] = useState<Flow | null>(() => {
    const embeddedCompare = embedded ? window.__HTV_COMPARE__ : undefined;
    return embeddedCompare ? normalizeFlow(embeddedCompare) : null;
  });
  const [pages, setPages] = useState<PageFlow[] | null>(null);
  const [comparePages, setComparePages] = useState<PageFlow[] | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const handleGenerate = (
    nextPages: PageFlow[],
    options: FlowOptions,
    nextComparePages?: PageFlow[]
  ) => {
    setPages(nextPages);
    setFlow(generateFlow(nextPages, options));
    setComparePages(nextComparePages ?? null);
    setCompare(nextComparePages ? generateFlow(nextComparePages, options) : null);
    setNoticeDismissed(false);
  };

  const handleLoadFlow = (loaded: Flow) => {
    setPages(null);
    setFlow(normalizeFlow(loaded));
    setComparePages(null);
    setCompare(null);
    setNoticeDismissed(false);
  };

  const handleShowGfwTopology = pages
    ? () => {
        setFlow(generateFlow(pages, { clientRegion: "cn" }));
        if (comparePages) setCompare(generateFlow(comparePages, { clientRegion: "cn" }));
      }
    : undefined;

  const handleReset = () => {
    setFlow(null);
    setPages(null);
    setCompare(null);
    setComparePages(null);
  };

  const regionSuggestion =
    flow?.clientRegion === "default" && !noticeDismissed
      ? flow.hints.suggestedClientRegion
      : undefined;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            htv <span>HAR TRACE VIEWER</span>
          </div>
          <span className={styles.version} title="HTV version">
            v{__HTV_VERSION__}
          </span>
        </div>
        <div className={styles.headerActions}>
          {flow && (
            <button
              className={styles.resetButton}
              onClick={handleReset}
              title="Reset — load a new flow"
            >
              ↩ Reset
            </button>
          )}
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            aria-label={`Toggle theme (current: ${theme})`}
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {flow ? (
          <div className={styles.flowLayout}>
            {regionSuggestion && (
              <RegionNotice
                suggestion={regionSuggestion}
                onShowGfwTopology={handleShowGfwTopology}
                onDismiss={() => setNoticeDismissed(true)}
              />
            )}
            <div className={styles.flowArea}>
              {compare ? <CompareView a={flow} b={compare} /> : <DiagramView flow={flow} />}
            </div>
          </div>
        ) : (
          <div className={styles.builderWrapper}>
            <FlowBuilder
              onGenerate={handleGenerate}
              // The demo chunk is not shipped inside generated reports.
              onLoadFlow={embedded ? undefined : handleLoadFlow}
            />
          </div>
        )}
      </main>
    </div>
  );
}
