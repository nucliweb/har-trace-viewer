import {
  markdownReport,
  mermaidReport,
  pageAt,
  pluralCount,
  redactFlows,
  requestsCsv,
} from "@htv/core";
import type { Flow } from "@htv/core";
import { slugify } from "./export-diagram.js";

export type TextExport = "csv" | "markdown" | "mermaid";

/** The file extension and MIME type of each text export; the extensions are the CLI's. */
export const TEXT_EXPORTS: Record<TextExport, { extension: string; mime: string }> = {
  csv: { extension: "csv", mime: "text/csv" },
  markdown: { extension: "md", mime: "text/markdown" },
  mermaid: { extension: "mmd", mime: "text/plain" },
};

const BUILDERS: Record<TextExport, (flow: Flow, compare?: Flow) => string> = {
  csv: requestsCsv,
  markdown: markdownReport,
  mermaid: mermaidReport,
};

export function textExportFilename(flow: Flow, compare: Flow | undefined, kind: TextExport) {
  const names = [flow, compare]
    .filter((f) => f !== undefined)
    .map((f) => slugify(pageAt(f, 0).name));
  return `htv-${names.join("-vs-")}.${TEXT_EXPORTS[kind].extension}`;
}

/**
 * The text export as a file. Its secrets are masked as the files are read; with `maskHosts`
 * the third-party hostnames are masked too, and `summary` counts them. Both sides of a
 * comparison go through one masking, as the CLI's --mask-hosts does, so they share the hosts.
 */
export function textExport(
  kind: TextExport,
  flow: Flow,
  compare: Flow | undefined,
  maskHosts = false
): { blob: Blob; summary: string | null } {
  let flows = compare ? [flow, compare] : [flow];
  let summary: string | null = null;
  if (maskHosts) {
    const masked = redactFlows(flows, { hosts: "mask", secrets: false });
    flows = masked.flows;
    summary = pluralCount(masked.report.hosts, "host");
  }
  const [first = flow, second] = flows;
  const blob = new Blob([BUILDERS[kind](first, second)], {
    type: `${TEXT_EXPORTS[kind].mime};charset=utf-8`,
  });
  return { blob, summary };
}
