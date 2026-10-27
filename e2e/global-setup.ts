import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "packages/cli/dist/index.js");
const fixtures = resolve(root, "packages/core/tests/fixtures");

export const OUTPUT = resolve(root, "e2e/.output");

function generate(dir: string, extraArgs: string[]) {
  execFileSync(
    process.execPath,
    [
      cli,
      "--page",
      "Home",
      "--har",
      resolve(fixtures, "webperf-snippets.har.fixture.json"),
      "--trace",
      resolve(fixtures, "webperf-snippets.trace.fixture.json"),
      "--output",
      dir,
      ...extraArgs,
    ],
    { stdio: "pipe" }
  );
}

export default function globalSetup() {
  if (!existsSync(cli)) {
    throw new Error(`${cli} not found. Run "npm run build" before "npm run e2e".`);
  }
  rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(OUTPUT, { recursive: true });
  generate(resolve(OUTPUT, "bundle"), ["--bundle"]);
  generate(resolve(OUTPUT, "plain"), []);
}
