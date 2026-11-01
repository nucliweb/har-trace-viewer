import { useCallback, useId, useRef, useState } from "react";
import {
  defaultComparePageIds,
  defaultSelectedPageIds,
  expandPageFlows,
  isClientRegion,
  listHarPages,
  webPageTestLabel,
} from "@htv/core";
import type { ClientRegion, Flow, FlowOptions, PageFlow, ParsedHar, ParsedTrace } from "@htv/core";
import { parseInWorker } from "../lib/parse-client.js";
import type { ParseProgress } from "../lib/parse-protocol.js";
import styles from "./FlowBuilder.module.css";

interface PageEntry {
  id: string;
  name: string;
  har: ParsedHar[] | null;
  /** Ids of the HAR pages to expand; only meaningful when the HAR has several pages. */
  selectedPageIds: string[];
  harFileName: string;
  trace: ParsedTrace | null;
  traceFileName: string;
  harError: string | null;
  traceError: string | null;
  harProgress: ParseProgress | null;
  traceProgress: ParseProgress | null;
  /** Two page ids of a multi-page HAR proposed for a comparison (first vs repeat view). */
  comparePair: [string, string] | null;
  /** Compare comparePair[0] (A) with comparePair[1] (B) instead of building a flow. */
  comparePages: boolean;
}

type EntryPatch = Partial<PageEntry>;

function makeEntry(name = ""): PageEntry {
  return {
    id: crypto.randomUUID(),
    name,
    har: null,
    selectedPageIds: [],
    harFileName: "",
    trace: null,
    traceFileName: "",
    harError: null,
    traceError: null,
    harProgress: null,
    traceProgress: null,
    comparePair: null,
    comparePages: false,
  };
}

const PHASE_LABEL = { reading: "Reading", decompressing: "Decompressing", parsing: "Parsing" };

function describeProgress({ phase, loaded, total }: ParseProgress): string {
  const label = `${PHASE_LABEL[phase]}…`;
  return phase === "parsing" || total === 0
    ? label
    : `${label} ${Math.min(100, Math.round((loaded / total) * 100))} %`;
}

/** A loaded HAR contributes pages unless it has several and none is ticked. */
function hasFlowPages(p: PageEntry): boolean {
  return p.har !== null && (p.har.length === 1 || p.selectedPageIds.length > 0);
}

const isEntryParsing = (p: PageEntry) => p.harProgress !== null || p.traceProgress !== null;

// The parsers' messages are written for the user: they are shown as they are.
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Parses a dropped HAR in the worker, reporting progress and the result through `apply`. */
function loadHarFile(file: File, apply: (patch: EntryPatch) => void) {
  if (!/\.har(\.gz)?$/i.test(file.name)) {
    apply({ harError: "Only .har and .har.gz files are supported." });
    return;
  }
  apply({ harProgress: { phase: "reading", loaded: 0, total: file.size }, harError: null });
  parseInWorker("har", file, (harProgress) => apply({ harProgress }))
    .then((har) =>
      apply({
        har,
        selectedPageIds: defaultSelectedPageIds(har),
        comparePair: defaultComparePageIds(har),
        harFileName: file.name,
        harError: null,
        harProgress: null,
      })
    )
    .catch((error: unknown) => apply({ harError: errorMessage(error), harProgress: null }));
}

/** Parses a dropped Chrome trace in the worker, reporting progress and the result through `apply`. */
async function loadTraceFile(file: File, apply: (patch: EntryPatch) => void) {
  if (!file.name.endsWith(".json") && !file.name.endsWith(".gz")) {
    apply({ traceError: "Expected .json or .json.gz trace file." });
    return;
  }
  apply({ traceProgress: { phase: "reading", loaded: 0, total: file.size }, traceError: null });
  try {
    const trace = await parseInWorker("trace", file, (traceProgress) => apply({ traceProgress }));
    apply({ trace, traceFileName: file.name, traceError: null, traceProgress: null });
  } catch (error) {
    apply({ traceError: errorMessage(error), traceProgress: null });
  }
}

