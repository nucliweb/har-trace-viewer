# har-trace-viewer

Generates static HTML reports from HAR and Chrome trace files, visualizing page load steps, network requests, and performance data.

## Usage

```bash
htv --page <name> --har <file.har> [--trace <file.json[.gz]>] --output <dir> [--bundle]
```

### Options

| Flag | Description |
|------|-------------|
| `--page <name>` | Page label (can be specified multiple times for multi-page reports) |
| `--har <file>` | HAR file for the preceding `--page` |
| `--trace <file>` | Chrome trace file (`.json` or `.json.gz`) for the preceding `--page` |
| `--output <dir>` | Directory where the report is written |
| `--bundle` | Inline all assets (CSS, JS, fonts) into a single self-contained `index.html` |

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

Portable single-file report:

```bash
htv --page "Home" --har home.har --output report/ --bundle
```

## Packages

| Package | Description |
|---------|-------------|
| `@htv/core` | HAR/trace parsing, node detection, cache analysis, flow generation |
| `@htv/cli` | `htv` command-line tool |
| `@htv/web` | React viewer app embedded in generated reports |

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
