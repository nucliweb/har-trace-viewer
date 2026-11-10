import { useId } from "react";
import { fileName, formatBytes, formatMs } from "@htv/core";
import type { Finding, FindingEvidence, FindingSeverity } from "@htv/core";
import { useCoreLang, useMessages } from "../i18n/context.js";
import type { Messages } from "../i18n/en.js";
import styles from "./FindingsPanel.module.css";

interface Props {
  findings: Finding[];
  pageLabel: string;
  onClose: () => void;
}

// Evidence rows shown per finding; the rest wait behind their count.
const MAX_EVIDENCE = 3;

const SEVERITY_ICON: Record<FindingSeverity, string> = {
  critical: "✕",
  warning: "⚠",
  info: "ℹ",
  good: "✓",
};
const ORDER: FindingSeverity[] = ["critical", "warning", "info", "good"];
const VITALS = new Set(["ttfb", "fcp", "lcp", "cls", "inp"]);

/** "LCP · high confidence · metrics": what the finding affects, how sure it is, where it comes from. */
function findingMeta(finding: Finding, t: Messages["findings"]): string {
  const metric = VITALS.has(finding.metric) ? finding.metric.toUpperCase() : finding.metric;
  return [
    finding.metric === "none" ? null : metric,
    t.confidence[finding.confidence],
    finding.source,
  ]
    .filter(Boolean)
    .join(" · ");
}

function EvidenceRow({ evidence }: { evidence: FindingEvidence }) {
  const lang = useCoreLang();
  const numbers = [
    evidence.bytes === undefined ? null : formatBytes(evidence.bytes),
    evidence.ms === undefined ? null : formatMs(evidence.ms),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={styles.evidence}>
      <span className={styles.evidenceName} title={evidence.url}>
        {fileName(evidence.url)}
      </span>
      <span className={styles.evidenceNumbers}>{numbers}</span>
      {evidence.detail && (
        <span className={styles.evidenceDetail} lang={lang}>
          {evidence.detail}
        </span>
      )}
    </li>
  );
}

function Evidence({ evidence }: { evidence: FindingEvidence[] }) {
  const t = useMessages().findings;
  if (evidence.length === 0) return null;
  const shown = evidence.slice(0, MAX_EVIDENCE);
  const rest = evidence.slice(MAX_EVIDENCE);
  return (
    <div className={styles.evidenceBlock}>
      <ul className={styles.evidenceList}>
        {shown.map((e, i) => (
          <EvidenceRow key={i} evidence={e} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className={styles.more}>
          <summary className={styles.moreSummary}>{t.more(rest.length)}</summary>
          <ul className={styles.evidenceList}>
            {rest.map((e, i) => (
              <EvidenceRow key={i} evidence={e} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FindingItem({ finding }: { finding: Finding }) {
  const t = useMessages().findings;
  const lang = useCoreLang();
  return (
    <li className={`${styles.finding} ${styles[`finding_${finding.severity}`]}`}>
      <span className={`${styles.icon} ${styles[`icon_${finding.severity}`]}`} aria-hidden="true">
        {SEVERITY_ICON[finding.severity]}
      </span>
      <div className={styles.content}>
        <div className={styles.title} lang={lang}>
          {finding.title}
        </div>
        <div className={styles.meta}>{findingMeta(finding, t)}</div>
        <p className={styles.summary} lang={lang}>
          {finding.summary}
        </p>
        {finding.recommendation && (
          <p className={styles.fix} lang={lang}>
            {finding.recommendation}
          </p>
        )}
        <Evidence evidence={finding.evidence} />
      </div>
    </li>
  );
}

function SeverityGroup({ severity, findings }: { severity: FindingSeverity; findings: Finding[] }) {
  const t = useMessages().findings;
  const titleId = useId();
  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <h3 className={styles.sectionTitle} id={titleId}>
        {t.severity[severity]}
        <span className={styles.sectionCount}>{findings.length}</span>
      </h3>
      <ul className={styles.list}>
        {findings.map((finding, i) => (
          <FindingItem key={`${finding.id}-${i}`} finding={finding} />
        ))}
      </ul>
    </section>
  );
}

/** The findings of a page: worst first, each with its metric, what to do and its evidence. */
export function FindingsPanel({ findings, pageLabel, onClose }: Props) {
  const t = useMessages().findings;
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.headerTitle}>{t.title}</span>
          <h2 className={styles.pageLabel}>{pageLabel}</h2>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label={t.close}>
          ✕
        </button>
      </div>
      {/* Scrollable region must be keyboard focusable (WCAG 2.1.1, axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label={t.details} tabIndex={0}>
        {findings.length === 0 ? (
          <p className={styles.empty}>{t.empty}</p>
        ) : (
          ORDER.map((severity) => {
            const group = findings.filter((f) => f.severity === severity);
            return group.length > 0 ? (
              <SeverityGroup key={severity} severity={severity} findings={group} />
            ) : null;
          })
        )}
      </div>
    </div>
  );
}

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
