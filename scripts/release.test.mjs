import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { nextVersion, patchChangelog, patchLockfile, patchPackageJson } from "./release.mjs";

const REPO = "https://github.com/acme/widget";

test("nextVersion bumps patch, minor and major", () => {
  assert.equal(nextVersion("0.27.0", "patch"), "0.27.1");
  assert.equal(nextVersion("0.27.3", "minor"), "0.28.0");
  assert.equal(nextVersion("0.27.3", "major"), "1.0.0");
});

test("nextVersion accepts an explicit greater version", () => {
  assert.equal(nextVersion("0.27.0", "0.30.0"), "0.30.0");
  assert.equal(nextVersion("0.27.0", "1.0.0"), "1.0.0");
});

test("nextVersion refuses an explicit version that is not greater, or is malformed", () => {
  assert.throws(() => nextVersion("0.27.0", "0.27.0"), /greater/);
  assert.throws(() => nextVersion("0.27.0", "0.26.9"), /greater/);
  assert.throws(() => nextVersion("0.27.0", "v1.0.0"), /patch, minor, major/);
  assert.throws(() => nextVersion("0.27.0", "banana"), /patch, minor, major/);
});

const changelog = `# Changelog

## [Unreleased]

### Added

- A thing.

## [0.27.0] - 2026-11-18

### Fixed

- Another thing.

[Unreleased]: ${REPO}/compare/v0.27.0...HEAD
[0.27.0]: ${REPO}/compare/v0.26.0...v0.27.0
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`;

test("patchChangelog moves Unreleased to the version and updates the links", () => {
  const out = patchChangelog(changelog, { version: "0.28.0", date: "2026-12-01", repoUrl: REPO });
  assert.equal(
    out,
    `# Changelog

## [Unreleased]

## [0.28.0] - 2026-12-01

### Added

- A thing.

## [0.27.0] - 2026-11-18

### Fixed

- Another thing.

[Unreleased]: ${REPO}/compare/v0.28.0...HEAD
[0.28.0]: ${REPO}/compare/v0.27.0...v0.28.0
[0.27.0]: ${REPO}/compare/v0.26.0...v0.27.0
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`
  );
});

test("patchChangelog refuses an empty Unreleased section", () => {
  const empty = changelog.replace("### Added\n\n- A thing.\n\n", "");
  assert.throws(
    () => patchChangelog(empty, { version: "0.28.0", date: "2026-12-01", repoUrl: REPO }),
    /Unreleased/
  );
});

test("patchChangelog refuses a changelog without an Unreleased section", () => {
  assert.throws(
    () => patchChangelog("# Changelog\n", { version: "1.0.0", date: "2026-12-01", repoUrl: REPO }),
    /Unreleased/
  );
});

test("patchChangelog on the first release links to the tag and adds the Unreleased link", () => {
  const first = `# Changelog

## [Unreleased]

### Added

- Everything.
`;
  const out = patchChangelog(first, { version: "0.1.0", date: "2026-12-01", repoUrl: REPO });
  assert.equal(
    out,
    `# Changelog

## [Unreleased]

## [0.1.0] - 2026-12-01

### Added

- Everything.

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`
  );
});