const pageOptionLabel = (page: ReturnType<typeof listHarPages>[number]) =>
  `${webPageTestLabel(page.title) ?? (page.title || page.url)} (${page.entries} req)`;

// ── FileZones ─────────────────────────────────────────────────────────────────

interface FileZonesProps {
  entry: PageEntry;
  onHarFile: (file: File) => void;
  onTraceFile: (file: File) => void;
  /** Text of the empty HAR button. */
  dropLabel?: string;
  /** Accessible names of the file inputs, when they need one of their own. */
  harInputLabel?: string;
  traceInputLabel?: string;
}

/** The HAR button (click or drop) and the optional trace button of one recording. */
function FileZones({
  entry,
  onHarFile,
  onTraceFile,
  dropLabel = "Drop .har",
  harInputLabel,
  traceInputLabel,
}: FileZonesProps) {
  const harInputRef = useRef<HTMLInputElement>(null);
  const traceInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className={styles.harZone}>
        <input
          ref={harInputRef}
          type="file"
          accept=".har,.gz"
          className={styles.hiddenInput}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onHarFile(f);
            e.target.value = "";
          }}
          aria-hidden="true"
          aria-label={harInputLabel}
          tabIndex={-1}
        />
        <button
          className={`${styles.harBtn} ${entry.har ? styles.harLoaded : ""} ${entry.harError ? styles.harError : ""}`}
          onClick={() => harInputRef.current?.click()}
          disabled={entry.harProgress !== null}
          title={
            entry.har
              ? entry.harFileName
              : (entry.harError ?? "Click or drop a .har or .har.gz file")
          }
        >
          {entry.harProgress ? (
            <span className={styles.progressText} role="status">
              {describeProgress(entry.harProgress)}
            </span>
          ) : entry.har ? (
            <span className={styles.harName}>
              {entry.harFileName}
              {entry.har.length > 1 ? ` · ${entry.har.length} pages` : ""}
            </span>
          ) : entry.harError ? (
            <span className={styles.errorText}>{entry.harError}</span>
          ) : (
            <>
              <span className={styles.harIcon}>⬇</span> {dropLabel}
            </>
          )}
        </button>
      </div>

      <div className={styles.traceZone}>
        <input
          ref={traceInputRef}
          type="file"
          accept=".json,.gz"
          className={styles.hiddenInput}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onTraceFile(f);
            e.target.value = "";
          }}
          aria-hidden="true"
          aria-label={traceInputLabel}
          tabIndex={-1}
        />
        <button
          className={`${styles.traceBtn} ${entry.trace ? styles.traceLoaded : ""}`}
          onClick={() => traceInputRef.current?.click()}
          disabled={!entry.har || entry.traceProgress !== null}
          title={entry.trace ? entry.traceFileName : "Load a Chrome DevTools trace (optional)"}
        >
          {entry.trace ? "Trace ✓" : "Trace"}
        </button>
        {entry.traceProgress && (
          <span className={styles.progressText} role="status">
            {describeProgress(entry.traceProgress)}
          </span>
        )}
        {entry.traceError && (
          <span className={styles.traceErrorText} title={entry.traceError}>
            {entry.traceError}
          </span>
        )}
      </div>
    </>
  );
}

// ── PageRow ───────────────────────────────────────────────────────────────────

interface PageRowProps {
  page: PageEntry;
  idx: number;
  total: number;
  isDraggingOver: boolean;
  onNameChange: (name: string) => void;
  onHarFile: (file: File) => void;
  onSelectedPagesChange: (ids: string[]) => void;
  /** Offers to compare two pages of this HAR instead of building a flow. */
  showComparePicker: boolean;
  onComparePagesChange: (patch: Pick<PageEntry, "comparePair" | "comparePages">) => void;
  onTraceFile: (file: File) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
}

