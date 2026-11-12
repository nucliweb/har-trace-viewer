// The README npm shows is the repository's, so the two never drift apart: the build writes it from
// the repository README, without the sections for contributors (the packages of the monorepo,
// development, releasing), and with its links to files made absolute, as npmjs.com resolves a
// relative link against its own pages.
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "https://github.com/nucliweb/har-trace-viewer";
const RAW = "https://raw.githubusercontent.com/nucliweb/har-trace-viewer/main";
// The first section for contributors: it and every section after it stay on GitHub.
const CONTRIBUTORS = "\n## Packages\n";

/** The README for npm, from the repository's README text. */
export function npmReadme(rootReadme) {
  const end = rootReadme.indexOf(CONTRIBUTORS);
  if (end === -1) throw new Error(`README.md has no "${CONTRIBUTORS.trim()}" section to stop at`);
  const body = rootReadme
    .slice(0, end)
    .trimEnd()
    // An image is fetched from the raw file, any other file opens on GitHub.
    .replace(/(!?)\[([^\]]*)\]\((?!https?:|#)([^)]+)\)/g, (_, image, text, path) =>
      image ? `![${text}](${RAW}/${path})` : `[${text}](${REPO}/blob/main/${path})`
    );
  return `<!-- Written by scripts/readme.mjs from the repository's README.md: edit that one. -->\n\n${body}\n`;
}

/** Writes the npm README of the package at `cliDir` from the repository README in `rootDir`. */
export function writeNpmReadme(rootDir, cliDir) {
  writeFileSync(`${cliDir}/README.md`, npmReadme(readFileSync(`${rootDir}/README.md`, "utf8")));
}
