#!/usr/bin/env node
// Cuts a release in two explicit steps, with a review in between:
//   node scripts/release.mjs prepare <patch|minor|major|x.y.z>
//   node scripts/release.mjs tag
// `prepare` edits the version of packages/cli/package.json, the packages/cli entry of
// package-lock.json and CHANGELOG.md; it commits nothing. `tag` commits exactly those three files
// and creates the annotated tag; it never pushes. `npm version` is not used because the local npm
// rewrites unrelated lockfile entries.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["packages/cli/package.json", "package-lock.json", "CHANGELOG.md"];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const UNRELEASED_HEADING = "## [Unreleased]";

const parse = (version) => version.match(SEMVER)?.slice(1).map(Number);

/** The version a release gets: a bump of the current one, or an explicit greater version. */
export function nextVersion(current, request) {
  const [major, minor, patch] = parse(current);
  if (request === "patch") return `${major}.${minor}.${patch + 1}`;
  if (request === "minor") return `${major}.${minor + 1}.0`;
  if (request === "major") return `${major + 1}.0.0`;
  const wanted = parse(request);
  if (!wanted) throw new Error(`Expected patch, minor, major or x.y.z, got "${request}"`);
  const now = [major, minor, patch];
  const differing = wanted.findIndex((part, i) => part !== now[i]);
  if (differing === -1 || wanted[differing] < now[differing]) {
    throw new Error(`Version ${request} must be greater than ${current}`);
  }
  return request;
}

/** Sets the top-level "version" of a package.json, leaving every other byte as it is. */
export function patchPackageJson(text, version) {
  if (!/^ {2}"version": "[^"]*"/m.test(text)) {
    throw new Error('No top-level "version" found in packages/cli/package.json');
  }
  return text.replace(/^( {2}"version": ")[^"]*(")/m, `$1${version}$2`);
}

/** Sets the version of the "packages/cli" entry of package-lock.json, and nothing else. */
export function patchLockfile(text, version) {
  const lines = text.split("\n");
  const start = lines.indexOf('    "packages/cli": {');
  if (start === -1) throw new Error('No "packages/cli" entry found in package-lock.json');
  for (let i = start + 1; i < lines.length && lines[i] !== "    },"; i++) {
    if (/^ {6}"version": "/.test(lines[i])) {
      lines[i] = `      "version": "${version}",`;
      return lines.join("\n");
    }
  }
  throw new Error('No version found in the "packages/cli" entry of package-lock.json');
}

const isLinkLine = (line) => /^\[[^\]]+\]: /.test(line);
const isSectionEnd = (line) => line.startsWith("## [") || isLinkLine(line);

/** The notes under `## [Unreleased]`, trimmed; empty when there is nothing to release. */
function unreleasedNotes(text) {
  const lines = text.split("\n");
  const start = lines.indexOf(UNRELEASED_HEADING);
  if (start === -1) return "";
  const end = lines.findIndex((line, i) => i > start && isSectionEnd(line));
  return lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .join("\n")
    .trim();
}

