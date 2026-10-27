import { useCallback, useId, useRef, useState } from "react";
import { expandPageFlows } from "@htv/core";
import { isClientRegion } from "@htv/core/steps/step-generator.js";
import type {
  ClientRegion,
  FlowOptions,
  PageFlow,
  ParsedHar,
  ParsedTrace,
} from "@htv/core/types.js";
import { parseInWorker } from "../lib/parse-client.js";
import type { ParseProgress } from "../lib/parse-protocol.js";
import styles from "./FlowBuilder.module.css";

interface PageEntry {
  id: string;
  name: string;
  har: ParsedHar[] | null;
  harFileName: string;
  trace: ParsedTrace | null;
  traceFileName: string;
  harError: string | null;
  traceError: string | null;
  harProgress: ParseProgress | null;
  traceProgress: ParseProgress | null;
}

function makeEntry(name = ""): PageEntry {
  return {
    id: crypto.randomUUID(),
    name,
    har: null,
    harFileName: "",
    trace: null,
    traceFileName: "",
    harError: null,
    traceError: null,
    harProgress: null,
    traceProgress: null,
  };
}

const PHASE_LABEL = { reading: "Reading", decompressing: "Decompressing", parsing: "Parsing" };

function describeProgress({ phase, loaded, total }: ParseProgress): string {
  const label = `${PHASE_LABEL[phase]}…`;
  return phase === "parsing" || total === 0
    ? label
    : `${label} ${Math.min(100, Math.round((loaded / total) * 100))} %`;
}

// ── PageRow ───────────────────────────────────────────────────────────────────

interface PageRowProps {
  page: PageEntry;
  idx: number;
  total: number;
  isDraggingOver: boolean;
  onNameChange: (name: string) => void;
  onHarFile: (file: File) => void;
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
  onTraceFile,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragOver,
  onDragLeave,
}: PageRowProps) {
  const harInputRef = useRef<HTMLInputElement>(null);
  const traceInputRef = useRef<HTMLInputElement>(null);

  const handleHarDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDragLeave();
    const file = e.dataTransfer.files[0];
    if (file) onHarFile(file);
  };

  return (
    <div
      className={`${styles.row} ${isDraggingOver ? styles.rowDragging : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={handleHarDrop}
      aria-busy={page.harProgress !== null || page.traceProgress !== null}
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

      <div className={styles.harZone}>
        <input
          ref={harInputRef}
          type="file"
          accept=".har"
          className={styles.hiddenInput}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onHarFile(f);
            e.target.value = "";
          }}
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          className={`${styles.harBtn} ${page.har ? styles.harLoaded : ""} ${page.harError ? styles.harError : ""}`}
          onClick={() => harInputRef.current?.click()}
          disabled={page.harProgress !== null}
          title={page.har ? page.harFileName : "Click or drop a .har file"}
        >
          {page.harProgress ? (
            <span className={styles.progressText} role="status">
              {describeProgress(page.harProgress)}
            </span>
          ) : page.har ? (
            <span className={styles.harName}>
              {page.harFileName}
              {page.har.length > 1 ? ` · ${page.har.length} pages` : ""}
            </span>
          ) : page.harError ? (
            <span className={styles.errorText}>{page.harError}</span>
          ) : (
            <>
              <span className={styles.harIcon}>⬇</span> Drop .har
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
          tabIndex={-1}
        />
        <button
          className={`${styles.traceBtn} ${page.trace ? styles.traceLoaded : ""}`}
          onClick={() => traceInputRef.current?.click()}
          disabled={!page.har || page.traceProgress !== null}
          title={page.trace ? page.traceFileName : "Load a Chrome DevTools trace (optional)"}
        >
          {page.trace ? "Trace ✓" : "Trace"}
        </button>
        {page.traceProgress && (
          <span className={styles.progressText} role="status">
            {describeProgress(page.traceProgress)}
          </span>
        )}
        {page.traceError && <span className={styles.traceErrorText}>{page.traceError}</span>}
      </div>

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
  );
}

// ── FlowBuilder ───────────────────────────────────────────────────────────────

interface Props {
  onGenerate: (pages: PageFlow[], options: FlowOptions) => void;
}

export function FlowBuilder({ onGenerate }: Props) {
  const [pages, setPages] = useState<PageEntry[]>([makeEntry("Page 1")]);
  const [draggingOver, setDraggingOver] = useState<string | null>(null);
  const [clientRegion, setClientRegion] = useState<ClientRegion>("default");
  const regionSelectId = useId();

  const update = useCallback((id: string, patch: Partial<PageEntry>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const handleHarFile = useCallback(
    (id: string, file: File) => {
      if (!file.name.endsWith(".har")) {
        update(id, { harError: "Only .har files are supported." });
        return;
      }
      update(id, {
        harProgress: { phase: "reading", loaded: 0, total: file.size },
        harError: null,
      });
      parseInWorker("har", file, (harProgress) => update(id, { harProgress }))
        .then((har) =>
          update(id, { har, harFileName: file.name, harError: null, harProgress: null })
        )
        .catch(() => update(id, { harError: "Could not parse HAR file.", harProgress: null }));
    },
    [update]
  );

  const handleTraceFile = useCallback(
    async (id: string, file: File) => {
      if (!file.name.endsWith(".json") && !file.name.endsWith(".gz")) {
        update(id, { traceError: "Expected .json or .json.gz trace file." });
        return;
      }
      update(id, {
        traceProgress: { phase: "reading", loaded: 0, total: file.size },
        traceError: null,
      });
      try {
        const trace = await parseInWorker("trace", file, (traceProgress) =>
          update(id, { traceProgress })
        );
        update(id, { trace, traceFileName: file.name, traceError: null, traceProgress: null });
      } catch {
        update(id, { traceError: "Could not parse trace file.", traceProgress: null });
      }
    },
    [update]
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

  const isParsing = pages.some((p) => p.harProgress !== null || p.traceProgress !== null);
  const canGenerate = !isParsing && pages.some((p) => p.har !== null);

  const handleGenerate = () => {
    const pageFlows: PageFlow[] = pages
      .filter((p) => p.har !== null)
      .flatMap((p) =>
        expandPageFlows({
          name: p.name.trim() || "Page",
          har: p.har!,
          ...(p.trace ? { trace: p.trace } : {}),
        })
      );
    onGenerate(pageFlows, { clientRegion });
  };

  return (
    <div className={styles.builder}>
      <h2 className={styles.heading}>Build your flow</h2>
      <p className={styles.hint}>
        Add one page for a single-page trace, or multiple pages to visualise a user journey.
      </p>

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
            onTraceFile={(file) => handleTraceFile(page.id, file)}
            onMoveUp={() => moveUp(idx)}
            onMoveDown={() => moveDown(idx)}
            onRemove={() => removePage(page.id)}
            onDragOver={() => setDraggingOver(page.id)}
            onDragLeave={() => setDraggingOver(null)}
          />
        ))}
      </div>

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
            Generate diagram →
          </button>
        </div>
      </div>
    </div>
  );
}
