import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { describeRedaction, redactFlows, redactHar } from "@htv/core";
import type { RedactOptions } from "@htv/core";
import { readTextFile } from "@htv/core/node";
import type { Report } from "./cli";

/** `htv redact <in.har[.gz]> [-o <out.har[.gz]>] [--mask-hosts]`. */
export interface RedactArgs {
  input: string;
  output: string; // "" without --output: the HAR goes to stdout
  hosts: NonNullable<RedactOptions["hosts"]>;
}

export const REDACT_USAGE = "Usage: htv redact <file.har[.gz]> [-o <out.har[.gz]>] [--mask-hosts]";

export function parseRedactArgs(argv: string[]): RedactArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: {
      output: { type: "string", short: "o" },
      "mask-hosts": { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length !== 1) throw new Error("htv redact needs one HAR file");
  const [input] = positionals;
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
  const raw: unknown = JSON.parse(await readTextFile(resolve(args.input)));
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

/** The report with its flows redacted, and the one-line note that says what changed. */
export function redactReport(
  { flow, compare }: Report,
  options: RedactOptions
): { report: Report; note: string } {
  const { flows, report } = redactFlows(compare ? [flow, compare] : [flow], options);
  return {
    report: flows.length === 2 ? { flow: flows[0], compare: flows[1] } : { flow: flows[0] },
    note: `Redacted the report: ${describeRedaction(report)}`,
  };
}
