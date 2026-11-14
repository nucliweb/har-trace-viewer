import { useCallback, useId, useState } from "react";
import { isClientRegion } from "@htv/core";
import type { ClientRegion, Flow, FlowOptions, PageFlow } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import styles from "./FlowBuilder.module.css";
import { CompareTarget } from "./flow-builder/CompareTarget.js";
import { DemoGlyph, Guide } from "./flow-builder/Guide.js";
import { PageRow } from "./flow-builder/PageRow.js";
import {
  buildGeneration,
  hasFlowPages,
  isEntryParsing,
  needsHar,
  pagePairOf,
} from "./flow-builder/page-entry.js";
import { usePageEntries } from "./flow-builder/usePageEntries.js";

interface Props {
  /** `comparePages`, when given, is a second flow (B) to compare with `pages` (A). */
  onGenerate: (pages: PageFlow[], options: FlowOptions, comparePages?: PageFlow[]) => void;
  /** When set, the empty state offers a ready-made demo flow, fetched on demand. */
  onLoadFlow?: (flow: Flow) => void;
  /** Offers multi-page journeys: "+ Add page", the page order and removing a page. */
  journeys?: boolean;
  /** Why the last attempt to generate failed, shown above the Generate button. */
  error?: string | null;
  /** A generation is running: the Generate button says so and does not start another. */
  generating?: boolean;
}

/**
 * The form that builds a flow: one row per page with its HAR and optional trace, an optional
 * recording to compare with, the client region and the Generate button; the empty state
 * offers a demo flow.
 */
export function FlowBuilder({
  onGenerate,
  onLoadFlow,
  journeys = false,
  error = null,
  generating = false,
}: Props) {
  const messages = useMessages();
  const t = messages.builder;
  const entries = usePageEntries();
  const { pages, compare } = entries;
  const [draggingOver, setDraggingOver] = useState<string | null>(null);
  // "auto" leaves the region to the latencies: generateFlow takes the region they suggest.
  const [clientRegion, setClientRegion] = useState<ClientRegion | "auto">("auto");
  const regionSelectId = useId();
  const [demoStatus, setDemoStatus] = useState<"idle" | "loading" | "error">("idle");

  const loadDemo = useCallback(() => {
    setDemoStatus("loading");
    // A separate chunk: the demo flow is only downloaded when someone asks for it.
    import("../demo/demo-flow.json")
      .then((module) => onLoadFlow?.(module.default as unknown as Flow))
      .catch(() => setDemoStatus("error"));
  }, [onLoadFlow]);

  // A journey of several pages keeps its controls with the option off: nothing added is hidden.
  const journeyControls = journeys || pages.length > 1;
  const pagePair = pagePairOf(pages);
  const pickerAvailable = pages.length === 1 && (pages[0].har?.length ?? 0) > 1;
  const comparing = pagePair !== null || compare.har !== null;
  const isParsing = [...pages, compare].some(isEntryParsing);
  // A trace waiting for its HAR would be dropped from the flow without a word: Generate waits.
  const canGenerate =
    !isParsing &&
    ![...pages, compare].some(needsHar) &&
    (pagePair !== null || pages.some(hasFlowPages));

  const handleGenerate = () => {
    if (generating) return;
    const generation = buildGeneration(
      pages,
      compare,
      clientRegion === "auto" ? undefined : clientRegion,
      t.page
    );
    onGenerate(generation.pages, generation.options, generation.comparePages);
  };

  return (
    <div className={styles.builder}>
      <h2 className={styles.heading}>{t.heading}</h2>
      <p className={styles.hint}>{journeyControls ? t.hint : t.hintSingle}</p>

      {onLoadFlow && (
        <div className={styles.demo}>
          <DemoGlyph />
          <div className={styles.demoText}>
            <p className={styles.demoTitle}>{t.demoTitle}</p>
            <p className={styles.demoCopy}>{t.demoCopy}</p>
            {demoStatus === "error" && (
              <p className={styles.demoError} role="alert">
                {t.demoError}
              </p>
            )}
          </div>
          <button className={styles.demoBtn} onClick={loadDemo} disabled={demoStatus === "loading"}>
            {demoStatus === "loading" ? t.loading : t.loadDemo}
          </button>
        </div>
      )}

      <div className={styles.pages}>
        {pages.map((page, idx) => (
          <PageRow
            key={page.id}
            page={page}
            idx={idx}
            total={pages.length}
            isDraggingOver={draggingOver === page.id}
            journey={journeyControls}
            onNameChange={(name) => entries.update(page.id, { name })}
            onHarFile={(file) => entries.loadFile(page.id, file)}
            onSelectedPagesChange={(selectedPageIds) =>
              entries.update(page.id, { selectedPageIds })
            }
            showComparePicker={pickerAvailable}
            onComparePagesChange={(patch) => entries.update(page.id, patch)}
            onTraceFile={(file) => entries.loadTrace(page.id, file)}
            onMoveUp={() => entries.move(idx, -1)}
            onMoveDown={() => entries.move(idx, 1)}
            onRemove={() => entries.remove(page.id)}
            onDragOver={() => setDraggingOver(page.id)}
            onDragLeave={() => setDraggingOver(null)}
          />
        ))}
      </div>

      {!pagePair && (
        <CompareTarget
          entry={compare}
          onHarFile={entries.loadCompareFile}
          onTraceFile={entries.loadCompareTrace}
          onPageChange={(id) => entries.updateCompare({ selectedPageIds: [id] })}
          onRemove={entries.resetCompare}
        />
      )}

      {error && (
        <p className={styles.generateError} role="alert">
          {error}
        </p>
      )}

      <div className={styles.footer}>
        {journeyControls && (
          <button className={styles.addBtn} onClick={entries.add}>
            {t.addPage}
          </button>
        )}
        <div className={styles.footerActions}>
          <div className={styles.regionField}>
            <label className={styles.regionLabel} htmlFor={regionSelectId}>
              {t.clientRegion}
            </label>
            <select
              id={regionSelectId}
              className={styles.regionSelect}
              value={clientRegion}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "auto" || isClientRegion(value)) setClientRegion(value);
              }}
            >
              <option value="auto">{t.regionAuto}</option>
              <option value="default">{t.regionDefault}</option>
              <option value="cn">{t.regionCn}</option>
            </select>
          </div>
          {/* aria-disabled, not disabled, while generating: the button keeps the focus. */}
          <button
            className={styles.generateBtn}
            onClick={handleGenerate}
            disabled={!canGenerate}
            aria-disabled={generating || undefined}
          >
            {generating
              ? messages.app.generating
              : comparing
                ? t.generateComparison
                : t.generateDiagram}
          </button>
        </div>
      </div>

      <Guide />
    </div>
  );
}
