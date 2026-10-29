import { useMemo, useRef, useState } from "react";
import { compareFlows, compareStepMetrics, stepAtPair } from "@htv/core";
import type { DiagramStep, Flow, FlowComparison, MetricDelta, StepPair } from "@htv/core";
import { useStepNavigation } from "../hooks/useDiagramState.js";
import { useStepKeyboard } from "../hooks/useStepKeyboard.js";
import { formatDelta } from "../lib/format.js";
import { computeHistoricalPaths } from "../lib/historical-paths.js";
import { BadgeRow } from "./BadgeRow.js";
import { CachePanel } from "./CachePanel.js";
import { DELTA_CLASS, DeltaCell, DeltasPanel } from "./DeltasPanel.js";
import { NodeRenderer } from "./NodeRenderer.js";
import { StepControls, StepTrack } from "./StepPanel.js";
import stepStyles from "./StepPanel.module.css";
import diagramStyles from "./DiagramView.module.css";
import styles from "./CompareView.module.css";

interface Props {
  /** The baseline, drawn on top (for instance a first view). */
  a: Flow;
  /** The candidate, drawn below (for instance a repeat view); deltas read B − A. */
  b: Flow;
}

type Side = "a" | "b";
const SIDES: Side[] = ["a", "b"];
const TAG: Record<Side, string> = { a: "A", b: "B" };

// Key deltas above the step track, in this order.
const HEADLINE: MetricDelta["key"][] = ["lcp", "onLoad", "requests", "bytes"];
const HEADLINE_UNIT = { lcp: "ms", onLoad: "ms", requests: "count", bytes: "bytes" } as const;

interface SideView {
  flow: Flow;
  name: string;
  stepIndex: number;
  /** False when the flow has no step of the pair's kind and keeps showing its previous one. */
  current: boolean;
}

function DiagramPane({ side, view }: { side: Side; view: SideView }) {
  const { flow, name, stepIndex, current } = view;
  const [showCachePanel, setShowCachePanel] = useState(false);
  const step = flow.steps[stepIndex];
  const analysis = flow.pageAnalyses[step.pageIndex];
  const historicalPaths = useMemo(
    () => computeHistoricalPaths(flow.steps, stepIndex),
    [flow.steps, stepIndex]
  );
  return (
    <section
      className={`${styles.pane} ${current ? "" : styles.paneDimmed}`}
      aria-label={`${TAG[side]} · ${name}`}
      data-step={stepIndex}
      data-dimmed={String(!current)}
    >
      <div className={styles.paneHeader}>
        <h2 className={styles.paneLabel}>
          <span className={`${styles.sideTag} ${styles[`sideTag_${side}`]}`} aria-hidden="true">
            {TAG[side]}
          </span>
          {name}
        </h2>
        {!current && <span className={styles.paneNote}>Holds step: {step.title}</span>}
        <button
          className={`${diagramStyles.cacheBtn} ${styles.paneCacheBtn} ${showCachePanel ? diagramStyles.cacheBtnActive : ""}`}
          onClick={() => setShowCachePanel((v) => !v)}
          aria-label="Toggle cache analysis"
          aria-expanded={showCachePanel}
          title="Cache Analysis"
        >
          Cache
        </button>
      </div>
      <div className={styles.paneCanvas}>
        <NodeRenderer
          nodes={analysis.nodes}
          paths={analysis.paths}
          activeNodes={step.activeNodes}
          activePaths={step.activePaths}
          pathTimings={step.pathTimings}
          pathDirections={step.pathDirections}
          historicalPaths={historicalPaths}
          idPrefix={`${side}-`}
        />
        <BadgeRow
          steps={flow.steps}
          pageIndex={step.pageIndex}
          stepIndex={stepIndex}
          className={styles.badges}
        />
        {showCachePanel && (
          <CachePanel
            report={analysis.cacheReport}
            pageLabel={`${TAG[side]} · ${name}`}
            onClose={() => setShowCachePanel(false)}
          />
        )}
      </div>
    </section>
  );
}

const stepOf = (view: SideView): DiagramStep | undefined =>
  view.current ? view.flow.steps[view.stepIndex] : undefined;

