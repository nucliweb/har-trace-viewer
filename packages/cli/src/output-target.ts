import type { Args, TextFormat } from "./args";
import { checkOptions } from "./args";
import { STDIN } from "./recording";

const TEXT_EXTENSIONS: Record<TextFormat, readonly string[]> = {
  markdown: [".md", ".markdown"],
  csv: [".csv"],
  mermaid: [".md", ".mmd", ".mermaid"],
};
const hasExtension = (path: string, extensions: readonly string[]) =>
  extensions.some((ext) => path.toLowerCase().endsWith(ext));

const isHtmlPath = (p: string) => p.toLowerCase().endsWith(".html");
const isJsonPath = (p: string) => p.toLowerCase().endsWith(".json");

export type OutputTarget =
  | { kind: "tui" }
  // A .html path is always a single self-contained file; a directory bundles with --bundle.
  | { kind: "html"; path: string; singleFile: boolean; bundle: boolean }
  // Without a path, the JSON goes to stdout.
  | { kind: "json"; path?: string }
  // The findings document; without a path, it goes to stdout.
  | { kind: "findings"; path?: string }
  // A Markdown report, the requests as CSV or Mermaid diagrams; without a path, to stdout.
  | { kind: TextFormat; path?: string }
  // No report: only the result of --budget and --fail-on, on stdout.
  | { kind: "check" };

/**
 * Where the report goes, from --output and --format: no --output shows it in the terminal,
 * or only prints the check result with --budget or --fail-on; a .json path or --format json
 * writes JSON, any other path writes HTML.
 */
export function outputTarget(args: Args, isInteractive: boolean): OutputTarget {
  const { output } = args;
  // A .md or .csv path asks for that format when --format is absent, as .json does.
  const format =
    args.format ??
    (hasExtension(output, TEXT_EXTENSIONS.markdown)
      ? "markdown"
      : hasExtension(output, TEXT_EXTENSIONS.csv)
        ? "csv"
        : undefined);
  const effective = format ?? (isJsonPath(output) ? "json" : output ? "html" : undefined);
  if (args.filter !== undefined && effective !== "csv" && effective !== "json") {
    const given = effective ?? (checkOptions(args) ? "a check result" : "tui");
    throw new Error(
      `--filter works with --format csv and json only (the requests it keeps); the output here is ${given}.`
    );
  }
  if (format === "tui" && output) {
    throw new Error("--format tui shows the report in the terminal: drop --output");
  }
  const checks = checkOptions(args) !== null;
  if (format === "tui" && checks) {
    throw new Error(
      "--budget and --fail-on print a check result instead of the terminal report: drop --format tui"
    );
  }
  if (format === "html" && (!output || isJsonPath(output))) {
    throw new Error("--format html needs -o <dir|file.html>");
  }
  if ((format === "json" || format === "findings") && output && !isJsonPath(output)) {
    throw new Error(
      `--format ${format} needs a .json --output path, or no --output to print to stdout`
    );
  }
  if (format === "markdown" || format === "csv" || format === "mermaid") {
    if (output && !hasExtension(output, TEXT_EXTENSIONS[format])) {
      throw new Error(
        `--format ${format} needs a ${TEXT_EXTENSIONS[format].join(" or ")} --output path, or no --output to print to stdout`
      );
    }
    return output ? { kind: format, path: output } : { kind: format };
  }
  if (format === "findings") {
    return output ? { kind: "findings", path: output } : { kind: "findings" };
  }
  if (format === "json" || isJsonPath(output))
    return output ? { kind: "json", path: output } : { kind: "json" };
  if (output) {
    const singleFile = isHtmlPath(output);
    return { kind: "html", path: output, singleFile, bundle: singleFile || args.bundle };
  }
  if (checks) return { kind: "check" };
  if (!isInteractive) {
    const piped = args.pages.some((p) => p.har === STDIN)
      ? " A HAR read from stdin cannot open it."
      : "";
    throw new Error(
      `The terminal report needs an interactive terminal: pass -o report.html, -o report.json or --format json.${piped}`
    );
  }
  return { kind: "tui" };
}
