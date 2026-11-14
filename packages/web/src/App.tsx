import { Suspense, startTransition, useEffect, useMemo, useState } from "react";
import { normalizeFlow } from "@htv/core";
import type { Flow, FlowOptions, PageFlow } from "@htv/core";
import { CompareView, DIALOGS, DiagramView, HelpModal, SettingsModal } from "./components/lazy.js";
import { ViewErrorBoundary } from "./components/ViewErrorBoundary.js";
import { FlowBuilder } from "./components/FlowBuilder.js";
import { RegionNotice } from "./components/RegionNotice.js";
import { useAppShortcuts } from "./hooks/useAppShortcuts.js";
import { useJourneys } from "./hooks/useJourneys.js";
import { useLatestTask } from "./hooks/useLatestTask.js";
import { useTheme } from "./hooks/useTheme.js";
import { MessagesContext } from "./i18n/context.js";
import { useLocale } from "./i18n/useLocale.js";
import { toggleFullscreen } from "./lib/keyboard.js";
import { generateInWorker } from "./lib/parse-client.js";
import { preloadWhenIdle } from "./lib/preloadable.js";
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
  useEffect(() => preloadWhenIdle(DIALOGS), []);

  const [generateError, setGenerateError] = useState<string | null>(null);
  // The analysis runs in a worker. Only the latest one lands: Reset, the demo flow or a newer
  // generation drop the result of one still running.
  const generation = useLatestTask();
  // The side whose region switch is running, to word its button.
  const [switching, setSwitching] = useState<Side | null>(null);
  // An analysis that throws leaves the screen as it was, with the reason in view.
  const attempt = <T,>(generate: () => Promise<T>, apply: (result: T) => void) =>
    void generation.run(
      generate,
      (result) => {
        apply(result);
        setGenerateError(null);
      },
      (error) => {
        console.error(error);
        setGenerateError(t.errors.generate);
      }
    );

  const handleGenerate = (
    nextPages: PageFlow[],
    options: FlowOptions,
    nextComparePages?: PageFlow[]
  ) =>
    attempt(
      // Each side has its own region: two loads from different places differ. A region chosen in
      // the builder applies to both; on Auto, each side takes the one its latencies suggest.
      // The view loads meanwhile; should it fail, the view's error boundary reports it.
      () =>
        Promise.all([
          generateInWorker(nextPages, options),
          nextComparePages ? generateInWorker(nextComparePages, options) : null,
          (nextComparePages ? CompareView : DiagramView).preload().catch(() => undefined),
        ]),
      ([nextFlow, nextCompare]) => {
        setPages(nextPages);
        setFlow(nextFlow);
        setComparePages(nextComparePages ?? null);
        setCompare(nextCompare);
        setDismissed(NONE_DISMISSED);
      }
    );

  const handleLoadFlow = (loaded: Flow) => {
    generation.cancel();
    // A transition: the builder stays on screen until the diagram view has loaded.
    startTransition(() => {
      setPages(null);
      setFlow(normalizeFlow(loaded));
      setComparePages(null);
      setCompare(null);
      setDismissed(NONE_DISMISSED);
    });
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
      ? () => {
          setSwitching(side);
          attempt(
            () =>
              generateInWorker(sidePages, {
                clientRegion: applied ? "default" : suggestion.region,
              }),
            setSideFlow
          );
        }
      : undefined;
    const busy = generation.running ? (switching === side ? "self" : "other") : undefined;
    return [{ side, suggestion, applied, onSwitch, busy } as const];
  });

  const handleReset = () => {
    generation.cancel();
    setFlow(null);
    setPages(null);
    setCompare(null);
    setComparePages(null);
    setGenerateError(null);
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
          <Suspense fallback={null}>
            {flow ? (
              <div className={styles.flowLayout}>
                {regionNotices.map(({ side, suggestion, applied, onSwitch, busy }) => (
                  <RegionNotice
                    key={side}
                    side={compare ? SIDE_LABEL[side] : undefined}
                    suggestion={suggestion}
                    applied={applied}
                    onSwitch={onSwitch}
                    busy={busy}
                    onDismiss={() => setDismissed((prev) => new Set(prev).add(side))}
                  />
                ))}
                {generateError && (
                  <p className={styles.flowError} role="alert">
                    {generateError}
                  </p>
                )}
                <div className={styles.flowArea}>
                  <ViewErrorBoundary onReset={handleReset}>
                    {compare ? <CompareView a={flow} b={compare} /> : <DiagramView flow={flow} />}
                  </ViewErrorBoundary>
                </div>
              </div>
            ) : (
              <div className={styles.builderWrapper}>
                <FlowBuilder
                  journeys={journeys}
                  error={generateError}
                  generating={generation.running}
                  onGenerate={handleGenerate}
                  // The demo chunk is not shipped inside generated reports.
                  onLoadFlow={embedded ? undefined : handleLoadFlow}
                />
              </div>
            )}
          </Suspense>
        </main>
        <Suspense fallback={null}>
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
        </Suspense>
        <div className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">
          {generation.running ? t.app.generating : ""}
        </div>
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
