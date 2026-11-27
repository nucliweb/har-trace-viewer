import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { describeRedaction, pluralCount, redactFlows, redactHar } from "@htv/core";
import type { RedactOptions } from "@htv/core";
import type { Report } from "./cli";
import { readHarJson } from "./recording";
import { withOptionHints } from "./unknown-option";

/** `htv redact <in.har[.gz]> [-o <out.har[.gz]>] [--mask-hosts]`. */
export interface RedactArgs {
  input: string;
  output: string; // "" without --output: the HAR goes to stdout
  hosts: NonNullable<RedactOptions["hosts"]>;
  /** --help was given: print REDACT_HELP and stop. */
  help?: boolean;
}

export const REDACT_USAGE = "Usage: htv redact <file.har[.gz]> [-o <out.har[.gz]>] [--mask-hosts]";

export const REDACT_HELP = `${REDACT_USAGE}

Writes a redacted copy of the HAR itself, still a valid HAR: bodies dropped (sizes kept), cookie
values masked, credential headers (Authorization, *token*, *session*...) replaced, and the secret
rules of every report on URLs, headers and titles. Prints the HAR to stdout without -o; an output
ending in .gz is gzipped.

Options:
  -o, --output <path>  Write the redacted HAR to this file
  --mask-hosts         Also mask third-party hostnames (host-N.redacted)
  -h, --help           Show this help`;

const REDACT_OPTIONS = {
  output: { type: "string", short: "o" },
  "mask-hosts": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

export function parseRedactArgs(argv: string[]): RedactArgs {
  const { values, positionals } = withOptionHints(
    () =>
      nodeParseArgs({ args: argv, options: REDACT_OPTIONS, allowPositionals: true, strict: true }),
    Object.keys(REDACT_OPTIONS),
    "htv redact"
  );
  if (values.help) return { input: "", output: "", hosts: "keep", help: true };
  const [input] = positionals;
  if (positionals.length !== 1 || input === undefined)
    throw new Error("htv redact needs one HAR file");
  const output = values.output ?? "";
  if (output && resolve(output) === resolve(input)) {
    throw new Error(`The redacted HAR would overwrite ${input}: pick another --output`);
  }
  return { input, output, hosts: values["mask-hosts"] ? "mask" : "keep" };
}

/**
 * Writes a redacted copy of the HAR: to --output (gzipped for a .gz path) with the counts on
 * stdout, or to stdout with the counts on stderr.
 */
export async function runRedactCommand(args: RedactArgs): Promise<void> {
  const raw = await readHarJson(args.input);
  const { har, report } = redactHar(raw, { hosts: args.hosts });
  const json = `${JSON.stringify(har, null, 2)}\n`;
  const counts = `Redacted: ${describeRedaction(report)}`;
  if (!args.output) {
    process.stdout.write(json);
    console.error(counts);
    return;
  }
  const path = resolve(args.output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, path.toLowerCase().endsWith(".gz") ? gzipSync(json) : json);
  console.log(`Redacted HAR written: ${path}`);
  console.log(counts);
}

/**
 * The report with the hostnames of third parties masked, and the one-line note that says how many.
 * Its secrets are masked as the files are read, so only the hosts are left to do.
 */
export function maskReportHosts({ flow, compare }: Report): { report: Report; note: string } {
  const { flows, report } = redactFlows(compare ? [flow, compare] : [flow], {
    hosts: "mask",
    secrets: false,
  });
  const [masked, maskedCompare] = flows;
  if (!masked) throw new Error("Masking the hosts returned no flow");
  return {
    report: maskedCompare ? { flow: masked, compare: maskedCompare } : { flow: masked },
    note: `Masked ${pluralCount(report.hosts, "third-party host")} in the report.`,
  };
}
