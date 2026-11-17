import type { CSSProperties, ReactNode, Ref } from "react";
import styles from "./Drawer.module.css";

interface DrawerProps {
  title: string;
  /** Under the title, on one line: what the drawer is about (the page, the side of a comparison). */
  subtitle?: string;
  /** Beside the title, in monospace: a count. */
  note?: string;
  /** The accessible name of the ✕ button; the button shows when `onClose` is given. */
  closeLabel?: string;
  onClose?: () => void;
  /** The edge the drawer docks to. */
  side?: "right" | "left";
  /** Any CSS length; the drawer never grows past its container. */
  width: string;
  /** On a phone, takes the screen below the toolbar (see `--toolbar-bottom`) instead of the pane. */
  coversPhone?: boolean;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  /** What goes between the header and the body (a summary, a filter bar), then a `DrawerBody`. */
  children: ReactNode;
}

/** The shell every drawer shares: a docked column with a header, and its content below. */
export function Drawer({
  title,
  subtitle,
  note,
  closeLabel,
  onClose,
  side = "right",
  width,
  coversPhone = false,
  className,
  ref,
  children,
}: DrawerProps) {
  const classes = [
    styles.drawer,
    side === "left" ? styles.left : styles.right,
    coversPhone ? styles.coversPhone : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={classes} style={{ "--drawer-width": width } as CSSProperties}>
      <div className={styles.header}>
        <h2 className={styles.heading}>
          <span className={styles.title}>{title}</span>
          {subtitle && (
            <>
              {" "}
              <span className={styles.subtitle}>{subtitle}</span>
            </>
          )}
        </h2>
        {note && <span className={styles.note}>{note}</span>}
        {onClose && (
          <button className={styles.closeBtn} onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

interface DrawerBodyProps {
  /** The region's accessible name. */
  label: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/** The scrolling part of a drawer: a region the keyboard reaches (WCAG 2.1.1, axe scrollable-region-focusable). */
export function DrawerBody({ label, className, ref, children }: DrawerBodyProps) {
  return (
    <div
      ref={ref}
      className={className ? `${styles.body} ${className}` : styles.body}
      role="region"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      {children}
    </div>
  );
}
