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
  writeHtmlReport,
} from "./cli";
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
    case "json": {
      const json = reportJson(report, __HTV_VERSION__);
      if (!target.path) {
        process.stdout.write(`${json}\n`);
        return;
      }
      const path = resolve(target.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${json}\n`);
      console.log(`Report generated: ${path}`);
      return;
    }
    case "html":
      console.log(`Report generated: ${writeHtmlReport(report, target)}`);
      return;
    case "tui":
      await runTui(report, __HTV_VERSION__);
      return;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
