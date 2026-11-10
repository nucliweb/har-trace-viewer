import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { Flow, HarEntry } from "@htv/core";
import type { DiagramState, Speed, StepNavigation } from "../hooks/useDiagramState.js";
import { useCoreLang, useMessages } from "../i18n/context.js";
import styles from "./StepPanel.module.css";

interface Props {
  state: DiagramState;
  // Network requests of the current step.
  resources: HarEntry[];
  resourcesOpen: boolean;
  onToggleResources: () => void;
}

const SPEEDS: { label: string; value: Speed }[] = [
  { label: "0.5×", value: 2000 },
  { label: "1×", value: 1400 },
  { label: "2×", value: 800 },
  { label: "4×", value: 400 },
];

// Inline SVG icon: a stacked list to suggest "view resource list"
function ResourceListIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <line
        x1="3"
        y1="4"
        x2="9"
        y2="4"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="6"
        x2="9"
        y2="6"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="8"
        x2="7"
        y2="8"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface StepTrackProps {
  /** One accessible label per step, e.g. its title. */
  labels: string[];
  stepIndex: number;
  goTo: (index: number) => void;
}

/** One numbered tab per step; arrow keys, Home and End move the selection inside the tablist. */
export function StepTrack({ labels, stepIndex, goTo }: StepTrackProps) {
  const t = useMessages().steps;
  const total = labels.length;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys inside the tablist move the selection (same as the global shortcut) and focus follows.
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target =
      event.key === "ArrowRight"
        ? Math.min(stepIndex + 1, total - 1)
        : event.key === "ArrowLeft"
          ? Math.max(stepIndex - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? total - 1
              : null;
    if (target === null || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    goTo(target);
    tabRefs.current[target]?.focus();
  };

  return (
    // The focusable elements are the tabs; key events bubble up to the tablist.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div className={styles.track} role="tablist" aria-label={t.track} onKeyDown={onTabKeyDown}>
      {labels.map((label, i) => {
        const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
        return (
          <button
            key={i}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`step-tab-${i}`}
            role="tab"
            aria-selected={i === stepIndex}
            aria-controls="step-panel"
            tabIndex={i === stepIndex ? 0 : -1}
            aria-label={t.tab(i + 1, label)}
            className={`${styles.trackDot} ${styles[status]}`}
            onClick={() => goTo(i)}
          >
            {i < stepIndex ? "✓" : i + 1}
          </button>
        );
      })}
    </div>
  );
}

/** Prev, Next, Auto play, back to the first step and playback speed. */
export function StepControls({ nav, className }: { nav: StepNavigation; className?: string }) {
  const t = useMessages().steps;
  const { stepIndex, total, isPlaying, speed, goTo, prev, next, togglePlay, setSpeed } = nav;
  return (
    <div className={className ? `${styles.controls} ${className}` : styles.controls}>
      <button className={styles.btn} onClick={prev} disabled={stepIndex === 0}>
        {t.prev}
      </button>
      <button className={styles.btn} onClick={next} disabled={stepIndex === total - 1}>
        {t.next}
      </button>
      <button
        className={`${styles.btn} ${styles.btnPlay} ${isPlaying ? styles.playing : ""}`}
        onClick={togglePlay}
        aria-label={isPlaying ? t.pause : t.autoPlay}
      >
        {isPlaying ? t.pauseText : t.autoPlayText}
      </button>
      <button
        className={styles.btn}
        onClick={() => goTo(0)}
        disabled={stepIndex === 0}
        aria-label={t.reset}
        title={t.resetTitle}
      >
        ↺
      </button>
      <div className={styles.speedWrap}>
        <span className={styles.speedLabel}>{t.speed}</span>
        <select
          className={styles.speedSelect}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
          aria-label={t.playbackSpeed}
        >
          {SPEEDS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A document URL as people read it: host and path, without the scheme or the query. */
function pageAddress(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname}${pathname}`;
  } catch {
    return url;
  }
}

/**
 * Which page of a flow of several pages the step belongs to: each page has its own TTFB and
 * load, so a new value reads as another URL's. The address shows once when the page is named
 * after it; the full URL is on hover.
 */
function StepPage({ flow, pageIndex }: { flow: Flow; pageIndex: number }) {
  const t = useMessages().steps;
  const page = flow.pages[pageIndex];
  const url = page.har.documentEntry.url;
  const address = pageAddress(url);
  return (
    <div className={styles.page} data-testid="step-page">
      {t.page(pageIndex + 1, flow.pages.length)}
      {page.name !== address && ` · ${page.name}`}
      {" · "}
      <span className={styles.pageAddress} title={url}>
        {address}
      </span>
    </div>
  );
}

export function StepPanel({ state, resources, resourcesOpen, onToggleResources }: Props) {
  const t = useMessages().steps;
  const lang = useCoreLang();
  const { flow, stepIndex, goTo } = state;
  const step = flow.steps[stepIndex];
  const total = flow.steps.length;

  return (
    <div className={styles.panel}>
      <div className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">
        {t.live(stepIndex + 1, total, step.title)}
      </div>

      <StepTrack labels={flow.steps.map((s) => s.title)} stepIndex={stepIndex} goTo={goTo} />

      {/* Info card */}
      <div
        className={styles.info}
        id="step-panel"
        role="tabpanel"
        aria-labelledby={`step-tab-${stepIndex}`}
      >
        <div className={styles.infoMain}>
          {flow.pages.length > 1 && <StepPage flow={flow} pageIndex={step.pageIndex} />}
          <div className={styles.stepCounter}>{t.counter(stepIndex + 1, total)}</div>
          <div className={styles.title} lang={lang}>
            {step.title}
          </div>
          <div className={styles.description} lang={lang}>
            {step.description}
          </div>
        </div>

        {step.metrics.length > 0 && (
          <div className={styles.metrics}>
            {step.metrics.map((m) => (
              <div key={m.label} className={styles.metric} lang={lang}>
                <span className={styles.metricLabel}>{m.label}</span>
                <span className={styles.metricValue}>{m.value}</span>
              </div>
            ))}
            {resources.length > 0 && (
              <button
                className={`${styles.resourcesBtn} ${resourcesOpen ? styles.resourcesBtnActive : ""}`}
                onClick={onToggleResources}
                data-drawer="resources"
                aria-label={t.viewResources}
                aria-expanded={resourcesOpen}
                title={t.viewResources}
              >
                <ResourceListIcon />
              </button>
            )}
          </div>
        )}
      </div>

      <StepControls nav={state} />
    </div>
  );
}
