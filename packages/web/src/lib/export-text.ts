import {
  describeRedaction,
  markdownReport,
  mermaidReport,
  redactFlows,
  requestsCsv,
} from "@htv/core";
import type { Flow } from "@htv/core";
import type { RedactionLevel } from "../hooks/useRedaction.js";
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
  const names = [flow, compare].filter((f) => f !== undefined).map((f) => slugify(f.pages[0].name));
  return `htv-${names.join("-vs-")}.${TEXT_EXPORTS[kind].extension}`;
}

/**
 * The text export as a file, with the counts of what was redacted when `redaction` asks for it.
 * Both sides of a comparison go through one redaction, as the CLI's --redact does, so they share
 * placeholders and masked hosts.
 */
export function textExport(
  kind: TextExport,
  flow: Flow,
  compare: Flow | undefined,
  redaction: RedactionLevel = "off"
): { blob: Blob; summary: string | null } {
  let flows = compare ? [flow, compare] : [flow];
  let summary: string | null = null;
  if (redaction !== "off") {
    const redacted = redactFlows(flows, { hosts: redaction === "mask-hosts" ? "mask" : "keep" });
    flows = redacted.flows;
    summary = describeRedaction(redacted.report);
  }
  const blob = new Blob([BUILDERS[kind](flows[0], flows[1])], {
    type: `${TEXT_EXPORTS[kind].mime};charset=utf-8`,
  });
  return { blob, summary };
}
