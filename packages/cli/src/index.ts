#!/usr/bin/env node
import { parseArgs, printUsage, validateArgs, generateReport } from "./cli";
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

  const error = validateArgs(args);
  if (error !== null) {
    if (error) console.error(error);
    printUsage();
    process.exit(1);
  }

  const indexPath = await generateReport(args);
  console.log(`Report generated: ${indexPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
