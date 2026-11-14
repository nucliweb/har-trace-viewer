// Size budget of the built app: the gzip size of its JavaScript and CSS, against the budgets in
// size-budgets.json (gzip bytes). Prints a table per build and exits with 1 when a total is over its budget.
// Run `npm run build` first, then: npm run size -w @htv/web
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The public site, split into chunks, and the app the CLI embeds in its reports, in one entry.
const BUILDS = {
  site: join(webDir, "dist-site/har-trace-viewer"),
  report: join(webDir, "dist"),
};

const WORKER = /\.worker-[^/]*\.js$/;
const isCss = (chunk) => chunk.file.endsWith(".css");

/** The chunks a module imports statically (`import … from`, `import "…"`, `export … from`). */
export function staticImports(code) {
  const pattern = /(?:\bimport|\bexport)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g;
  return [...code.matchAll(pattern)].map((match) => match[1]);
}

/** The assets index.html loads up front: its module scripts, module preloads and stylesheets. */
function htmlAssets(html) {
  const pattern = /<(?:script|link)\b[^>]*?\b(?:src|href)="[^"]*?assets\/([^"/]+\.(?:js|css))"/g;
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

const size = (raw, gzip) => ({ raw, gzip });

/**
 * Each JS and CSS file of the build in `dir`, as `initial` (loaded with the page: what index.html
 * references and what that imports statically), `lazy` (on demand) or `worker`, with its raw and
 * gzip sizes, and their totals.
 */
export function measureBuild(dir) {
  const indexPath = join(dir, "index.html");
  if (!existsSync(indexPath)) throw new Error(`${indexPath} not found. Run "npm run build" first.`);
  const assetsDir = join(dir, "assets");
  const read = (file) => readFileSync(join(assetsDir, file));

  const initial = new Set();
  const queue = htmlAssets(readFileSync(indexPath, "utf8"));
  while (queue.length > 0) {
    const file = queue.shift();
    if (initial.has(file)) continue;
    initial.add(file);
    if (file.endsWith(".js")) queue.push(...staticImports(read(file).toString("utf8")));
  }

  const chunks = readdirSync(assetsDir)
    .filter((file) => /\.(?:js|css)$/.test(file))
    .map((file) => {
      const content = read(file);
      const kind = WORKER.test(file) ? "worker" : initial.has(file) ? "initial" : "lazy";
      return { file, kind, raw: content.length, gzip: gzipSync(content, { level: 9 }).length };
    })
    // JavaScript first, each type by size.
    .sort((a, b) => Number(isCss(a)) - Number(isCss(b)) || b.gzip - a.gzip);

  const total = (keep) =>
    chunks
      .filter(keep)
      .reduce((sum, chunk) => size(sum.raw + chunk.raw, sum.gzip + chunk.gzip), size(0, 0));
  return {
    chunks,
    totals: {
      initialJs: total((chunk) => !isCss(chunk) && chunk.kind === "initial"),
      totalJs: total((chunk) => !isCss(chunk) && chunk.kind !== "worker"),
      worker: total((chunk) => chunk.kind === "worker"),
      css: total(isCss),
    },
  };
}

/** Each budget (gzip bytes) against the total it limits. */
export function checkBudgets(totals, budgets) {
  return Object.entries(budgets).map(([metric, budget]) => {
    if (!(metric in totals)) throw new Error(`No total named "${metric}" to hold to a budget`);
    const actual = totals[metric].gzip;
    return { metric, actual, budget, ok: actual <= budget };
  });
}

const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

function printBuild(name, { chunks, totals }, results) {
  const rows = [
    ["file", "load", "raw", "gzip"],
    ...chunks.map((chunk) => [chunk.file, chunk.kind, kB(chunk.raw), kB(chunk.gzip)]),
    ...Object.entries(totals).map(([metric, total]) => [
      `total ${metric}`,
      "",
      kB(total.raw),
      kB(total.gzip),
    ]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  console.log(`\n${name}`);
  for (const row of rows) {
    const cells = row.map((cell, column) =>
      column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])
    );
    console.log(cells.join("  "));
  }
  for (const { metric, actual, budget, ok } of results) {
    console.log(`${ok ? "ok  " : "OVER"} ${metric}: ${kB(actual)} gzip, budget ${kB(budget)}`);
  }
}

function main() {
  const budgets = JSON.parse(readFileSync(join(webDir, "scripts/size-budgets.json"), "utf8"));
  let failed = false;
  for (const [name, dir] of Object.entries(BUILDS)) {
    const measured = measureBuild(dir);
    const results = checkBudgets(measured.totals, budgets[name] ?? {});
    printBuild(name, measured, results);
    failed ||= results.some((result) => !result.ok);
  }
  if (failed) {
    console.error("\nA size budget is exceeded (scripts/size-budgets.json).");
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
