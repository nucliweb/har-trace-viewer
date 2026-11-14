import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Flow } from "@htv/core";
import { collectFontFaceCss, downloadBlob, svgBlob, svgToPngBlob } from "../lib/export-browser.js";
import {
  currentTheme,
  exportFilename,
  readBadges,
  serializeDiagramSvg,
} from "../lib/export-diagram.js";
import { TEXT_EXPORTS, textExport, textExportFilename } from "../lib/export-text.js";
import type { TextExport } from "../lib/export-text.js";
import { useRedaction } from "../hooks/useRedaction.js";
import type { RedactionLevel } from "../hooks/useRedaction.js";
import { useMessages } from "../i18n/context.js";
import styles from "./ExportMenu.module.css";

interface Props {
  /** The flow the text exports describe; with `compare`, A of a comparison. */
  flow: Flow;
  compare?: Flow;
  /** Element that contains the diagram `<svg>` and the badge row; without it, no image export. */
  containerRef?: RefObject<HTMLElement | null>;
  pageName?: string;
  stepNumber?: number;
  disabled?: boolean;
  /** Injectable for tests. */
  download?: (blob: Blob, filename: string) => void;
  collectFonts?: () => Promise<string>;
}

const TEXT_KINDS = Object.keys(TEXT_EXPORTS) as TextExport[];
const REDACTION_LABELS = {
  off: "redactOff",
  secrets: "redactSecrets",
  "mask-hosts": "redactHosts",
} as const;
const REDACTION_LEVELS = Object.keys(REDACTION_LABELS) as RedactionLevel[];

export function ExportMenu({
  flow,
  compare,
  containerRef,
  pageName = "",
  stepNumber = 1,
  disabled = false,
  download = downloadBlob,
  collectFonts = collectFontFaceCss,
}: Props) {
  const t = useMessages().export;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [redaction, setRedaction] = useRedaction();
  const [summary, setSummary] = useState<string | null>(null);
  const groupId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const run = async (extension: "svg" | "png") => {
    const container = containerRef?.current;
    const svg = container?.querySelector<SVGSVGElement>('[id="diagram-svg"]');
    setOpen(false);
    if (!container || !svg) return;
    setBusy(true);
    setFailed(false);
    try {
      const svgString = serializeDiagramSvg(svg, {
        theme: currentTheme(),
        fontCss: await collectFonts(),
        badges: readBadges(container),
      });
      const blob = extension === "svg" ? svgBlob(svgString) : await svgToPngBlob(svgString, 2);
      download(blob, exportFilename(pageName, stepNumber, extension));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      buttonRef.current?.focus();
    }
  };

  const runText = (kind: TextExport) => {
    setOpen(false);
    const { blob, summary: redacted } = textExport(kind, flow, compare, redaction);
    setSummary(redacted);
    download(blob, textExportFilename(flow, compare, kind));
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={buttonRef}
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={() => {
          setSummary(null);
          setOpen((v) => !v);
        }}
      >
        {t.button}
      </button>
      {open && (
        // The menu container handles Escape and arrow keys on behalf of its menuitems.
        // eslint-disable-next-line jsx-a11y/interactive-supports-focus
        <div role="menu" aria-label={t.menu} className={styles.menu} onKeyDown={onMenuKeyDown}>
          {containerRef && (
            <>
              <button
                ref={firstItemRef}
                role="menuitem"
                className={styles.item}
                onClick={() => run("svg")}
              >
                {t.svg}
              </button>
              <button role="menuitem" className={styles.item} onClick={() => run("png")}>
                {t.png}
              </button>
            </>
          )}
          {TEXT_KINDS.map((kind, index) => (
            <button
              key={kind}
              ref={!containerRef && index === 0 ? firstItemRef : undefined}
              role="menuitem"
              className={styles.item}
              onClick={() => runText(kind)}
            >
              {t[kind]}
            </button>
          ))}
          <div role="group" aria-labelledby={groupId} className={styles.group}>
            <span id={groupId} className={styles.groupLabel}>
              {t.redactGroup}
            </span>
            {REDACTION_LEVELS.map((level) => (
              <button
                key={level}
                role="menuitemradio"
                aria-checked={redaction === level}
                className={styles.item}
                onClick={() => setRedaction(level)}
              >
                {t[REDACTION_LABELS[level]]}
              </button>
            ))}
          </div>
        </div>
      )}
      {redaction !== "off" && (
        <span role="status" className={styles.note}>
          {summary !== null && (
            <>
              {t.redacted} <span lang="en">{summary}</span>
            </>
          )}
        </span>
      )}
      {failed && (
        <span role="alert" className={styles.error}>
          {t.failed}
        </span>
      )}
    </div>
  );
}
