import { markdownReport, mermaidReport, requestsCsv } from "@htv/core";
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
  const names = [flow, compare].filter((f) => f !== undefined).map((f) => slugify(f.pages[0].name));
  return `htv-${names.join("-vs-")}.${TEXT_EXPORTS[kind].extension}`;
}

export function textExportBlob(kind: TextExport, flow: Flow, compare?: Flow): Blob {
  return new Blob([BUILDERS[kind](flow, compare)], {
    type: `${TEXT_EXPORTS[kind].mime};charset=utf-8`,
  });
}
