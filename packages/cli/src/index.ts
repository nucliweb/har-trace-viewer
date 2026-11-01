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
  writeHtmlReport,
  checkOptions,
} from "./cli";
import { formatChecks, runChecks } from "./budget";
import { runTui } from "./tui/run.js";
import type { Args } from "./cli";

async function main() {
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

  const target = outputTarget(args, process.stdout.isTTY === true);
  const report = await buildReport(args);
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
    case "html":
      console.log(`Report generated: ${writeHtmlReport(report, target)}`);
      break;
    case "tui":
      await runTui(report, __HTV_VERSION__);
      return;
    case "check":
      break;
  }

  const options = checkOptions(args);
  if (!options) return;
  const result = runChecks(report, options);
  // Without a report the check result is the output; otherwise stdout keeps the report alone.
  (target.kind === "check" ? console.log : console.error)(formatChecks(result));
  if (!result.passed) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
