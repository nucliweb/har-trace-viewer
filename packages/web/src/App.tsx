import { useMemo, useState } from "react";
import { generateFlow, normalizeFlow } from "@htv/core";
import type { Flow, FlowOptions, PageFlow } from "@htv/core";
import { CompareView } from "./components/CompareView.js";
import { DiagramView } from "./components/DiagramView.js";
import { FlowBuilder } from "./components/FlowBuilder.js";
import { HelpModal } from "./components/HelpModal.js";
import { RegionNotice } from "./components/RegionNotice.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { useAppShortcuts } from "./hooks/useAppShortcuts.js";
import { useTheme } from "./hooks/useTheme.js";
import { toggleFullscreen } from "./lib/keyboard.js";
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
  const { theme, choice: themeChoice, toggleTheme, setChoice: setThemeChoice } = useTheme();
  // One dialog at a time: opening one replaces the other, its own key closes it.
  const [dialog, setDialog] = useState<"settings" | "help" | null>(null);
  const shortcuts = useMemo(() => {
    const toggle = (name: "settings" | "help") => () =>
      setDialog((open) => (open === name ? null : name));
    return { t: toggleTheme, c: toggle("settings"), "?": toggle("help"), f: toggleFullscreen };
  }, [toggleTheme]);
  useAppShortcuts(shortcuts);

  const handleGenerate = (
    nextPages: PageFlow[],
    options: FlowOptions,
    nextComparePages?: PageFlow[]
  ) => {
    const nextFlow = generateFlow(nextPages, options);
    setPages(nextPages);
    setFlow(nextFlow);
    setComparePages(nextComparePages ?? null);
    // Both sides of a comparison share a topology: B takes the region A was drawn with.
    setCompare(
      nextComparePages
        ? generateFlow(nextComparePages, { clientRegion: nextFlow.clientRegion })
        : null
    );
    setNoticeDismissed(false);
  };

  const handleLoadFlow = (loaded: Flow) => {
    setPages(null);
    setFlow(normalizeFlow(loaded));
    setComparePages(null);
    setCompare(null);
    setNoticeDismissed(false);
  };

  const regionSuggestion = !noticeDismissed ? flow?.hints.suggestedClientRegion : undefined;
  const regionApplied = flow?.clientRegion !== "default";

  // Draws the topology the notice offers: the default one, or the suggested region's.
  const handleSwitchRegion =
    pages && regionSuggestion
      ? () => {
          const clientRegion = regionApplied ? "default" : regionSuggestion.region;
          setFlow(generateFlow(pages, { clientRegion }));
          if (comparePages) setCompare(generateFlow(comparePages, { clientRegion }));
        }
      : undefined;

  const handleReset = () => {
    setFlow(null);
    setPages(null);
    setCompare(null);
    setComparePages(null);
  };

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
            title="Toggle theme (t)"
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
          <button
            className={styles.themeToggle}
            onClick={() => setDialog("settings")}
            aria-label="Settings"
            title="Settings (c)"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {flow ? (
          <div className={styles.flowLayout}>
            {regionSuggestion && (
              <RegionNotice
                suggestion={regionSuggestion}
                applied={regionApplied}
                onSwitch={handleSwitchRegion}
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
      {dialog === "settings" && (
        <SettingsModal
          themeChoice={themeChoice}
          onThemeChoice={setThemeChoice}
          onShowHelp={() => setDialog("help")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "help" && <HelpModal onClose={() => setDialog(null)} />}
    </div>
  );
}

// A gear: the app's settings.
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