test("patchChangelog without an Unreleased link falls back to the previous heading", () => {
  const noLinks = `## [Unreleased]\n\n- x\n\n## [0.2.0] - 2026-01-01\n\n- y\n\n[0.2.0]: ${REPO}/releases/tag/v0.2.0\n`;
  const out = patchChangelog(noLinks, { version: "0.3.0", date: "2026-12-01", repoUrl: REPO });
  assert.match(out, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v0.3.0...HEAD\\n`));
  assert.match(out, new RegExp(`\\[0.3.0\\]: ${REPO}/compare/v0.2.0...v0.3.0\\n`));
});

test("patchPackageJson changes only the top-level version line", () => {
  const text = `{\n  "name": "x",\n  "version": "0.27.0",\n  "dependencies": {\n    "a": { "version": "0.27.0" }\n  }\n}\n`;
  const out = patchPackageJson(text, "0.28.0");
  assert.equal(out, text.replace('"version": "0.27.0",', '"version": "0.28.0",'));
});

const lockfile = `{
  "name": "root",
  "version": "0.27.0",
  "packages": {
    "": {
      "name": "root",
      "version": "0.27.0"
    },
    "packages/core": {
      "name": "@htv/core",
      "version": "0.27.0"
    },
    "packages/cli": {
      "name": "har-trace-viewer",
      "version": "0.27.0",
      "license": "MIT"
    },
    "packages/web": {
      "name": "@htv/web",
      "version": "0.27.0"
    }
  }
}
`;

test("patchLockfile changes only the packages/cli entry even when others share the version", () => {
  const out = patchLockfile(lockfile, "0.28.0");
  const before = lockfile.split("\n");
  const after = out.split("\n");
  const changed = after.flatMap((line, i) => (line === before[i] ? [] : [i]));
  assert.equal(changed.length, 1);
  assert.equal(after[changed[0]], '      "version": "0.28.0",');
  assert.equal(before[changed[0] - 1], '      "name": "har-trace-viewer",');
});

test("patchLockfile refuses a lockfile without the packages/cli entry", () => {
  assert.throws(() => patchLockfile('{ "packages": {} }', "1.0.0"), /packages\/cli/);
});

// The git side of `tag` and the refusals of `prepare`, in a throwaway repository
const script = fileURLToPath(new URL("./release.mjs", import.meta.url));

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function run(dir, ...args) {
  return spawnSync("node", [script, ...args], { cwd: dir, encoding: "utf8" });
}

function makeRepo(branch = "main") {
  const dir = mkdtempSync(join(tmpdir(), "release-test-"));
  git(dir, "init", "-b", branch);
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "tag.gpgsign", "false");
  mkdirSync(join(dir, "packages/cli"), { recursive: true });
  writeFileSync(join(dir, "packages/cli/package.json"), '{\n  "version": "0.1.0"\n}\n');
  writeFileSync(join(dir, "package-lock.json"), lockfile.replaceAll("0.27.0", "0.1.0"));
  writeFileSync(join(dir, "CHANGELOG.md"), "## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\n- x\n");
  writeFileSync(join(dir, "other.txt"), "a\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "Initial");
  return dir;
}

// What `prepare` leaves behind, written by hand
function bumpFiles(dir, version) {
  writeFileSync(join(dir, "packages/cli/package.json"), `{\n  "version": "${version}"\n}\n`);
  writeFileSync(join(dir, "package-lock.json"), lockfile.replaceAll("0.27.0", version));
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    `## [Unreleased]\n\n## [${version}] - 2026-02-01\n\n- y\n`
  );
}

test("tag commits the three files and creates an annotated tag, without pushing", () => {
  const dir = makeRepo();
  try {
    bumpFiles(dir, "0.2.0");
    const result = run(dir, "tag");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(dir, "log", "-1", "--format=%s"), "Release v0.2.0");
    assert.equal(
      git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").sort().join(","),
      "CHANGELOG.md,package-lock.json,packages/cli/package.json"
    );
    assert.equal(git(dir, "cat-file", "-t", "v0.2.0"), "tag");
    assert.match(result.stdout, /git push --follow-tags/);
    assert.equal(git(dir, "status", "--porcelain"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tag refuses other changes in the tree and an existing tag", () => {
  const dir = makeRepo();
  try {
    bumpFiles(dir, "0.2.0");
    writeFileSync(join(dir, "other.txt"), "changed\n");
    const dirty = run(dir, "tag");
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /other\.txt/);
    assert.equal(git(dir, "log", "-1", "--format=%s"), "Initial");

    git(dir, "checkout", "--", "other.txt");
    git(dir, "tag", "v0.2.0");
    const existing = run(dir, "tag");
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr, /already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tag refuses a branch other than main", () => {
  const dir = makeRepo("feature");
  try {
    bumpFiles(dir, "0.2.0");
    const result = run(dir, "tag");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /main/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepare refuses a dirty tree", () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, "other.txt"), "changed\n");
    const result = run(dir, "prepare", "patch");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not clean/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepare refuses an empty Unreleased section before touching any file", () => {
  const dir = makeRepo();
  try {
    const result = run(dir, "prepare", "patch");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unreleased/);
    assert.equal(git(dir, "status", "--porcelain"), "");
    assert.match(readFileSync(join(dir, "packages/cli/package.json"), "utf8"), /0\.1\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
