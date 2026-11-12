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
import { useJourneys } from "./hooks/useJourneys.js";
import { useTheme } from "./hooks/useTheme.js";
import { MessagesContext } from "./i18n/context.js";
import { useLocale } from "./i18n/useLocale.js";
import { toggleFullscreen } from "./lib/keyboard.js";
import styles from "./App.module.css";

declare global {
  interface Window {
    __HTV_FLOW__?: Flow;
    /** Second flow of a comparison report: __HTV_FLOW__ is A, this is B. */
    __HTV_COMPARE__?: Flow;
  }
}

type Side = "a" | "b";
const NONE_DISMISSED: ReadonlySet<Side> = new Set();
const SIDE_LABEL = { a: "A", b: "B" } as const;

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
  // The sides whose region notice was dismissed: "a" is the flow, "b" the comparison's B.
  const [dismissed, setDismissed] = useState<ReadonlySet<Side>>(NONE_DISMISSED);
  const { theme, choice: themeChoice, toggleTheme, setChoice: setThemeChoice } = useTheme();
  const { locale, t, setLocale, cycleLocale } = useLocale();
  const [journeys, setJourneys] = useJourneys();
  // One dialog at a time: opening one replaces the other, its own key closes it.
  const [dialog, setDialog] = useState<"settings" | "help" | null>(null);
  const shortcuts = useMemo(() => {
    const toggle = (name: "settings" | "help") => () =>
      setDialog((open) => (open === name ? null : name));
    return {
      t: toggleTheme,
      c: toggle("settings"),
      l: cycleLocale,
      "?": toggle("help"),
      f: toggleFullscreen,
    };
  }, [toggleTheme, cycleLocale]);
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
    // Each side has its own region: two loads from different places differ. A region chosen in
    // the builder applies to both; on Auto, each side takes the one its latencies suggest.
    setCompare(nextComparePages ? generateFlow(nextComparePages, options) : null);
    setDismissed(NONE_DISMISSED);
  };

  const handleLoadFlow = (loaded: Flow) => {
    setPages(null);
    setFlow(normalizeFlow(loaded));
    setComparePages(null);
    setCompare(null);
    setDismissed(NONE_DISMISSED);
  };

  // A notice for each side whose latencies suggest a region: why it is drawn as it is, and a
  // button that draws that side alone with the other topology (when its pages are at hand).
  const sides = [
    { side: "a", sideFlow: flow, sidePages: pages, setSideFlow: setFlow },
    { side: "b", sideFlow: compare, sidePages: comparePages, setSideFlow: setCompare },
  ] as const;
  const regionNotices = sides.flatMap(({ side, sideFlow, sidePages, setSideFlow }) => {
    const suggestion = sideFlow?.hints.suggestedClientRegion;
    if (!sideFlow || !suggestion || dismissed.has(side)) return [];
    const applied = sideFlow.clientRegion !== "default";
    const onSwitch = sidePages
      ? () =>
          setSideFlow(
            generateFlow(sidePages, { clientRegion: applied ? "default" : suggestion.region })
          )
      : undefined;
    return [{ side, suggestion, applied, onSwitch }];
  });

  const handleReset = () => {
    setFlow(null);
    setPages(null);
    setCompare(null);
    setComparePages(null);
  };

  return (
    <MessagesContext.Provider value={t}>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <h1 className={styles.logo}>
              htv <span>HAR TRACE VIEWER</span>
            </h1>
            <span className={styles.version} title={t.app.versionTitle}>
              v{__HTV_VERSION__}
            </span>
          </div>
          <div className={styles.headerActions}>
            {flow && (
              <button className={styles.resetButton} onClick={handleReset} title={t.app.resetTitle}>
                <span aria-hidden="true">↩</span>{" "}
                <span className={styles.resetLabel}>{t.app.reset}</span>
              </button>
            )}
            <button
              className={styles.themeToggle}
              onClick={toggleTheme}
              aria-label={t.app.toggleTheme(theme)}
              title={t.app.toggleThemeTitle}
            >
              {theme === "dark" ? "☀" : "🌙"}
            </button>
            <button
              className={styles.themeToggle}
              onClick={() => setDialog("help")}
              aria-label={t.app.help}
              title={t.app.helpTitle}
            >
              ?
            </button>
            <button
              className={styles.themeToggle}
              onClick={() => setDialog("settings")}
              aria-label={t.app.settings}
              title={t.app.settingsTitle}
            >
              <SettingsIcon />
            </button>
          </div>
        </header>

        <main className={styles.main}>
          {flow ? (
            <div className={styles.flowLayout}>
              {regionNotices.map(({ side, suggestion, applied, onSwitch }) => (
                <RegionNotice
                  key={side}
                  side={compare ? SIDE_LABEL[side] : undefined}
                  suggestion={suggestion}
                  applied={applied}
                  onSwitch={onSwitch}
                  onDismiss={() => setDismissed((prev) => new Set(prev).add(side))}
                />
              ))}
              <div className={styles.flowArea}>
                {compare ? <CompareView a={flow} b={compare} /> : <DiagramView flow={flow} />}
              </div>
            </div>
          ) : (
            <div className={styles.builderWrapper}>
              <FlowBuilder
                journeys={journeys}
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
            locale={locale}
            onLocale={setLocale}
            journeys={journeys}
            onJourneys={setJourneys}
            onShowHelp={() => setDialog("help")}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "help" && <HelpModal onClose={() => setDialog(null)} />}
      </div>
    </MessagesContext.Provider>
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