/** Turns Unreleased into the version, leaves an empty Unreleased above it, updates the links. */
export function patchChangelog(text, { version, date, repoUrl }) {
  if (!unreleasedNotes(text)) {
    throw new Error("The Unreleased section of CHANGELOG.md is empty or missing");
  }
  const lines = text.split("\n");
  const start = lines.indexOf(UNRELEASED_HEADING);
  lines.splice(start, 1, UNRELEASED_HEADING, "", `## [${version}] - ${date}`);

  const unreleasedLink = lines.findIndex((line) => line.startsWith("[Unreleased]: "));
  const previous =
    lines[unreleasedLink]?.match(/\/compare\/v(\d+\.\d+\.\d+)\.\.\.HEAD$/)?.[1] ??
    lines.find((line, i) => i > start + 2 && /^## \[\d/.test(line))?.match(/^## \[([^\]]+)\]/)?.[1];
  const unreleased = `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`;
  const released = previous
    ? `[${version}]: ${repoUrl}/compare/v${previous}...v${version}`
    : `[${version}]: ${repoUrl}/releases/tag/v${version}`;

  if (unreleasedLink !== -1) {
    lines.splice(unreleasedLink, 1, unreleased, released);
  } else {
    const firstLink = lines.findIndex(isLinkLine);
    if (firstLink === -1) {
      while (lines.at(-1) === "") lines.pop();
      lines.push("", unreleased, released, "");
    } else {
      lines.splice(firstLink, 0, unreleased, released);
    }
  }
  return lines.join("\n");
}

function git(root, ...args) {
  // Only the end is trimmed: the first column of `git status --porcelain` can be a space
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
}

function repositoryRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

// RELEASE_ALLOW_BRANCH lets the tests, and a dry run in a worktree, skip the main-branch check
function assertOnMain(root) {
  const branch = git(root, "branch", "--show-current");
  if (branch !== "main" && !process.env.RELEASE_ALLOW_BRANCH) {
    throw new Error(`Releases are cut from main, not from "${branch}"`);
  }
}

function currentVersion(root) {
  return JSON.parse(readFileSync(join(root, FILES[0]), "utf8")).version;
}

function repositoryUrl(root, changelog) {
  const fromLink = changelog.match(/^\[[^\]]+\]: (https:\/\/github\.com\/[^/]+\/[^/]+)\//m)?.[1];
  if (fromLink) return fromLink;
  const remote = git(root, "remote", "get-url", "origin");
  return remote.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
}

function prepare(root, request) {
  if (!request) {
    throw new Error("Usage: node scripts/release.mjs prepare <patch|minor|major|x.y.z>");
  }
  if (git(root, "status", "--porcelain")) {
    throw new Error("The working tree is not clean; commit or stash the changes first");
  }
  assertOnMain(root);

  const read = (file) => readFileSync(join(root, file), "utf8");
  const version = nextVersion(currentVersion(root), request);
  const date = new Date().toLocaleDateString("en-CA"); // the maintainer's local day, as YYYY-MM-DD
  const changelog = read("CHANGELOG.md");
  if (!unreleasedNotes(changelog)) {
    throw new Error("The Unreleased section of CHANGELOG.md is empty or missing");
  }
  // Everything is computed before any write, so a refusal leaves the tree untouched
  const patched = {
    "packages/cli/package.json": patchPackageJson(read("packages/cli/package.json"), version),
    "package-lock.json": patchLockfile(read("package-lock.json"), version),
    "CHANGELOG.md": patchChangelog(changelog, {
      version,
      date,
      repoUrl: repositoryUrl(root, changelog),
    }),
  };
  for (const [file, text] of Object.entries(patched)) writeFileSync(join(root, file), text);

  console.log("Validating the lockfile with npm ci --dry-run");
  execFileSync("npm", ["ci", "--dry-run"], { cwd: root, stdio: "inherit" });

  console.log(`\nPrepared v${version}:\n`);
  console.log(git(root, "diff", "--stat"));
  console.log("\nReview with: git diff\nThen run: node scripts/release.mjs tag");
}

function tag(root) {
  assertOnMain(root);
  const version = currentVersion(root);
  const name = `v${version}`;
  const changed = git(root, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  const unexpected = changed.filter((file) => !FILES.includes(file));
  if (unexpected.length > 0) {
    throw new Error(`Files other than the release files changed: ${unexpected.join(", ")}`);
  }
  const unchanged = FILES.filter((file) => !changed.includes(file));
  if (unchanged.length > 0) {
    throw new Error(`Run prepare first; unchanged: ${unchanged.join(", ")}`);
  }
  const heading = `## [${version}] - `;
  if (!readFileSync(join(root, "CHANGELOG.md"), "utf8").includes(`\n${heading}`)) {
    throw new Error(`CHANGELOG.md has no section for ${version}`);
  }
  if (git(root, "tag", "--list", name)) throw new Error(`The tag ${name} already exists`);

  git(root, "add", "--", ...FILES);
  git(root, "commit", "-m", `Release ${name}`);
  git(root, "tag", "-a", name, "-m", name);
  console.log(`Committed and tagged ${name}. Nothing was pushed.`);
  console.log("Push with: git push --follow-tags");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, request] = process.argv.slice(2);
  try {
    const root = repositoryRoot();
    if (command === "prepare") prepare(root, request);
    else if (command === "tag") tag(root);
    else throw new Error("Usage: node scripts/release.mjs <prepare <patch|minor|major|x.y.z>|tag>");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
