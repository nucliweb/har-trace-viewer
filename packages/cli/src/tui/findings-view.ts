import { formatBytes, formatMs, shortUrl } from "@htv/core";
import type { Finding, FindingSeverity } from "@htv/core";
import { BLANK, panel, seg, table, wrap } from "./lines.js";
import type { Line } from "./lines.js";

// Evidence rows shown per finding until the evidence is expanded; the rest are counted.
const MAX_EVIDENCE = 3;

/** Whether a finding has evidence rows that show only once the evidence is expanded. */
export const hasHiddenEvidence = (findings: Finding[]) =>
  findings.some((f) => f.evidence.length > MAX_EVIDENCE);

const SEVERITY: Record<FindingSeverity, { title: string; icon: string; color: string }> = {
  critical: { title: "Critical", icon: "✕", color: "red" },
  warning: { title: "Warnings", icon: "!", color: "yellow" },
  info: { title: "Info", icon: "i", color: "cyan" },
  good: { title: "Good", icon: "✓", color: "green" },
};
const ORDER: FindingSeverity[] = ["critical", "warning", "info", "good"];
const VITALS = new Set(["ttfb", "fcp", "lcp", "cls", "inp"]);

/** "LCP · high confidence · metrics": what the finding affects, how sure it is, where it comes from. */
function meta(finding: Finding): string {
  const metric = VITALS.has(finding.metric) ? finding.metric.toUpperCase() : finding.metric;
  return [
    finding.metric === "none" ? null : metric,
    `${finding.confidence} confidence`,
    finding.source,
  ]
    .filter(Boolean)
    .join(" · ");
}

function evidenceRows(finding: Finding, expanded: boolean): Line[] {
  const shown = expanded ? finding.evidence : finding.evidence.slice(0, MAX_EVIDENCE);
  if (shown.length === 0) return [];
  const rows = table(
    ["  Evidence", "Size", "Time", "Detail"],
    shown.map((e) => [
      `  ${shortUrl(e.url)}`,
      e.bytes === undefined ? "" : formatBytes(e.bytes),
      e.ms === undefined ? "" : formatMs(e.ms),
      e.detail ?? "",
    ]),
    ["left", "right", "right", "left"]
  ).slice(1);
  const hidden = finding.evidence.length - shown.length;
  if (hidden > 0) rows.push([seg(`  … ${hidden} more (e shows all)`, { dim: true })]);
  return rows;
}

function findingRows(finding: Finding, width: number, expanded: boolean): Line[] {
  const { icon, color } = SEVERITY[finding.severity];
  const rows: Line[] = [
    [
      seg(`${icon} `, { color, bold: true }),
      seg(finding.title, { bold: true }),
      seg(`  ${meta(finding)}`, { dim: true }),
    ],
    ...wrap(finding.summary, width, "  "),
  ];
  if (finding.recommendation) {
    rows.push(
      ...wrap(`→ ${finding.recommendation}`, width, "  ").map((l) =>
        l.map((s) => ({ ...s, color: "cyan" }))
      )
    );
  }
  rows.push(...evidenceRows(finding, expanded));
  return rows;
}

/**
 * The findings of one page, one panel per severity (critical, warnings, info, good), each
 * finding with its metric, its summary, what to do and its first evidence rows, or all of
 * them when `expanded`.
 */
export function findingsRegion(findings: Finding[], width: number, expanded = false): Line[] {
  if (findings.length === 0) {
    return panel("Findings", [[seg("No findings for this page", { dim: true })]], width);
  }
  return ORDER.flatMap((severity) => {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) return [];
    const body = group.flatMap((finding, i) => [
      ...(i > 0 ? [BLANK] : []),
      ...findingRows(finding, width - 4, expanded),
    ]);
    return panel(`${SEVERITY[severity].title} · ${group.length}`, body, width);
  });
}