function PageRow({
  page,
  idx,
  total,
  isDraggingOver,
  onNameChange,
  onHarFile,
  onSelectedPagesChange,
  showComparePicker,
  onComparePagesChange,
  onTraceFile,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragOver,
  onDragLeave,
}: PageRowProps) {
  const handleHarDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDragLeave();
    const file = e.dataTransfer.files[0];
    if (file) onHarFile(file);
  };

  return (
    <div className={styles.rowGroup}>
      <div
        className={`${styles.row} ${isDraggingOver ? styles.rowDragging : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOver();
        }}
        onDragLeave={onDragLeave}
        onDrop={handleHarDrop}
        aria-busy={isEntryParsing(page)}
      >
        <div className={styles.rowOrder}>
          <button
            className={styles.orderBtn}
            onClick={onMoveUp}
            disabled={idx === 0}
            title="Move up"
            aria-label="Move page up"
          >
            ↑
          </button>
          <button
            className={styles.orderBtn}
            onClick={onMoveDown}
            disabled={idx === total - 1}
            title="Move down"
            aria-label="Move page down"
          >
            ↓
          </button>
        </div>

        <input
          className={styles.nameInput}
          type="text"
          value={page.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Page name"
          aria-label={`Page ${idx + 1} name`}
        />

        <FileZones entry={page} onHarFile={onHarFile} onTraceFile={onTraceFile} />

        <button
          className={styles.removeBtn}
          onClick={onRemove}
          disabled={total === 1}
          title="Remove page"
          aria-label="Remove page"
        >
          ×
        </button>
      </div>
      {page.har && page.har.length > 1 && !(showComparePicker && page.comparePages) && (
        <PageChecklist
          har={page.har}
          selected={page.selectedPageIds}
          name={page.name || `Page ${idx + 1}`}
          onChange={onSelectedPagesChange}
        />
      )}
      {showComparePicker && page.har && page.comparePair && (
        <ComparePagesPicker
          har={page.har}
          pair={page.comparePair}
          enabled={page.comparePages}
          onChange={onComparePagesChange}
        />
      )}
    </div>
  );
}

interface ComparePagesPickerProps {
  har: ParsedHar[];
  pair: [string, string];
  enabled: boolean;
  onChange: (patch: Pick<PageEntry, "comparePair" | "comparePages">) => void;
}

/** Compares two pages of one HAR, e.g. the first and the repeat view of a WebPageTest run. */
function ComparePagesPicker({ har, pair, enabled, onChange }: ComparePagesPickerProps) {
  const pages = listHarPages(har);
  const idA = useId();
  const idB = useId();
  const pick = (side: 0 | 1, id: string) => {
    const next: [string, string] = [...pair];
    next[side] = id;
    onChange({ comparePair: next, comparePages: enabled });
  };
  return (
    <fieldset className={styles.checklist}>
      <legend className={styles.checklistLegend}>Compare pages</legend>
      <label className={styles.checklistItem}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ comparePair: pair, comparePages: e.target.checked })}
        />
        <span>Compare two pages of this HAR</span>
      </label>
      {([0, 1] as const).map((side) => (
        <span key={side} className={styles.pairField}>
          <label className={styles.pairLabel} htmlFor={side === 0 ? idA : idB}>
            {side === 0 ? "A" : "B"}
          </label>
          <select
            id={side === 0 ? idA : idB}
            className={styles.regionSelect}
            value={pair[side]}
            disabled={!enabled}
            onChange={(e) => pick(side, e.target.value)}
          >
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {pageOptionLabel(page)}
              </option>
            ))}
          </select>
        </span>
      ))}
    </fieldset>
  );
}

interface CompareTargetProps {
  entry: PageEntry;
  onHarFile: (file: File) => void;
  onTraceFile: (file: File) => void;
  onPageChange: (id: string) => void;
  onRemove: () => void;
}

/** Optional second recording: the report then compares it (B) with the flow above (A). */
function CompareTarget({
  entry,
  onHarFile,
  onTraceFile,
  onPageChange,
  onRemove,
}: CompareTargetProps) {
  const [dragging, setDragging] = useState(false);
  const pageSelectId = useId();
  const pages = entry.har && entry.har.length > 1 ? listHarPages(entry.har) : null;
  return (
    <fieldset className={styles.compare}>
      <legend className={styles.compareLegend}>Compare with…</legend>
      <p className={styles.compareHint}>
        Optional: a second recording of the same page, e.g. with a warm cache. The first page of
        each side is compared step by step.
      </p>
      <div
        className={`${styles.row} ${dragging ? styles.rowDragging : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onHarFile(file);
        }}
        aria-busy={isEntryParsing(entry)}
      >
        <FileZones
          entry={entry}
          onHarFile={onHarFile}
          onTraceFile={onTraceFile}
          dropLabel="Drop .har to compare"
          harInputLabel="HAR file to compare with"
          traceInputLabel="Trace to compare with"
        />
        <button
          className={styles.removeBtn}
          onClick={onRemove}
          disabled={!entry.har && !entry.harError}
          title="Remove comparison"
          aria-label="Remove comparison"
        >
          ×
        </button>
      </div>
      {pages && (
        <span className={styles.pairField}>
          <label className={styles.pairLabel} htmlFor={pageSelectId}>
            Page
          </label>
          <select
            id={pageSelectId}
            className={styles.regionSelect}
            value={entry.selectedPageIds[0]}
            onChange={(e) => onPageChange(e.target.value)}
          >
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {pageOptionLabel(page)}
              </option>
            ))}
          </select>
        </span>
      )}
    </fieldset>
  );
}

