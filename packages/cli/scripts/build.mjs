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

// Ink imports its React DevTools bridge only when DEV=true and the optional `react-devtools-core`
// resolves, which the package does not ship. Bundled as is, the bridge would pull in a window
// polyfill and an import that cannot be bundled; this empty stand-in keeps both out, so the
// report runs without DevTools, as it does when the package is missing.
const inkDevtoolsStub = {
  name: "ink-devtools-stub",
  setup(build) {
    build.onResolve({ filter: /^\.\/devtools\.js$/ }, (args) =>
      /[\\/]node_modules[\\/]ink[\\/]/.test(args.importer)
        ? { path: "ink-devtools", namespace: "ink-devtools-stub" }
        : undefined
    );
    build.onLoad({ filter: /.*/, namespace: "ink-devtools-stub" }, () => ({
      contents: "",
      loader: "js",
    }));
  },
};

// Ink and React are bundled, so the published package installs with no dependencies.
const { metafile } = await build({
  entryPoints: [join(cliDir, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  define: {
    __HTV_VERSION__: JSON.stringify(version),
    // Selects the production builds of React and its reconciler
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [inkDevtoolsStub],
  // Some of Ink's CommonJS dependencies (signal-exit, stack-utils) require() Node builtins, and
  // an ES module has no require of its own
  banner: {
    js: 'import { createRequire as __htvCreateRequire } from "node:module";\nconst require = __htvCreateRequire(import.meta.url);',
  },
  legalComments: "eof",
  metafile: true,
  outfile: join(dist, "index.js"),
  logLevel: "info",
});

// The license of every bundled package, which their terms ask to ship along with the code.
const licenses = new Map();
for (const input of Object.keys(metafile.inputs)) {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (!match) continue;
  const pkgDir = resolve(cliDir, match[1]);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const id = `${pkg.name}@${pkg.version}`;
  if (licenses.has(id)) continue;
  const licenseFile = readdirSync(pkgDir).find((file) => /^(?:licen[cs]e|copying)/i.test(file));
  const text = licenseFile ? readFileSync(join(pkgDir, licenseFile), "utf8").trim() : pkg.license;
  licenses.set(id, `${id} (${pkg.license})\n\n${text}`);
}
writeFileSync(
  join(dist, "THIRD-PARTY-LICENSES.txt"),
  [...licenses.values()].sort().join(`\n\n${"-".repeat(80)}\n\n`) + "\n"
);

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
