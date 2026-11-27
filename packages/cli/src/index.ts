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
import { runCompletionCommand } from "./completion";
import { splitCommand } from "./command";
import { debug, startDebug } from "./debug";
import { adoptMisnamedHars } from "./recording";
import { formatCheckResult } from "./check-format";
import {
  maskReportHosts,
  parseRedactArgs,
  REDACT_HELP,
  REDACT_USAGE,
  runRedactCommand,
} from "./redact";
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
  if (args.help) {
    console.log(REDACT_HELP);
    return;
  }
  await runRedactCommand(args);
}

async function main() {
  startDebug(process.argv.slice(2));
  const { command, rest } = splitCommand(process.argv.slice(2));
  if (command === "completion") return runCompletionCommand(rest);
  if (command === "redact") return redactCommand(rest);
  let args: Args;
  try {
    args = parseArgs(rest);
  } catch (err) {
    console.error((err as Error).message);
    debug.error(err);
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

  await adoptMisnamedHars(args.pages);
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
  debug.phase("analyze");
  let report = await buildReport(args);
  debug.log(`pages: ${report.flow.pages.length}${report.compare ? " (and a second side)" : ""}`);
  debug.phase(`render ${target.kind}`);
  if (args.maskHosts) {
    const masked = maskReportHosts(report);
    report = masked.report;
    console.error(masked.note);
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
      await runTui(report, __HTV_VERSION__, { mouse: !args.noMouse });
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
  debug.error(err);
  process.exit(1);
});