/** Title per side, both step metrics joined by label and the B − A delta. */
function PairInfo({
  views,
  pairIndex,
  total,
}: {
  views: Record<Side, SideView>;
  pairIndex: number;
  total: number;
}) {
  const stepA = stepOf(views.a);
  const stepB = stepOf(views.b);
  const rows = compareStepMetrics(stepA, stepB);
  const description = (stepA ?? stepB)?.description;
  return (
    <div
      className={styles.info}
      id="step-panel"
      role="tabpanel"
      aria-labelledby={`step-tab-${pairIndex}`}
    >
      <div className={stepStyles.stepCounter}>
        Step {pairIndex + 1} / {total}
      </div>
      <div className={styles.titles}>
        {SIDES.map((side) => {
          const view = views[side];
          const step = stepOf(view);
          return (
            <div key={side} className={styles.sideTitle}>
              <span className={`${styles.sideTag} ${styles[`sideTag_${side}`]}`}>{TAG[side]}</span>
              {step ? (
                <span className={stepStyles.title}>{step.title}</span>
              ) : (
                <span className={styles.missing}>
                  No such step: stays on {view.flow.steps[view.stepIndex].title}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {description && <p className={styles.description}>{description}</p>}
      {rows.length > 0 && (
        <table className={styles.metrics}>
          <caption className={styles.srOnly}>Step metrics, A and B</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">A</th>
              <th scope="col">B</th>
              <th scope="col">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.a ?? "—"}</td>
                <td>{row.b ?? "—"}</td>
                <DeltaCell
                  text={
                    row.delta === null
                      ? ""
                      : formatDelta(
                          row.delta,
                          row.unit === "ms" ? "ms" : Number.isInteger(row.delta) ? "count" : "score"
                        )
                  }
                  rating={row.rating}
                />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Headline({ comparison }: { comparison: FlowComparison }) {
  const items = HEADLINE.map((key) => comparison.metrics.find((m) => m.key === key)!).filter(
    (m) => m.delta !== null
  );
  return (
    <ul className={styles.headline} aria-label="Key deltas, B − A">
      {items.map((m) => (
        <li key={m.key} className={styles.headlineItem}>
          <span className={styles.headlineLabel}>{m.label}</span>
          <span className={DELTA_CLASS[m.rating]}>
            {formatDelta(m.delta, HEADLINE_UNIT[m.key as keyof typeof HEADLINE_UNIT])}
          </span>
        </li>
      ))}
    </ul>
  );
}

const pairLabel = (pair: StepPair, a: Flow, b: Flow) =>
  (pair.a !== undefined ? a.steps[pair.a] : b.steps[pair.b!]).title;

/**
 * Two flows stacked, A on top and B below, driven by one step track: each position shows the
 * step of the same kind on both diagrams. A flow without that kind keeps its previous step,
 * dimmed. The Deltas panel compares their metrics and hosts.
 */
export function CompareView({ a, b }: Props) {
  const comparison = useMemo(() => compareFlows(a, b), [a, b]);
  const { pairs } = comparison;
  const nav = useStepNavigation(pairs.length);
  const viewRef = useRef<HTMLDivElement>(null);
  useStepKeyboard(viewRef, nav);
  const [showDeltas, setShowDeltas] = useState(false);
  const pairIndex = nav.stepIndex;
  const labels = useMemo(() => pairs.map((p) => pairLabel(p, a, b)), [pairs, a, b]);

  const sideView = (flow: Flow, side: Side): SideView => {
    const { index, current } = stepAtPair(pairs, pairIndex, side);
    return { flow, name: flow.pages[0].name, stepIndex: index, current };
  };
  const views: Record<Side, SideView> = { a: sideView(a, "a"), b: sideView(b, "b") };

  return (
    // The region is focusable on purpose: it is the keyboard entry point for the step shortcuts.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div ref={viewRef} className={styles.view} role="region" aria-label="Comparison" tabIndex={0}>
      <div className={styles.body}>
        <div className={styles.diagrams}>
          {SIDES.map((side) => (
            <DiagramPane key={side} side={side} view={views[side]} />
          ))}
          {showDeltas && (
            <DeltasPanel
              comparison={comparison}
              names={{ a: views.a.name, b: views.b.name }}
              onClose={() => setShowDeltas(false)}
            />
          )}
        </div>
        <div className={styles.panel}>
          <div className={styles.summary}>
            <Headline comparison={comparison} />
            <button
              className={`${styles.deltasBtn} ${showDeltas ? styles.deltasBtnActive : ""}`}
              onClick={() => setShowDeltas((v) => !v)}
              aria-label="Toggle deltas"
              aria-expanded={showDeltas}
              title="Metric and host deltas"
            >
              Deltas
            </button>
          </div>
          <div className={stepStyles.visuallyHidden} aria-live="polite" aria-atomic="true">
            Step {pairIndex + 1} of {pairs.length}: {labels[pairIndex]}
          </div>
          <StepTrack labels={labels} stepIndex={pairIndex} goTo={nav.goTo} />
          <PairInfo views={views} pairIndex={pairIndex} total={pairs.length} />
          <StepControls nav={nav} className={styles.controls} />
        </div>
      </div>
    </div>
  );
}