interface PageChecklistProps {
  har: ParsedHar[];
  selected: string[];
  name: string;
  onChange: (ids: string[]) => void;
}

/** Which pages of a multi-page HAR (e.g. the runs and views of a WebPageTest export) join the flow. */
function PageChecklist({ har, selected, name, onChange }: PageChecklistProps) {
  const pages = listHarPages(har);
  const allSelected = selected.length === pages.length;
  const toggle = (id: string) =>
    onChange(pages.map((p) => p.id).filter((pid) => (pid === id) !== selected.includes(pid)));
  return (
    <fieldset className={styles.checklist}>
      <legend className={styles.checklistLegend}>Pages to include from {name}</legend>
      <button
        type="button"
        className={styles.checklistToggle}
        onClick={() => onChange(allSelected ? [] : pages.map((p) => p.id))}
      >
        {allSelected ? "Select none" : "Select all"}
      </button>
      <ul className={styles.checklistItems}>
        {pages.map((page) => (
          <li key={page.id}>
            <label className={styles.checklistItem}>
              <input
                type="checkbox"
                checked={selected.includes(page.id)}
                onChange={() => toggle(page.id)}
              />
              <span>{pageOptionLabel(page)}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

// ── FlowBuilder ───────────────────────────────────────────────────────────────

interface Props {
  /** `comparePages`, when given, is a second flow (B) to compare with `pages` (A). */
  onGenerate: (pages: PageFlow[], options: FlowOptions, comparePages?: PageFlow[]) => void;
  /** When set, the empty state offers a ready-made demo flow, fetched on demand. */
  onLoadFlow?: (flow: Flow) => void;
}

/** Mini diagram motif: browser, edge and origin joined by a dashed request path. */
function DemoGlyph() {
  return (
    <svg className={styles.demoGlyph} viewBox="0 0 72 32" aria-hidden="true" focusable="false">
      <path d="M10 16 H36 M36 16 H62" className={styles.demoGlyphPath} />
      <circle cx="10" cy="16" r="5" className={styles.demoGlyphNode} />
      <circle cx="36" cy="16" r="5" className={styles.demoGlyphNode} />
      <circle cx="62" cy="16" r="5" className={styles.demoGlyphOrigin} />
    </svg>
  );
}

function Guide() {
  return (
    <section className={styles.guide} aria-labelledby="guide-heading">
      <h3 id="guide-heading" className={styles.guideHeading}>
        Where do the files come from?
      </h3>
      <div className={styles.guideColumns}>
        <div className={styles.guideCard}>
          <h4 className={styles.guideTitle}>HAR file</h4>
          <ol className={styles.guideSteps}>
            <li>Open DevTools and go to the Network panel.</li>
            <li>Tick &ldquo;Preserve log&rdquo; and reload the page.</li>
            <li>Click the download icon, &ldquo;Export HAR (with content)&rdquo;.</li>
          </ol>
        </div>
        <div className={styles.guideCard}>
          <h4 className={styles.guideTitle}>Trace (optional)</h4>
          <ol className={styles.guideSteps}>
            <li>Go to the Performance panel.</li>
            <li>Click &ldquo;Record and reload&rdquo;, then stop the recording.</li>
            <li>Click &ldquo;Save profile&rdquo; to get a .json.gz file.</li>
          </ol>
        </div>
      </div>
    </section>
  );
}

export function FlowBuilder({ onGenerate, onLoadFlow }: Props) {
  const [pages, setPages] = useState<PageEntry[]>([makeEntry("Page 1")]);
  const [draggingOver, setDraggingOver] = useState<string | null>(null);
  const [clientRegion, setClientRegion] = useState<ClientRegion>("default");
  const regionSelectId = useId();
  const [demoStatus, setDemoStatus] = useState<"idle" | "loading" | "error">("idle");

  const loadDemo = useCallback(() => {
    setDemoStatus("loading");
    // A separate chunk: the demo flow is only downloaded when someone asks for it.
    import("../demo/demo-flow.json")
      .then((module) => onLoadFlow?.(module.default as unknown as Flow))
      .catch(() => setDemoStatus("error"));
  }, [onLoadFlow]);

  const update = useCallback((id: string, patch: Partial<PageEntry>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const handleHarFile = useCallback(
    (id: string, file: File) => loadHarFile(file, (patch) => update(id, patch)),
    [update]
  );

  const handleTraceFile = useCallback(
    (id: string, file: File) => loadTraceFile(file, (patch) => update(id, patch)),
    [update]
  );

  const [compareEntry, setCompareEntry] = useState<PageEntry>(() => makeEntry());
  const updateCompare = useCallback(
    (patch: EntryPatch) => setCompareEntry((prev) => ({ ...prev, ...patch })),
    []
  );

  const moveUp = useCallback((idx: number) => {
    setPages((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((idx: number) => {
    setPages((prev) => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const removePage = useCallback((id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addPage = () => {
    setPages((prev) => [...prev, makeEntry(`Page ${prev.length + 1}`)]);
  };

  // Two pages of a single multi-page HAR (first vs repeat view) can be compared directly.
  const [firstEntry] = pages;
  const pickerAvailable = pages.length === 1 && (firstEntry.har?.length ?? 0) > 1;
  const pagePair = pickerAvailable && firstEntry.comparePages ? firstEntry.comparePair : null;
  const comparing = pagePair !== null || compareEntry.har !== null;

  const isParsing = [...pages, compareEntry].some(isEntryParsing);
  const canGenerate = !isParsing && (pagePair !== null || pages.some(hasFlowPages));

  const handleGenerate = () => {
    if (pagePair) {
      const side = (id: string) =>
        expandPageFlows({
          name: firstEntry.name.trim() || "Page",
          har: firstEntry.har!,
          select: { pageIds: [id] },
          // The trace belongs to one recording: it stays with A.
          ...(firstEntry.trace && id === pagePair[0] ? { trace: firstEntry.trace } : {}),
        });
      onGenerate(side(pagePair[0]), { clientRegion }, side(pagePair[1]));
      return;
    }
    const pageFlows: PageFlow[] = pages.filter(hasFlowPages).flatMap((p) =>
      expandPageFlows({
        name: p.name.trim() || "Page",
        har: p.har!,
        ...(p.har!.length > 1 ? { select: { pageIds: p.selectedPageIds } } : {}),
        ...(p.trace ? { trace: p.trace } : {}),
      })
    );
    const compareHar = compareEntry.har;
    if (!compareHar) {
      onGenerate(pageFlows, { clientRegion });
      return;
    }
    const comparePages = expandPageFlows({
      ...(compareHar.length === 1
        ? { name: compareEntry.harFileName.replace(/\.har$/i, "") }
        : { select: { pageIds: compareEntry.selectedPageIds.slice(0, 1) } }),
      har: compareHar,
      ...(compareEntry.trace ? { trace: compareEntry.trace } : {}),
    });
    onGenerate(pageFlows, { clientRegion }, comparePages);
  };

  return (
    <div className={styles.builder}>
      <h2 className={styles.heading}>Build your flow</h2>
      <p className={styles.hint}>
        Add one page for a single-page trace, or multiple pages to visualise a user journey.
      </p>

      {onLoadFlow && (
        <div className={styles.demo}>
          <DemoGlyph />
          <div className={styles.demoText}>
            <p className={styles.demoTitle}>No files at hand?</p>
            <p className={styles.demoCopy}>
              Step through a real page load, captured as a HAR file and a Chrome trace.
            </p>
            {demoStatus === "error" && (
              <p className={styles.demoError} role="alert">
                Could not load the demo flow.
              </p>
            )}
          </div>
          <button className={styles.demoBtn} onClick={loadDemo} disabled={demoStatus === "loading"}>
            {demoStatus === "loading" ? "Loading…" : "Load demo flow →"}
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
            onNameChange={(name) => update(page.id, { name })}
            onHarFile={(file) => handleHarFile(page.id, file)}
            onSelectedPagesChange={(selectedPageIds) => update(page.id, { selectedPageIds })}
            showComparePicker={pickerAvailable}
            onComparePagesChange={(patch) => update(page.id, patch)}
            onTraceFile={(file) => handleTraceFile(page.id, file)}
            onMoveUp={() => moveUp(idx)}
            onMoveDown={() => moveDown(idx)}
            onRemove={() => removePage(page.id)}
            onDragOver={() => setDraggingOver(page.id)}
            onDragLeave={() => setDraggingOver(null)}
          />
        ))}
      </div>

      {!pagePair && (
        <CompareTarget
          entry={compareEntry}
          onHarFile={(file) => loadHarFile(file, updateCompare)}
          onTraceFile={(file) => loadTraceFile(file, updateCompare)}
          onPageChange={(id) => updateCompare({ selectedPageIds: [id] })}
          onRemove={() => setCompareEntry(makeEntry())}
        />
      )}

      <div className={styles.footer}>
        <button className={styles.addBtn} onClick={addPage}>
          + Add page
        </button>
        <div className={styles.footerActions}>
          <div className={styles.regionField}>
            <label className={styles.regionLabel} htmlFor={regionSelectId}>
              Client region
            </label>
            <select
              id={regionSelectId}
              className={styles.regionSelect}
              value={clientRegion}
              onChange={(e) => {
                if (isClientRegion(e.target.value)) setClientRegion(e.target.value);
              }}
            >
              <option value="default">Default</option>
              <option value="cn">China (behind the Great Firewall)</option>
            </select>
          </div>
          <button className={styles.generateBtn} onClick={handleGenerate} disabled={!canGenerate}>
            {comparing ? "Generate comparison →" : "Generate diagram →"}
          </button>
        </div>
      </div>

      <Guide />
    </div>
  );
}
