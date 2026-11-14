import type { Finding } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import styles from "./FindingsPanel.module.css";

/**
 * The toolbar button that opens the findings, with the number of critical and warning findings
 * coloured by the worst of them.
 */
export function FindingsButton({
  findings,
  active,
  drawer,
  onClick,
  className,
  activeClassName,
}: {
  findings: Finding[];
  active: boolean;
  /** Marks the button as the toggle of this drawer, which hands the focus back to it on close. */
  drawer?: string;
  onClick: () => void;
  className: string;
  activeClassName: string;
}) {
  const t = useMessages().findings;
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const urgent = critical + warning;
  const counts = [
    critical > 0 ? t.critical(critical) : null,
    warning > 0 ? t.warnings(warning) : null,
  ].filter((count) => count !== null);
  // The name carries the count the button shows (WCAG 2.5.3, label in name); the title says
  // what it counts.
  return (
    <button
      className={`${className} ${active ? activeClassName : ""}`}
      onClick={onClick}
      data-drawer={drawer}
      aria-label={t.toggle(urgent)}
      aria-expanded={active}
      title={t.counts(counts)}
    >
      {t.title}
      {urgent > 0 && (
        <>
          {" "}
          <span
            className={`${styles.count} ${critical > 0 ? styles.count_critical : styles.count_warning}`}
          >
            {urgent}
          </span>
        </>
      )}
    </button>
  );
}
