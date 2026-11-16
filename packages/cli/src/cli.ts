// The public surface of the CLI: argument parsing, the help text, the output target, and the
// report built and written from them live in their own modules and are re-exported here.
export { parseArgs, validateArgs, checkOptions } from "./args";
export type { PageArg, RunsChoice, CompareArg, OutputFormat, TextFormat, Args } from "./args";
export { USAGE, HELP, printUsage } from "./help";
export { outputTarget } from "./output-target";
export type { OutputTarget } from "./output-target";
export { listPagesReport, buildReport } from "./report-build";
export type { Report } from "./report-build";
export {
  bundleHtml,
  reportJson,
  findingsSchemaUrl,
  reportFindings,
  reportText,
  writeHtmlReport,
} from "./report-write";
