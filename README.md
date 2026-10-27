# har-trace-viewer

[![CI](https://github.com/nucliweb/har-trace-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/nucliweb/har-trace-viewer/actions/workflows/ci.yml)

Generates static HTML reports from HAR and Chrome trace files, visualizing page load steps, network requests, and performance data.

## Usage

```bash
htv --page <name> --har <file.har> [--trace <file.json[.gz]>] --output <dir> [--bundle] [--region default|cn]
```

### Options

| Flag             | Description                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `--page <name>`  | Page label (can be specified multiple times for multi-page reports)                                           |
| `--har <file>`   | HAR file for the preceding `--page`                                                                           |
| `--trace <file>` | Chrome trace file (`.json` or `.json.gz`) for the preceding `--page`                                          |
| `--output <dir>` | Directory where the report is written                                                                         |
| `--bundle`       | Inline all assets (CSS, JS, fonts) into a single self-contained `index.html`                                  |
| `--region <id>`  | Client network region: `default`, or `cn` to draw the Great Firewall between the browser and the first server |

### Examples

Single page:

```bash
htv --page "Home" --har home.har --trace home.json.gz --output report/
```

Multi-page comparison:

```bash
htv \
  --page "Home"    --har home.har    --trace home.json.gz \
  --page "Checkout" --har checkout.har \
  --output report/
```

Client in China (adds the Great Firewall to the diagram; without the flag the CLI only prints a note when latencies suggest it):

```bash
htv --page "Home" --har home.har --output report/ --region cn
```

Portable single-file report:

```bash
htv --page "Home" --har home.har --output report/ --bundle
```

Without `--bundle`, the report loads its scripts as ES modules from `assets/`, which browsers block over `file://`; serve the folder over HTTP (for example `npx serve report/`) or use `--bundle` for a file that opens by double-click.

## Packages

| Package            | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `@htv/core`        | HAR/trace parsing, node detection, cache analysis, flow generation |
| `har-trace-viewer` | `htv` command-line tool (`npx har-trace-viewer`)                   |
| `@htv/web`         | React viewer app embedded in generated reports                     |

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Type-check all packages:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

## Releasing

The CLI is published to npm as `har-trace-viewer` by `.github/workflows/release.yml` when a `v*` tag is pushed. The tag must equal `v` plus the version in `packages/cli/package.json`, otherwise the workflow fails.

```bash
npm version <patch|minor|major> -w har-trace-viewer
git commit -am "Release v<version>"
git tag v<version>
git push --follow-tags
```

The workflow needs an `NPM_TOKEN` repository secret (an npm automation token), or npm trusted publishing configured for this repository.
