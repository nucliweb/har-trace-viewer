// Builds the CLI: the web app first, then the esbuild bundle, then the slice of the web build
// that a report needs. Site-only files (social images, icons, robots.txt) and the lazily loaded
// demo chunk stay out of dist/web, so they are in neither the npm tarball nor any report.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(cliDir, "../web");
const dist = join(cliDir, "dist");
const { version } = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
// NODE_ENV is "test" when the build runs from vitest, which would bundle React's development build
execFileSync("npm", ["run", "build"], {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});

await build({
  entryPoints: [join(cliDir, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  external: ["ink", "react"],
  define: { __HTV_VERSION__: JSON.stringify(version) },
  outfile: join(dist, "index.js"),
  logLevel: "info",
});

// Loaded only by the web app's "try the demo" button, never by a report.
const SITE_ONLY_CHUNK = /^demo-flow-.*\.js$/;
// Tags that point at files of the hosted site; they would not resolve under file://.
const SITE_ONLY_TAGS = [
  /\s*<meta\s+(?:property|name)="(?:og|twitter):image[^"]*"[^>]*>/g,
  /\s*<link\s+rel="apple-touch-icon"[^>]*>/g,
];

const webOut = join(dist, "web");
const webBuild = join(webDir, "dist");
mkdirSync(join(webOut, "assets"), { recursive: true });
for (const file of readdirSync(join(webBuild, "assets"))) {
  if (SITE_ONLY_CHUNK.test(file)) continue;
  cpSync(join(webBuild, "assets", file), join(webOut, "assets", file));
}
let html = readFileSync(join(webBuild, "index.html"), "utf8");
for (const tag of SITE_ONLY_TAGS) html = html.replace(tag, "");
writeFileSync(join(webOut, "index.html"), html);

// The schema of `--format findings`, which the document links to inside the published package.
cpSync(resolve(cliDir, "../core/schema/findings.schema.json"), join(dist, "findings.schema.json"));
