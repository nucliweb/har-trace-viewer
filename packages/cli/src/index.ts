#!/usr/bin/env node
import { parseArgs, printUsage, HELP, validateArgs, generateReport, listPagesReport } from "./cli";
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

  const indexPath = await generateReport(args);
  console.log(`Report generated: ${indexPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
