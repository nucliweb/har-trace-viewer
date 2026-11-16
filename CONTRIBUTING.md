# Contributing

This guide covers what you need to change the code and get a pull request merged. The [README](README.md#development) describes the commands in more detail.

## Prerequisites

Node.js 22 or later, as set in the `engines` field of [package.json](package.json) and in [.nvmrc](.nvmrc). CI runs the checks on Node 22, 24 and 26.

## Setup

Install the dependencies from the repository root with `npm ci`. npm installs every workspace under `packages/` from the lockfile.

## Checks

The `checks` job of [.github/workflows/ci.yml](.github/workflows/ci.yml) runs these scripts from the root `package.json`, in this order:

1. `npm run lint`
2. `npm run knip`
3. `npm run format:check`
4. `npm run typecheck`
5. `npm run build`
6. `npm run size`
7. `npm run test:coverage`
8. `npm run smoke`

The `e2e` job builds the project and runs `npm run e2e` with Playwright. To run the end-to-end tests locally, install Chromium first with `npx playwright install chromium`.

Run the checks locally before you open a pull request.

Prettier formats the whole repository. Run `npm run format` from the repository root to write the changes, and `npm run format:check` to list the files that differ. The Prettier settings are in [.prettierrc](.prettierrc), and [.editorconfig](.editorconfig) matches them.

## Workflow

Write the failing test first, then the smallest change that makes it pass, then refactor. Test the behavior through the public interface, not the implementation.

Test data is synthetic. Hand-build the small HAR and trace files that a test needs in `packages/core/tests/fixtures/`. The recordings in `fixtures/` are captures of the project's own public site; do not add a capture of anyone's real session to the repository, and do not attach one to an issue or a pull request. The [sharing a report safely](README.md#sharing-a-report-safely) section describes how to remove sensitive data from a capture.

Write code, comments and identifiers in English.

Each user-facing change adds a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), in the section that fits: Added, Changed or Fixed.

Security problems are not reported in issues or pull requests. See [SECURITY.md](SECURITY.md).
