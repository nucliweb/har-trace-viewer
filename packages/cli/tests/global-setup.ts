import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = resolve(cliDir, "..");
const bundle = join(cliDir, "dist/index.js");

/** Modification time of the newest file at path, looking inside directories but not node_modules or dist. */
function newestMtime(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry === "dist") continue;
    newest = Math.max(newest, newestMtime(join(path, entry)));
  }
  return newest;
}

/** The CLI tests run the built bundle: build it when it is missing or older than its sources. */
export default function globalSetup() {
  const sources = [
    join(packages, "core/src"),
    join(packages, "web/src"),
    join(packages, "web/index.html"),
    join(cliDir, "src"),
    join(cliDir, "scripts"),
  ];
  const newest = Math.max(...sources.map(newestMtime));
  if (existsSync(bundle) && statSync(bundle).mtimeMs >= newest) return;
  execFileSync("npm", ["run", "build"], { cwd: cliDir, stdio: "inherit" });
}
