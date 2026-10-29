# har-trace-viewer

Command-line tool that turns a HAR file, and optionally a Chrome DevTools trace, into a self-contained HTML performance report.

```bash
npx har-trace-viewer --page <name> --har <file.har[.gz]> [--trace <file.json[.gz]>] --output <dir|file.html> [--bundle] [--select <id|text>] [--region default|cn]
```

Install it globally with `npm i -g har-trace-viewer` to get the `htv` command (`htv --page <name> --har <file.har> --output <dir>`).

Pass `--page` once per page you want in the report, each followed by its `--har` and optional `--trace`. A HAR recorded across several navigations (several entries in `log.pages`) is expanded into one flow page per navigation, named after the page titles (prefixed with the `--page` name when given), and its `--trace` is attached to the page whose document URL matches the trace. The output directory receives an `index.html` with the viewer and the analyzed data embedded. `--output` is a directory; with `--bundle` it can also be a `.html` path, which writes only that single file (`--output report.html --bundle`). Without `--bundle` a `.html` output path is an error. `htv --help` prints the full usage and `htv --version` the installed version. With `--bundle`, the JavaScript and CSS are inlined and Google Fonts are embedded, so the report is a single file that opens offline.

`--select <value>` narrows the preceding `--har` when it holds several pages, as a WebPageTest export does (runs and first/repeat views). The value is a page id (`page_1_0_1`), a comma-separated list of ids, or text matched case-insensitively against page id, title and URL (`--select "Run 1, First"`; a regular expression also works). An unknown selection exits with an error listing the available pages. `--list-pages` prints the pages of each `--har` (id, entry count, title) and exits without generating. WebPageTest pages are named `Run 1 · First view` and `Run 1 · Repeat view`.

`--region` sets where the client browser sits on the network. `default` (used when the flag is absent) draws the browser talking directly to the CDN or origin. `cn` places it in China behind the Great Firewall: the diagram adds a GFW inspection node between the browser and the first server, and an Akamai edge without a visible PoP is shown in Hong Kong. Any other value exits with an error. When the latencies of the first page look compatible with GFW routing (document DNS above 80 ms or a TCP connect above 300 ms) and `--region` is absent, the CLI prints a note suggesting `--region cn`; a slow or mobile network produces the same latencies, so the topology never changes without the flag.

The report covers network requests, resource timing, and Core Web Vitals-related metrics derived from the trace, and it groups requests into the steps of the page flow.

Source code and issues: https://github.com/nucliweb/har-trace-viewer
