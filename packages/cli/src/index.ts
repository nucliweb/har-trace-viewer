#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  parseArgs,
  printUsage,
  HELP,
  validateArgs,
  listPagesReport,
  outputTarget,
  buildReport,
  reportJson,
  reportFindings,
  reportText,
  writeHtmlReport,
  checkOptions,
} from "./cli";
import { runChecks } from "./budget";
import { formatCheckResult } from "./check-format";
import { parseRedactArgs, redactReport, REDACT_USAGE, runRedactCommand } from "./redact";
import type { RedactArgs } from "./redact";
import type { Args } from "./cli";

async function redactCommand(argv: string[]) {
  let args: RedactArgs;
  try {
    args = parseRedactArgs(argv);
  } catch (err) {
    console.error((err as Error).message);
    console.error(REDACT_USAGE);
    process.exit(1);
  }
  await runRedactCommand(args);
}

async function main() {
  if (process.argv[2] === "redact") return redactCommand(process.argv.slice(3));
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    printUsage();
    process.exit(1);
  }

  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(__HTV_VERSION__);
    return;
  }

  const error = validateArgs(args);
  if (error !== null) {
    if (error) console.error(error);
    printUsage();
    process.exit(1);
  }

  if (args.listPages) {
    console.log(await listPagesReport(args));
    return;
  }

  const target = outputTarget(args, process.stdout.isTTY === true && process.stdin.isTTY === true);
  let report = await buildReport(args);
  if (args.redact) {
    const redacted = redactReport(report, args.redact);
    report = redacted.report;
    console.error(redacted.note);
  }
  switch (target.kind) {
    case "json":
    case "findings": {
      const findings = target.kind === "findings";
      const json = findings
        ? reportFindings(report, __HTV_VERSION__)
        : reportJson(report, __HTV_VERSION__);
      if (!target.path) {
        process.stdout.write(`${json}\n`);
        break;
      }
      const path = resolve(target.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${json}\n`);
      console.log(`${findings ? "Findings written" : "Report generated"}: ${path}`);
      break;
    }
    case "markdown":
    case "csv":
    case "mermaid": {
      const text = reportText(target.kind, report);
      if (!target.path) {
        process.stdout.write(text);
        break;
      }
      const path = resolve(target.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      console.log(`Report generated: ${path}`);
      break;
    }
    case "html":
      console.log(`Report generated: ${writeHtmlReport(report, target)}`);
      break;
    case "tui": {
      // Loaded here alone: Ink and React cost startup time the other formats should not pay
      const { runTui } = await import("./tui/run.js");
      await runTui(report, __HTV_VERSION__);
      return;
    }
    case "check":
      break;
  }

  const options = checkOptions(args);
  if (!options) return;
  const result = runChecks(report, options);
  // Without a report the check result is the output; otherwise stdout keeps the report alone.
  const print = target.kind === "check" ? console.log : console.error;
  if (args.checkOutput) {
    const path = resolve(args.checkOutput);
    // Printed first: a file that cannot be written must not hide the result itself.
    print(formatCheckResult(result, "text"));
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${formatCheckResult(result, args.checkFormat ?? "text")}\n`);
    } catch (err) {
      throw new Error(`Could not write the check result to ${path}: ${(err as Error).message}`, {
        cause: err,
      });
    }
  } else {
    print(formatCheckResult(result, args.checkFormat ?? "text"));
  }
  if (!result.passed) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
