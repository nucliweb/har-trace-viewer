# har-trace-viewer

[![CI](https://github.com/nucliweb/har-trace-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/nucliweb/har-trace-viewer/actions/workflows/ci.yml)

Analyzes HAR and Chrome trace files and shows the page load step by step, with its network requests, hosts, CDN and cache behavior and performance metrics: in the terminal, as a self-contained HTML report to share, or as JSON for other tools and AI agents.

## Usage

```bash
htv --page <name> --har <file.har[.gz]> [--trace <file.json[.gz]>] [--select <id|text>] [-o <dir|file.html|file.json>] [--format tui|html|json] [--bundle] [--region default|cn] [--compare | --compare-with <file.har[.gz]> [--compare-trace <file>] [--compare-select <id|text>]]
```

### Output

The destination picks the format:

| Command                            | Output                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `htv --har page.har`               | Browses the report in the terminal: Overview, Steps, Hosts and Cache tabs (needs an interactive terminal) |
| `htv --har page.har -o r.html`     | A single self-contained HTML file with the interactive diagram, which opens offline                       |
| `htv --har page.har -o r.json`     | The full analysis as JSON                                                                                 |
| `htv --har page.har --format json` | The same JSON on stdout, to pipe into another tool or an AI agent                                         |
| `htv --har page.har -o report/`    | A directory with `index.html` and its assets (`--bundle` inlines them)                                    |

In the terminal, `1`–`4` or `Tab` switch tabs, `←`/`→` walk the steps, `↑`/`↓` and `PgUp`/`PgDn` scroll, `p` moves to the next page of a multi-page flow, `a`/`b` pick the side whose cache a comparison shows, and `q` quits.

The JSON holds the version of htv that wrote it and the flow the HTML report draws: `{ "htvVersion", "kind": "flow", "flow" }`, or `{ "htvVersion", "kind": "comparison", "a", "b" }` for a comparison. Each flow carries its data-model `version`, its pages with their parsed HAR entries and trace metrics, the topology and cache report of every page (`pageAnalyses`) and the steps of the diagram.

### Options

| Flag                       | Description                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--page <name>`            | Page label (can be specified multiple times for multi-page reports)                                                                                                         |
| `--har <file>`             | HAR file (`.har` or `.har.gz`) for the preceding `--page`                                                                                                                   |
| `--trace <file>`           | Chrome trace file (`.json` or `.json.gz`) for the preceding `--page`                                                                                                        |
| `--select <value>`         | For the preceding `--har` with several pages (WebPageTest runs and views): keep only the matching pages, by page id, comma-separated ids or text/regex on id, title and URL |
| `--list-pages`             | Print the pages (id, entries, title) of each `--har` and exit without generating                                                                                            |
| `--compare`                | Compare the two pages of the flow instead of chaining them: the first is A (top), the second B (bottom); the flow must have exactly two pages                               |
| `--compare-with <file>`    | Compare the flow (A, one page) with another HAR (B)                                                                                                                         |
| `--compare-trace <file>`   | Chrome trace for the `--compare-with` HAR                                                                                                                                   |
| `--compare-select <value>` | Page of a multi-page `--compare-with` HAR, as `--select`                                                                                                                    |
| `-o, --output <path>`      | Where the report is written: a `.html` file (self-contained), a `.json` file, or a directory; without it, the report opens in the terminal                                  |
| `--format <format>`        | `tui`, `html` or `json`; `--format json` without `--output` prints the JSON to stdout                                                                                       |
| `--bundle`                 | For a directory `--output`: inline all assets (CSS, JS, fonts) into its `index.html`                                                                                        |
| `--region <id>`            | Client network region: `default`, or `cn` to draw the Great Firewall between the browser and the first server                                                               |
| `-h, --help`               | Print the usage and exit                                                                                                                                                    |
| `-v, --version`            | Print the version and exit                                                                                                                                                  |

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

Comparison of a WebPageTest first view and repeat view (without and with cache), both from the same HAR:

```bash
htv --har wpt.har --select page_1_0_1,page_1_1_1 --compare --output compare.html
```

Comparison of two recordings, each with its trace:

```bash
htv --page "Without cache" --har cold.har --trace cold.json.gz \
    --compare-with warm.har --compare-trace warm.json.gz --output compare/
```

A comparison report stacks the two diagrams (A on top, B below) and drives them with one step track: each step shows the step of the same kind (connection, TTFB, critical resources, FCP, third parties, LCP, load) on both, and a side without that step keeps its previous one, dimmed. The step panel lists both sides' metrics with the B − A delta, and the Deltas panel compares the metrics summary (TTFB, paints, CLS, INP, DCL, onLoad, requests, transfer, cache hit ratios) and every host's requests and TTFB. In the web app, the builder's "Compare with…" drop target takes the second HAR (and trace), and a multi-page HAR offers "Compare pages", which proposes the first and the repeat view of a WebPageTest run.

Portable single-file report:

```bash
htv --page "Home" --har home.har --output report.html
```

A directory report (`--output report/`) without `--bundle` loads its scripts as ES modules from `assets/`, which browsers block over `file://`; serve the folder over HTTP (for example `npx serve report/`), add `--bundle`, or write a `.html` file, which opens by double-click.

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

### Demo flow

The web app's empty state offers a "Load demo flow" button. The flow it loads is pre-generated from the core test fixtures (`webperf-snippets.har.fixture.json` and `webperf-snippets.trace.fixture.json`) and stored in `packages/web/src/demo/demo-flow.json`. It is a separate chunk fetched on click, so it does not weigh on the main bundle, and it is not offered inside generated reports. Regenerate it after changing the flow format or the fixtures with `npm run demo:build -w @htv/web`.

## Releasing

The CLI is published to npm as `har-trace-viewer` by `.github/workflows/release.yml` when a `v*` tag is pushed. The tag must equal `v` plus the version in `packages/cli/package.json`, otherwise the workflow fails.

```bash
npm version <patch|minor|major> -w har-trace-viewer
git commit -am "Release v<version>"
git tag v<version>
git push --follow-tags
```

The workflow publishes with npm trusted publishing: npm accepts the OIDC token of the run instead of a stored secret, and adds the provenance of the package. The package settings on npmjs.com name `nucliweb/har-trace-viewer`, the workflow `release.yml` and the environment `npm-publish` as its trusted publisher, and the `npm-publish` environment asks a maintainer to approve each run before it publishes.
