import { useCallback, useRef, useState } from "react";
import { parseHarJson } from "@htv/core/parsers/har-parser.js";
import { parseTraceJson } from "@htv/core/parsers/trace-parser.js";
import type { PageFlow, ParsedHar, ParsedTrace } from "@htv/core/types.js";
import styles from "./FlowBuilder.module.css";

interface PageEntry {
  id: string;
  name: string;
  har: ParsedHar | null;
  harFileName: string;
  trace: ParsedTrace | null;
  traceFileName: string;
  harError: string | null;
  traceError: string | null;
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
  };
}

async function readTraceFile(file: File): Promise<ParsedTrace> {
  if (file.name.endsWith(".gz")) {
    const buffer = await file.arrayBuffer();
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(buffer);
    writer.close();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    return parseTraceJson(new TextDecoder().decode(merged));
  }
  return parseTraceJson(await file.text());
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
  page, idx, total, isDraggingOver,
  onNameChange, onHarFile, onTraceFile,
  onMoveUp, onMoveDown, onRemove,
  onDragOver, onDragLeave,
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
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={handleHarDrop}
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
          title={page.har ? page.harFileName : "Click or drop a .har file"}
        >
          {page.har
            ? <span className={styles.harName}>{page.harFileName}</span>
            : page.harError
            ? <span className={styles.errorText}>{page.harError}</span>
            : <><span className={styles.harIcon}>⬇</span> Drop .har</>
          }
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
          disabled={!page.har}
          title={page.trace ? page.traceFileName : "Load a Chrome DevTools trace (optional)"}
        >
          {page.trace ? "Trace ✓" : "Trace"}
        </button>
        {page.traceError && (
          <span className={styles.traceErrorText}>{page.traceError}</span>
        )}
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
  onGenerate: (pages: PageFlow[]) => void;
}

export function FlowBuilder({ onGenerate }: Props) {
  const [pages, setPages] = useState<PageEntry[]>([makeEntry("Page 1")]);
  const [draggingOver, setDraggingOver] = useState<string | null>(null);

  const update = useCallback((id: string, patch: Partial<PageEntry>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const handleHarFile = useCallback((id: string, file: File) => {
    if (!file.name.endsWith(".har")) {
      update(id, { harError: "Only .har files are supported." });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const har = parseHarJson(e.target?.result as string);
        update(id, { har, harFileName: file.name, harError: null });
      } catch {
        update(id, { harError: "Could not parse HAR file." });
      }
    };
    reader.readAsText(file);
  }, [update]);

  const handleTraceFile = useCallback(async (id: string, file: File) => {
    if (!file.name.endsWith(".json") && !file.name.endsWith(".gz")) {
      update(id, { traceError: "Expected .json or .json.gz trace file." });
      return;
    }
    try {
      const trace = await readTraceFile(file);
      update(id, { trace, traceFileName: file.name, traceError: null });
    } catch {
      update(id, { traceError: "Could not parse trace file." });
    }
  }, [update]);

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

  const canGenerate = pages.some((p) => p.har !== null);

  const handleGenerate = () => {
    const pageFlows: PageFlow[] = pages
      .filter((p) => p.har !== null)
      .map((p) => ({
        name: p.name.trim() || "Page",
        har: p.har!,
        ...(p.trace ? { trace: p.trace } : {}),
      }));
    onGenerate(pageFlows);
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
        <button
          className={styles.generateBtn}
          onClick={handleGenerate}
          disabled={!canGenerate}
        >
          Generate diagram →
        </button>
      </div>
    </div>
  );
}
