import { useState } from "react";
import { generateFlow, normalizeFlow } from "@htv/core/steps/step-generator.js";
import type { Flow, FlowOptions, PageFlow } from "@htv/core/types.js";
import { DiagramView } from "./components/DiagramView.js";
import { FlowBuilder } from "./components/FlowBuilder.js";
import { RegionNotice } from "./components/RegionNotice.js";
import styles from "./App.module.css";

function getInitialTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

declare global {
  interface Window {
    __HTV_FLOW__?: Flow;
  }
}

export function App() {
  // Reports embed the flow without the raw pages, so it cannot be regenerated.
  const [flow, setFlow] = useState<Flow | null>(() =>
    window.__HTV_FLOW__ ? normalizeFlow(window.__HTV_FLOW__) : null
  );
  const [pages, setPages] = useState<PageFlow[] | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const initial = getInitialTheme();
    document.documentElement.setAttribute("data-theme", initial);
    return initial;
  });

  const handleGenerate = (nextPages: PageFlow[], options: FlowOptions) => {
    setPages(nextPages);
    setFlow(generateFlow(nextPages, options));
    setNoticeDismissed(false);
  };

  const handleShowGfwTopology = pages
    ? () => setFlow(generateFlow(pages, { clientRegion: "cn" }))
    : undefined;

  const handleReset = () => {
    setFlow(null);
    setPages(null);
  };

  const regionSuggestion =
    flow?.clientRegion === "default" && !noticeDismissed
      ? flow.hints.suggestedClientRegion
      : undefined;

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logo}>
          htv <span>HAR TRACE VIEWER</span>
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
          <button className={styles.themeToggle} onClick={toggleTheme} aria-label="Toggle theme">
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
              <DiagramView flow={flow} />
            </div>
          </div>
        ) : (
          <div className={styles.builderWrapper}>
            <FlowBuilder onGenerate={handleGenerate} />
          </div>
        )}
      </main>
    </div>
  );
}
