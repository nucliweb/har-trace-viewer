import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { collectFontFaceCss, downloadBlob, svgBlob, svgToPngBlob } from "../lib/export-browser.js";
import {
  currentTheme,
  exportFilename,
  readBadges,
  serializeDiagramSvg,
} from "../lib/export-diagram.js";
import styles from "./ExportMenu.module.css";

interface Props {
  /** Element that contains the diagram `<svg>` and the badge row. */
  containerRef: RefObject<HTMLElement | null>;
  pageName: string;
  stepNumber: number;
  disabled?: boolean;
  /** Injectable for tests. */
  download?: (blob: Blob, filename: string) => void;
  collectFonts?: () => Promise<string>;
}

export function ExportMenu({
  containerRef,
  pageName,
  stepNumber,
  disabled = false,
  download = downloadBlob,
  collectFonts = collectFontFaceCss,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    const container = containerRef.current;
    const svg = container?.querySelector<SVGSVGElement>('[id="diagram-svg"]');
    setOpen(false);
    if (!container || !svg) return;
    setBusy(true);
    setError(null);
    try {
      const svgString = serializeDiagramSvg(svg, {
        theme: currentTheme(),
        fontCss: await collectFonts(),
        badges: readBadges(container),
      });
      const blob = extension === "svg" ? svgBlob(svgString) : await svgToPngBlob(svgString, 2);
      download(blob, exportFilename(pageName, stepNumber, extension));
    } catch {
      setError("Export failed");
    } finally {
      setBusy(false);
      buttonRef.current?.focus();
    }
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
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')
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
        onClick={() => setOpen((v) => !v)}
      >
        Export
      </button>
      {open && (
        // The menu container handles Escape and arrow keys on behalf of its menuitems.
        // eslint-disable-next-line jsx-a11y/interactive-supports-focus
        <div
          role="menu"
          aria-label="Export diagram"
          className={styles.menu}
          onKeyDown={onMenuKeyDown}
        >
          <button
            ref={firstItemRef}
            role="menuitem"
            className={styles.item}
            onClick={() => run("svg")}
          >
            Download SVG
          </button>
          <button role="menuitem" className={styles.item} onClick={() => run("png")}>
            Download PNG (2x)
          </button>
        </div>
      )}
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
