import type { HarEntry } from "@htv/core/types.js";
import type { DiagramState, Speed } from "../hooks/useDiagramState.js";
import styles from "./StepPanel.module.css";

interface Props {
  state: DiagramState;
  onOpenResources: (resources: HarEntry[]) => void;
}

const SPEEDS: { label: string; value: Speed }[] = [
  { label: "0.5×", value: 2000 },
  { label: "1×",   value: 1400 },
  { label: "2×",   value: 800 },
  { label: "4×",   value: 400 },
];

// Inline SVG icon: a stacked list to suggest "view resource list"
function ResourceListIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="3" y1="4" x2="9" y2="4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      <line x1="3" y1="6" x2="9" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      <line x1="3" y1="8" x2="7" y2="8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

export function StepPanel({ state, onOpenResources }: Props) {
  const { flow, stepIndex, isPlaying, speed, goTo, prev, next, togglePlay, setSpeed } = state;
  const step = flow.steps[stepIndex];
  const total = flow.steps.length;

  return (
    <div className={styles.panel}>
      {/* Step track */}
      <div className={styles.track} role="tablist" aria-label="Steps">
        {flow.steps.map((s, i) => {
          const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
          return (
            <button
              key={i}
              role="tab"
              aria-selected={i === stepIndex}
              aria-label={`Step ${i + 1}: ${s.title}`}
              className={`${styles.trackDot} ${styles[status]}`}
              onClick={() => goTo(i)}
            >
              {i < stepIndex ? "✓" : i + 1}
            </button>
          );
        })}
      </div>

      {/* Info card */}
      <div className={styles.info}>
        <div className={styles.infoMain}>
          <div className={styles.stepCounter}>
            Step {stepIndex + 1} / {total}
          </div>
          <div className={styles.title}>{step.title}</div>
          <div className={styles.description}>{step.description}</div>
        </div>

        {step.metrics.length > 0 && (
          <div className={styles.metrics}>
            {step.metrics.map((m) => (
              <div key={m.label} className={styles.metric}>
                <span className={styles.metricLabel}>{m.label}</span>
                <span className={styles.metricValue}>{m.value}</span>
              </div>
            ))}
            {step.resources && step.resources.length > 0 && (
              <button
                className={styles.resourcesBtn}
                onClick={() => onOpenResources(step.resources!)}
                aria-label="View resource list"
                title="View resource list"
              >
                <ResourceListIcon />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <button
          className={styles.btn}
          onClick={prev}
          disabled={stepIndex === 0}
          aria-label="Previous step"
        >
          ← Prev
        </button>
        <button
          className={styles.btn}
          onClick={next}
          disabled={stepIndex === total - 1}
          aria-label="Next step"
        >
          Next →
        </button>
        <button
          className={`${styles.btn} ${styles.btnPlay} ${isPlaying ? styles.playing : ""}`}
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Auto play"}
        >
          {isPlaying ? "⏸ Pause" : "▶ Auto Play"}
        </button>
        <button
          className={styles.btn}
          onClick={() => goTo(0)}
          disabled={stepIndex === 0}
          aria-label="Reset to first step"
          title="Reset to step 1"
        >
          ↺
        </button>
        <div className={styles.speedWrap}>
          <span className={styles.speedLabel}>SPEED</span>
          <select
            className={styles.speedSelect}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
            aria-label="Playback speed"
          >
            {SPEEDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
