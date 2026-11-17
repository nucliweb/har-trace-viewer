# har-trace-viewer

[![CI](https://github.com/nucliweb/har-trace-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/nucliweb/har-trace-viewer/actions/workflows/ci.yml)

Offline HAR + Chrome trace analyzer that shows how a page load travels through CDN, origin and third parties, with cache recommendations and first-vs-repeat comparison.

![HTV report in light mode: the page load diagram with the browser, a Vercel CDN edge, the origin and third parties, and the TTFB, FCP, LCP and onLoad metrics](docs/screenshot-light.png)

Try it in the browser at [perf.reviews/har-trace-viewer](https://perf.reviews/har-trace-viewer) with your own HAR and trace files or the built-in demo flow.

Analyzes HAR and Chrome trace files and shows the page load step by step, with its network requests, hosts, CDN and cache behavior and performance metrics: in the terminal, as a self-contained HTML report to share, or as JSON for other tools and AI agents.

## Usage

```bash
htv <file.har[.gz]> [<trace.json[.gz]>] [-o <dir|file.html|file.json>] [--format tui|html|json|findings|markdown|csv|mermaid] [options]
htv --page <name> --har <file.har[.gz]> [--trace <file.json[.gz]>] [--select <id|text>] [--runs median|all|<N>] [--page <name> ...] [-o <dir|file.html|file.json>] [--format tui|html|json|findings|markdown|csv|mermaid] [--bundle] [--region default|cn] [--compare | --compare-with <file.har[.gz]> [--compare-trace <file>] [--compare-select <id|text>]] [--compare-region default|cn]
htv redact <file.har[.gz]> [-o <out.har[.gz]>] [--mask-hosts]
htv completion bash|zsh|fish
htv --demo
```

`htv --demo` opens the built-in example, with no file needed: one page of a real site with its Chrome trace, to look around the [terminal report](#terminal-report) before recording anything. It goes to every output too (`htv --demo -o demo.html`, `htv --demo --format markdown`).

A HAR can be given on its own (`htv page.har`), followed by its Chrome trace (`htv page.har trace.json.gz`); files are told apart by extension, and a `.json` file is read to see whether it is a HAR or a trace, so a HAR saved as `.json` works alone or next to its trace in either order. A HAR saved with any other extension needs `--har`.

### Output

The destination picks the format:

| Command                          | Output                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `htv page.har`                   | Browses the report in the terminal: Findings, Waterfall, Resources, Overview, Steps, Hosts and Cache & network tabs (needs an interactive terminal) |
| `htv page.har -o r.html`         | A single self-contained HTML file with the interactive diagram, which opens offline                                                                 |
| `htv page.har -o r.json`         | The full analysis as JSON                                                                                                                           |
| `htv page.har --format json`     | The same JSON on stdout, to pipe into another tool or an AI agent                                                                                   |
| `htv page.har --format findings` | Only the [findings](#findings) of each page and its metrics, as compact JSON on stdout (or `-o findings.json`)                                      |
| `htv page.har --format markdown` | A [Markdown report](#markdown-csv-and-mermaid) to paste into a ticket or a doc, on stdout (or `-o report.md`)                                       |
| `htv page.har --format csv`      | One CSV row per request, on stdout (or `-o requests.csv`)                                                                                           |
| `htv page.har --format mermaid`  | A Mermaid sequence diagram of the document request per page, on stdout (or `-o diagram.md`)                                                         |
| `htv page.har -o report/`        | A directory with `index.html` and its assets (`--bundle` inlines them)                                                                              |

The JSON holds the version of htv that wrote it and the flow the HTML report draws: `{ "htvVersion", "kind": "flow", "flow" }`, or `{ "htvVersion", "kind": "comparison", "a", "b", "requestDiff" }` for a comparison. `requestDiff` compares the two pages request by request (see [Examples](#examples) for how requests pair): `pages` names them, `pairs` lists each request of A with its request in B, biggest change of time first (`match` is `url` or `similar`; `a` and `b` carry the entry index, URL, method, type, status, protocol, `cache` as `network` or `browser`, priority, start, time, TTFB and transfer bytes; `delta` holds B − A of start, time, TTFB and transfer; `changes` names what differs among status, protocol, cache and priority), and `added` and `removed` list the requests only B or only A made, by start. Each flow carries its data-model `version`, its pages with their parsed HAR entries and trace metrics, the topology and cache report of every page (`pageAnalyses`) and the steps of the diagram.

### Terminal report

`htv page.har` opens the report in the terminal, in seven tabs:

![The terminal report of a page load: the findings, the waterfall filtered to the third parties and zoomed on the page load, the resources sorted by size, the overview, the steps, the hosts, the cache and the help](docs/tui-tour.gif)

| Key | Tab             | What it shows                                                                                                                                                           |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1` | Findings        | What to fix first: the [findings](#findings) of the page by severity, each with its metric, what to do and its evidence                                                 |
| `2` | Waterfall       | Every request on one time axis, with the TTFB, FCP, LCP, DCL and onLoad marks, to filter, narrow to a party and zoom on the page load ([waterfall](#waterfall))         |
| `3` | Resources       | The same requests as a table (type, status, priority, protocol, encoding, size, TTFB, time and start), sorted by any column                                             |
| `4` | Overview        | The metrics rated against the web.dev thresholds, the network nodes (CDN, origin, third parties) and, with a trace, the [main thread](#main-thread)                     |
| `5` | Steps           | The page load step by step, from the connection to the load event, with the route, the metrics and the requests of each step                                            |
| `6` | Hosts           | The requests, transfer, TTFB, connection reuse and protocol of each host, what each HTTP version the page used does, and the [third parties](#third-parties) by service |
| `7` | Cache & network | How the CDN and the browser cache the document and the static assets, and the network recommendations                                                                   |

A first session, as in the recording above:

1. `htv page.har trace.json.gz` opens the report. The trace adds the FCP, the LCP, the render-blocking requests and the main-thread work; without it they read `n/a`.
2. The Findings tab (`1`) comes first: the critical findings and the warnings at the top, each with what to do. `↑`/`↓` and `PgUp`/`PgDn` (or `Space`) scroll, and `e` shows all the evidence of every finding.
3. The Waterfall (`2`) shows when each request ran. `/` then `-party:first` keeps the third parties (`Enter` keeps the filter, `Esc` clears it), and `z` zooms the axis on the page load, so the requests before onLoad take the whole width. `↑`/`↓` move a cursor over the requests and `Enter` opens the one under it: its full URL and facts, its sequence over the network (a step per phase between the browser, the DNS resolver and the server, with what happens in it and about one round trip to the server), what requested it (the initiator chain, closest first), its timing phases, sizes and cache status, and its request and response headers with the [sensitive values masked](#sharing-a-report-safely), with `n`/`N` for the next and the previous request and `Esc` to go back.
4. On Resources (`3`), `s` cycles the column the table sorts by (start, size, time, TTFB, then the others) to find the heaviest or the slowest requests, and `S` reverses it.
5. Overview (`4`) gathers the metrics, Steps (`5`) walks the load with `←`/`→`, and Hosts (`6`) and Cache & network (`7`) show where the time and the bytes went. `<` and `>` scroll the columns of a table wider than the terminal.
6. `?` lists every key and the filter syntax on any tab, and `q` (or `Ctrl+C`) quits.

The mouse works too: the wheel scrolls the view (on the waterfall and the resources it moves the cursor three requests at a time), and a click picks a tab or the request under the pointer. Mouse reporting takes over the terminal's own text selection, so `m` turns it off and on, `htv --no-mouse` starts without it, and holding `Shift` (`Option` in iTerm2) while dragging selects text in most terminals with it on. The terminal is always given back as it was, on `q`, `Ctrl+C`, an error or a signal.

A comparison puts two recordings of the same page in one report, here with the browser cache off (`cold`) and on (`warm`):

![The terminal report comparing a cold and a warm load: the waterfall of each side, the cache of each side and the hosts of both](docs/tui-compare.gif)

The top edge names both sides (`A cold · B warm`); `a`/`b` pick the side the Findings, Waterfall, Resources and Cache & network tabs show, and the Hosts tab lists both with the difference per host, per third party and per request (the fifteen pairs whose time changed most, then the requests added and removed). In a flow of several pages, `←`/`→` (or `p`/`P`) move between the pages on every tab but Steps.

### Findings

htv turns its analyses into a list of findings per page, ordered by severity (critical, warning, info, good) and, within a severity, by the time and bytes at stake. Each finding has:

| Field            | Content                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | A stable kebab-case rule id, such as `document-redirects`, `duplicate-requests`, `cdn-miss-document`, `versioned-assets-not-cached` or `slow-lcp`                         |
| `title`          | The finding in a few words, with its count: `2 requests failed (4xx)`, `LCP is poor: 4.6 s`                                                                               |
| `severity`       | `critical`, `warning`, `info` or `good`                                                                                                                                   |
| `metric`         | What it affects: `ttfb`, `fcp`, `lcp`, `cls`, `inp`, `transfer`, `requests` or `none`                                                                                     |
| `summary`        | What was found, in one sentence with its numbers                                                                                                                          |
| `recommendation` | What to do about it                                                                                                                                                       |
| `confidence`     | `high` when read from the recording itself (status codes, headers, measured metrics), `medium` when inferred (CDN headers, ratios), `low` when the recording may cause it |
| `evidence`       | The resources that show it: `url`, and `bytes`, `ms` and `detail` when known                                                                                              |
| `page`           | The page `index` and `name`, and the `side` (`a` or `b`) in a comparison                                                                                                  |
| `source`         | The analysis it comes from: `cache`, `network`, any other report of the page, or `metrics`                                                                                |

The findings come from the recommendations of every report of a page (cache, network, and the others the analysis adds) and from the metrics themselves: TTFB, FCP, LCP, CLS and INP rated against the web.dev thresholds are a `critical` finding when poor and a `warning` when they need improvement, and a single `good` finding says so when every measured one is good (it needs a trace for the LCP).

`--format findings` writes them as JSON, with the metrics summary of each page as numbers (times in ms, sizes in bytes, ratios from 0 to 1, `null` when the recording cannot provide the value). The document names the [JSON schema](packages/core/schema/findings.schema.json) (draft 2020-12) that describes it, which ships with the package as `dist/findings.schema.json`. A comparison lists the pages of side `a`, then those of side `b`.

```bash
$ htv page.har trace.json.gz --format findings
{
  "schema": "https://unpkg.com/har-trace-viewer@0.7.0/dist/findings.schema.json",
  "htvVersion": "0.7.0",
  "generatedAt": "2026-11-12T20:06:11.410Z",
  "pages": [
    {
      "name": "Page 1",
      "metrics": { "ttfb": 50.6, "serverWait": 48.7, "fcp": 181.5, "lcp": 181.5, "cls": null, "inp": null, "requests": 34, "transferBytes": 2077364, ... },
      "findings": [
        ...
        {
          "id": "duplicate-requests",
          "title": "9 resources downloaded more than once",
          "severity": "info",
          "metric": "transfer",
          "summary": "The page fetched these URLs over the network more than once, downloading 563 KB again.",
          "recommendation": "A <link rel=preload> or prefetch whose as, crossorigin or credentials does not match the request that uses it is fetched twice, ...",
          "confidence": "low",
          "evidence": [{ "url": "https://example.com/_next/static/chunks/169-7c4f23f868dd8b78.js", "detail": "fetched 2×", "bytes": 168825 }, ...],
          "page": { "index": 0, "name": "Page 1" },
          "source": "network"
        },
        ...
      ]
    }
  ]
}
```

The same findings open the terminal report, on the Findings tab (`1`), grouped by severity with the metric, the summary, what to do and up to three evidence rows each; and in the HTML report and the web app, the Findings button opens them for the current page, with the number of critical and warning findings on the button. In a comparison, `a`/`b` pick the side on the Findings tab, and each diagram has its own Findings button.

### Markdown, CSV and Mermaid

`--format markdown` writes a report for a ticket or a doc, in GitHub-flavoured Markdown without HTML. Each page has a title with its name and URL, a Metrics table (value and web.dev rating), its [findings](#findings) grouped by severity (critical, warning, info; the good ones in one line) with the summary, the recommendation, up to five evidence rows and a note with the source and confidence, a Hosts table (provider, PoP, requests, cache hits, bytes, median TTFB, protocol) and a [Third parties](#third-parties) table (category, hosts, requests, bytes, requests before onLoad, render-blocking). A comparison opens with a table of the metrics of A and B, their delta and rating, one of the third parties of both sides, and the requests compared one by one: how many paired, were added and were removed, the ten pairs whose time changed most (then their bytes) with what else changed, and the first ten added and removed requests, before the sections of each side. `-o report.md` alone picks this format.

`--format csv` writes one row per request of every page, as RFC 4180 CSV with `\r\n` line endings and a header row: `page, side, url, host, type, method, status, protocol, encoding, from_cache, start_ms, blocked_ms, dns_ms, connect_ms, ssl_ms, send_ms, wait_ms, receive_ms, duration_ms, transfer_bytes, body_bytes, priority`. Times are ms with at most one decimal; a phase that did not apply (DNS on a reused connection) is empty, and `connect_ms` is the TCP handshake alone, with TLS in `ssl_ms`. `side` is `a` or `b` in a comparison and empty otherwise. `-o requests.csv` alone picks this format. `--filter <query>` keeps only the requests that match a [waterfall](#waterfall) query, in CSV and in the JSON (where it narrows `har.entries` of each page while the metrics and findings still describe the whole capture); with another format it exits with an error, and so does an invalid query. `cat page.har | htv - --format csv --filter "status:4xx"` reads the HAR from stdin. The findings are not available as CSV; `--format findings` gives them as JSON, which any JSON tool converts to CSV.

`--format mermaid` writes, per page, a fenced `mermaid` block with a sequence diagram of the document request: Browser, the GFW when `--region cn` draws it, the CDN edge (provider and PoP) and the origin (region), with the TTFB and the CDN cache status on the response. GitHub, GitLab and most doc tools render it. An `--output` takes `.md`, `.mmd` or `.mermaid`.

### Waterfall

The waterfall lays every request of a page on one time axis, sorted by start: its short name, type, status and size, and a bar split into its phases (blocked, DNS, connect, TLS, send, wait, receive), with the TLS handshake drawn after the TCP connection and the phases a reused connection skips left out. Browser-cache hits are drawn hollow. Vertical marks show the document's TTFB, FCP and LCP (from the trace), DOMContentLoaded and onLoad, and badges point at the LCP resource and the render-blocking requests (from the trace's render-blocking status, or inferred from the HAR's initiators and priorities without one).

In the HTML report and the web app, the Waterfall button opens it for the current page (each diagram of a comparison has its own). Chips filter by resource type, the selects by first or third party and by host, and the filter box takes a query in the field language below. The Axis select spans the whole recording or zooms on the page load (up to the last mark), when late requests such as beacons stretch the recording. The column headers sort the rows (a second click reverses the order, a third restores the start order), and the Table view lists the same requests with their priority, protocol, encoding, size, TTFB, time and start, each column sortable. Hovering or focusing a row shows its full URL and the duration of each phase; `↑`/`↓` move between rows. Selecting a row opens its detail under it, after the Copy URL and Copy cURL buttons: its method, status, protocol, priority and type; its sequence over the network, with the browser, the DNS resolver and the server as lanes and a step per phase (the queue, the DNS lookup, the TCP and TLS handshakes or the one QUIC handshake of HTTP/3, the request, the server's wait and the response), each with when it starts, how long it took and what happens in it, whether the request opened its connection, reused one that another request or the time before the recording opened, or came from the browser cache, and, from the handshake, about one round trip to the server and how much of the TTFB the server took (each handshake is one step with its whole time: a HAR records phases, not packets); what requested it (the initiator chain up to the document, with line numbers), its timing phases, its sizes (on the wire, compressed and uncompressed body, encoding), its cache status (browser cache, revalidation, CDN cache, `Cache-Control`, `Age`) and its request and response headers in the order the HAR lists them, each list with a copy button and every masked value tagged as such. The link keeps the selected request (`r=` in the address), so it opens with the detail shown. A report written before the header lists shows the allow-listed response headers it kept. It renders 300 rows at a time, with a button for the next ones, so that a HAR of thousands of requests stays responsive.

The resource lists of the steps and of the browser cache do the same, 200 rows per group at a time. The diagram is laid out again only when its width crosses a 50 px step, not on every pixel of a resize. The HAR and the trace are parsed in a worker; when the worker crashes on a file too large for the tab, the report says so instead of parsing the file again on the main thread, which would freeze the page.

#### Filter language

The filter takes terms separated by spaces, all of which a request must match, after DevTools' network filter. A bare word matches the URL (double quotes keep spaces in it), `field:value` narrows by a field, and a leading `-` keeps the requests that do not match. An unknown field reads as URL text; a value a field cannot read matches nothing and is reported under the box.

| Field                               | Values                                                                                             | Example             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------- |
| `domain` (or `host`)                | a host and its subdomains, or a pattern with `*`                                                   | `domain:cdn.*`      |
| `status`                            | a code, a class such as `4xx`, a range `300-399`, or `>=400`                                       | `status:4xx`        |
| `type`                              | `document` `css` `js` `font` `image` `fetch` `other` (DevTools' aliases work: `doc`, `img`, `xhr`) | `type:js`           |
| `mime`                              | part of the MIME type                                                                              | `mime:image/`       |
| `method`                            | the request method                                                                                 | `method:post`       |
| `larger-than`, `smaller-than`       | a transfer size in bytes, `k` or `M`                                                               | `larger-than:100k`  |
| `slower-than`, `faster-than`        | a duration in `ms` or `s`                                                                          | `slower-than:500ms` |
| `size` `body` `time` `ttfb` `start` | an operator (`>` `>=` `<` `<=` `=`) and a value                                                    | `ttfb:>300ms`       |
| `priority`                          | `highest` `high` `medium` `low` `lowest`                                                           | `priority:highest`  |
| `protocol`                          | `h1` `h2` `h3`                                                                                     | `protocol:h1`       |
| `encoding`                          | `br` `gzip` `zstd` `deflate` `identity` `none`                                                     | `encoding:none`     |
| `party`                             | `first` or `third`                                                                                 | `party:third`       |
| `is`                                | `cached` `blocking` `lcp` `redirect` `error` `document`                                            | `-is:cached`        |

`domain:*.cdn.com type:js -is:cached larger-than:50k` lists the scripts of a CDN that came over the network at more than 50 KB.

In the terminal, the Waterfall tab (`2`) draws the same rows with a bar scaled to the terminal width: `░` blocked, `▒` DNS, connect and TLS, `█` request and wait, `▓` download and `╌` a cache hit, with `L` before the LCP resource and `B` before the render-blocking requests. The ruler marks `T` TTFB, `F` FCP, `L` LCP, `D` DCL and `O` onLoad, and stays in view while the rows scroll. `/` opens the filter, which takes the same language (`Enter` keeps it, `Esc` clears it), `f` cycles first party, third party and all, and `z` zooms the axis on the page load and back (`›` points at the requests after it). The Resources tab (`3`) lists the same requests as a table with their type, status, priority, protocol, encoding, size, TTFB, time and start; it shares the filter and the party with the waterfall, `s` cycles the column it sorts by (the measures largest first) and `S` reverses the order. Both tabs share a cursor (`↑`/`↓`), and `Enter` opens the details of its request. `?` shows the keys and the filter syntax on any tab.

### Third parties

htv groups every request outside the document's registrable domain by the service it belongs to, from a built-in catalogue of the third parties most pages load (Google Tag Manager, Google Analytics, Meta Pixel, OneTrust, Cookiebot, Didomi, YouTube, Google Fonts, Intercom, HubSpot, Cloudinary, reCAPTCHA, Stripe…), each with a category: tag manager, analytics, advertising, consent, social, video, fonts, customer success, CDN or utility. A host the catalogue does not know is reported by its domain. For each third party it counts the network requests, the bytes on the wire and the browser-cache hits, splits the requests at the load event (what ran before onLoad competed with the page for connections and bandwidth), counts the requests that held the first paint and gives the median TTFB of its hosts, with the share of the page's requests and bytes that third parties take in all.

The findings say when third parties dominate the page weight (40% of the bytes or more; critical past 60%), when many of them ran before the load event, when a consent manager (CMP) is on the page and whether it held the first paint, and, on the good side, when the page has no third party or they stay light. The Hosts tab of the terminal report (`6`), the Hops panel of the HTML report and the web app, the Markdown report and the JSON (`pageAnalyses[].thirdPartyReport`) carry the table.

Above the third parties, the Hosts tab and the Hops panel list the HTTP versions the page used (HTTP/1.1, HTTP/2, HTTP/3), each with its hosts and network requests and a sentence on what it does: one request at a time per connection, many requests on one TCP connection that a lost packet holds up, or QUIC on UDP with its one-round-trip setup and a lost packet that holds up only its own request.

A consent manager decides which other third parties load, so the cost of consent is best read as a comparison: record the page before accepting and again after, then compare them (`htv before-consent.har --compare-with after-consent.har`). The Deltas panel in the HTML report, the Hosts tab in the terminal and the Markdown report list the third parties of both recordings joined by service, what B added first, with the requests and bytes each one added.

### Main thread

With a Chrome trace, htv reads the renderer's main thread: every task, what it spent its time on (scripting, rendering, painting, parsing, garbage collection) and the script each slice of time belongs to, from the function calls, script evaluations and compilations around it. From them it reports the **Total Blocking Time** (TBT): the time past 50 ms of every long task between the first contentful paint and the first interaction, or the end of the recording without one, rated with Lighthouse's lab thresholds (200 ms, 600 ms). TBT appears with the other metrics in every output, as a `--budget tbt=200` limit, and as the `high-tbt` finding when it needs improvement or is poor.

The main-thread findings name the long tasks and the scripts that blocked the most (`long-tasks`), the third-party scripts that cost main-thread time by service (`third-party-main-thread`, the same catalogue as the [third parties](#third-parties) report, whose table carries each service's main-thread and blocking time), and the scripts of the browser's extensions (`browser-extensions`): their time belongs to the recording's browser, not to the page, so record in a guest or incognito window before acting on the numbers. The Markdown report and the JSON (`pageAnalyses[].mainThreadReport`) list the busy time by category and the scripts by time, party and blocking time; the Metrics panel of the HTML report and the Overview tab of the terminal show the top scripts.

### Options

| Flag                       | Description                                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<file>`                   | A HAR (`.har`, `.har.gz`) or a Chrome trace (`.json`, `.json.gz`) given without its flag, attached to the preceding `--page`                                                                                                                    |
| `--page <name>`            | Page label (can be specified multiple times for multi-page reports)                                                                                                                                                                             |
| `--demo`                   | Report the built-in example (one page of a real site with its trace) instead of a recording; no file needed. It cannot go with a recording, a comparison, `--list-pages` or a region                                                            |
| `--har <file>`             | HAR file (`.har` or `.har.gz`) for the preceding `--page`                                                                                                                                                                                       |
| `--trace <file>`           | Chrome trace file (`.json` or `.json.gz`) for the preceding `--page`                                                                                                                                                                            |
| `--select <value>`         | For the preceding `--har` with several pages (WebPageTest runs and views): keep only the matching pages, by page id, comma-separated ids or text/regex on id, title and URL                                                                     |
| `--runs <value>`           | For the preceding `--har` with several WebPageTest runs: `median` (default without `--select`), `median:<metric>`, `all` or a run number. See [Several runs](#several-runs)                                                                     |
| `--list-pages`             | Print the pages (id, entries, title) of each `--har` and exit without generating; with `--format json`, print `{ files: [{ file, pages: [{ id, title, url, entries }] }] }`                                                                     |
| `-` (as the HAR)           | Reads the HAR from stdin, gzipped or not: `cat page.har \| htv - --format csv`, or `--har -`. The terminal report needs a terminal, so pass `--format` or `-o`. A HAR only, once per run                                                        |
| `--filter <query>`         | With `--format csv` or `json`: keeps only the requests matching the [waterfall filter](#waterfall) query (`type:js`, `domain:cdn.*`, `status:4xx`, `-is:cached`). Write a negated query as `--filter=-type:image`. Any other format is an error |
| `--compare`                | Compare the two pages of the flow instead of chaining them: the first is A (top), the second B (bottom); the flow must have exactly two pages                                                                                                   |
| `--compare-with <file>`    | Compare the flow (A, one page) with another HAR (B)                                                                                                                                                                                             |
| `--compare-trace <file>`   | Chrome trace for the `--compare-with` HAR                                                                                                                                                                                                       |
| `--compare-select <value>` | Page of a multi-page `--compare-with` HAR, as `--select`                                                                                                                                                                                        |
| `--compare-region <id>`    | Client network region of B in a comparison, as `--region` is A's. Without it, B takes the region its own latencies suggest                                                                                                                      |
| `-o, --output <path>`      | Where the report is written: a `.html` file (self-contained), a `.json` file, or a directory; without it, the report opens in the terminal                                                                                                      |
| `--format <format>`        | `tui`, `html`, `json`, `findings`, `markdown`, `csv` or `mermaid`; every format but `tui` and `html` prints to stdout without `--output`                                                                                                        |
| `--bundle`                 | For a directory `--output`: inline all assets (CSS, JS, fonts) into its `index.html`                                                                                                                                                            |
| `--mask-hosts`             | Replace third-party hostnames with `host-N.redacted` in the report, in every format. Every report masks its secrets already. See [Sharing a report safely](#sharing-a-report-safely)                                                            |
| `--region <id>`            | Client network region: `default`, or `cn` for the Great Firewall before the first server. Without the flag, `cn` when the latencies suggest China/GFW routing. In a comparison, A's region                                                      |
| `--budget <list>`          | `<metric>=<value>[,...]`: fail (exit 2) when a page goes over a limit, or `delta:<metric><=<value>` when B is worse than A in a comparison; repeatable. See [CI budgets](#ci-budgets)                                                           |
| `--budget-strict`          | Fail a budget whose metric the page cannot provide (LCP without a trace) instead of passing it as `n/a`                                                                                                                                         |
| `--check-format <format>`  | `text` (default), `json`, `junit` or `github`: the format of the check result. See [Check formats](#check-formats)                                                                                                                              |
| `--check-output <path>`    | Also write the check result, in `--check-format`, to a file; the terminal keeps the text result                                                                                                                                                 |
| `--fail-on <severity>`     | `critical` or `warning`: fail (exit 2) when a [finding](#findings) of that severity or worse exists                                                                                                                                             |
| `--no-mouse`               | Start the terminal report without mouse reporting, which leaves the terminal's own text selection alone; `m` turns it on                                                                                                                        |
| `--debug`                  | Write diagnostics to stderr: the input detected (HAR or trace, gzip), the pages, the timings of the parse, generate and render phases and the full stack trace of an error. stdout stays as it is                                               |
| `-h, --help`               | Print the usage and exit                                                                                                                                                                                                                        |
| `-v, --version`            | Print the version and exit                                                                                                                                                                                                                      |

### Shell completion

`htv completion bash|zsh|fish` prints a completion script that completes the flags, their values (the formats, the check formats, the severities, the regions) and the files, and the `redact` and `completion` commands:

```bash
source <(htv completion bash)          # bash: add it to ~/.bashrc
source <(htv completion zsh)           # zsh: after compinit, in ~/.zshrc
htv completion fish > ~/.config/fish/completions/htv.fish
```

### Several runs

A WebPageTest test of several runs exports one HAR page per run and view, with ids shaped `page_<run>_<view>_<step>` (view `0` is the first view, `1` the repeat view); `--list-pages` prints them. One run alone can mislead, so without `--select` or `--runs` htv keeps the median run of each view and step: the run whose LCP is the median (the lower middle for an even count), else onLoad, else DCL when some run lacks the LCP. The LCP and FCP come from the trace, else from the paint times WebPageTest stores in its HAR pages. The page is named after the runs it stands for (`Run 2 · First view (median of 3 runs)`), and a note on stderr says which run was kept for each view.

A repeat view's HAR leaves out the requests the browser cache served. htv infers them from the first view of the same run: the resources the repeat view did not request again and that were still fresh when it started. Each step lists the inferred hits of its group (critical, secondary, third party) beside the HAR's own cache hits, lights the hop to the browser cache, and shows them with an `inferred` badge in the web cache list and an "Inferred from the browser cache" table in the terminal's Steps tab.

The median page carries the spread of every metric over the runs (min, median, max and p75). The Markdown export shows each metric as the median page's value followed by its `(min–max)` over the runs, and a "Run-to-run variance" finding (`run-to-run-variance`) lists the Core Web Vitals and TTFB whose spread is wider than their good threshold (`warning`) or than 30% of their median (`info`), with the min, median and max of each as evidence.

```bash
htv --har wpt.har --format markdown             # the median run of each view, with the spread
htv --har wpt.har --runs median:fcp -o r.html   # the median run by FCP
htv --har wpt.har --runs 2 -o run2.html         # run 2 alone, first and repeat view
htv --har wpt.har --runs all -o runs.html       # every run
htv --har wpt.har --compare -o compare.html     # median first view (A) vs median repeat view (B)
```

`--select` keeps every page it matches unless `--runs` is given too, in which case the median is taken over the selected pages (`--select "First View" --runs median`).

### Playwright recordings

A HAR recorded with Playwright keeps a whole session under one page. htv splits it at each navigation of the main frame (the frame of the first document; a redirect chain stays one navigation), so every load gets its own steps, TTFB and cache, and the load event Playwright stores goes to the navigation it fired in. Playwright starts its HAR page when the browser page opens, before the first navigation, so htv times that navigation from its document request: the time spent before it (the test's own setup) counts in neither the TTFB nor the load event. Playwright marks no browser-cache hit: a successful response with no bytes on the wire (`_transferSize` 0) and a body counts as one, from a store the HAR does not record ("Store not recorded" in the cache report, a `cache` badge in the cache list).

### CI budgets

`--budget` and `--fail-on` turn htv into a check for CI. Each budget is checked on every page, and on both sides of a comparison:

| Metric                                                             | Value                                                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `ttfb`, `server-wait`, `fcp`, `lcp`, `dcl`, `onload`, `inp`, `tbt` | Maximum in ms: `2500`, `2500ms` or `2.5s`                                                           |
| `cls`                                                              | Maximum score: `0.1`                                                                                |
| `requests`                                                         | Maximum number of network requests: `80`                                                            |
| `transfer`                                                         | Maximum bytes on the wire: `500000`, `500kb`, `1.5mb` (1 kb = 1000 bytes, as the report shows them) |
| `cdn-hit-ratio`, `cache-hit-ratio`                                 | Minimum ratio: `0.9` or `90%`                                                                       |

After the report is written, htv prints one line per budget per page (`pass` or `FAIL`, the actual value and the limit) and one line per [finding](#findings) that reaches `--fail-on`: a recommendation of the cache, network or another report, or a Core Web Vital or TTFB rated poor (`critical`) or in need of improvement (`warning`). The lines go to stderr, so `--format json` keeps stdout pure JSON; without `--output` no terminal report opens, and the result is printed to stdout instead, so the command runs without a TTY. A metric the page cannot provide (LCP without a trace, INP without interactions) shows `n/a` and passes, unless `--budget-strict` is given.

Exit codes: `0` every check passed, `2` a budget or `--fail-on` failed (the report is still written), `1` usage or input errors.

```bash
$ htv page.har trace.json.gz --budget lcp=2.5s,transfer=500kb,cdn-hit-ratio=95% --fail-on warning
Budgets:
  pass  Page 1  lcp            181 ms  <= 2500 ms
  FAIL  Page 1  transfer       2.1 MB  <= 500 KB
  pass  Page 1  cdn-hit-ratio  100.0%  >= 95.0%
Findings at warning or worse:
  FAIL  Page 1  warning  thirdParty: Third-party requests before the load event
Checks failed: 1 of 3 budgets failed; 1 finding at warning or worse.
$ echo $?
2
```

#### Budgets on a comparison

With `--compare` or `--compare-with`, a `delta:` budget limits how much worse B may be than A. The value is the metric's usual one (`delta:lcp<=200`, `delta:transfer<=50kb`), or a percentage of A (`delta:transfer<=10%`, `delta:requests<=5%`). A hit ratio is worse when it drops, and its delta is in points of the ratio (`delta:cdn-hit-ratio<=5%` allows 90% to fall to 85%). Any improvement passes. Pages are paired by position, a metric either side cannot provide is `n/a` as above, and a percentage of an A of zero fails when B grew. The `<=` is optional (`delta:lcp=200`), the prefix applies to one pair of a comma-separated list (`lcp=2500,delta:lcp<=10%`), and a `delta:` budget without a comparison is a usage error (exit 1). Plain budgets keep checking both sides of the comparison.

```bash
htv --har before.har --compare-with after.har --budget "delta:lcp<=200,delta:transfer<=10%"
```

#### Check formats

`--check-format` chooses how the result is written, to stdout or stderr as above:

| Format   | Output                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`   | The table above (default)                                                                                                                                                                            |
| `json`   | One document, see below                                                                                                                                                                              |
| `junit`  | JUnit XML: one `testsuite`, one `testcase` per budget and per finding that reached `--fail-on`, a `<failure>` with a message for each check that failed, `<skipped>` for an `n/a` one                |
| `github` | GitHub Actions workflow commands: `::error` for a failed budget or a critical finding, `::warning` for a warning finding, `::notice` for an `n/a` budget, so failures show as annotations on the run |

`--check-output <path>` writes the result in that format to a file, creating its directories, so a pipeline keeps `-o report.html` and collects `checks.xml` too; the terminal then shows the text result. An unwritable path is an error (exit 1). The exit codes do not depend on the format.

The JSON document has this shape:

```json
{
  "passed": false,
  "failOn": "warning",
  "summary": { "budgets": { "total": 2, "passed": 1, "failed": 1, "skipped": 0 }, "findings": 1 },
  "budgets": [
    {
      "page": "Page 1",
      "metric": "lcp",
      "operator": "<=",
      "limit": 2500,
      "actual": 3100,
      "unit": "ms",
      "status": "failed",
      "type": "value"
    },
    {
      "page": "A: Home vs B: Home",
      "metric": "transfer",
      "operator": "<=",
      "limit": 10,
      "actual": 4.2,
      "unit": "percent",
      "status": "passed",
      "type": "delta",
      "baseline": 1000000,
      "candidate": 1042000
    }
  ],
  "findings": [
    {
      "page": "Page 1",
      "severity": "warning",
      "source": "thirdParty",
      "id": "third-party-before-load",
      "title": "Third-party requests before the load event"
    }
  ]
}
```

`status` is `passed`, `failed` or `skipped` (the page cannot provide the metric and `--budget-strict` is absent; `actual` is `null`). `type` is `value` for a page checked against its limit and `delta` for a `delta:` budget, whose `actual` is how much worse B is than A in `unit` and which carries `baseline` (A) and `candidate` (B). `unit` is `ms`, `bytes`, `count`, `score`, `ratio` or `percent`; `operator` is `>=` for the hit ratios and `<=` otherwise. `findings` lists those that reached `--fail-on`, and `failOn` is `null` without it.

In GitHub Actions, the annotations appear on the run without a parser:

```yaml
- run: npx har-trace-viewer page.har trace.json.gz --budget lcp=2.5s,transfer=1.5mb --fail-on warning --check-format github
```

To keep the report and a JUnit file for a test reporter:

```yaml
- run: npx har-trace-viewer page.har -o report.html --budget lcp=2.5s --check-format junit --check-output checks.xml
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: htv
    path: |
      report.html
      checks.xml
```

### Sharing a report safely

A HAR holds everything the browser sent and received: cookies, `Authorization` headers, response bodies, tokens in query strings. The report keeps much less, and masks the secrets of what it keeps as the HAR and the trace are read, by the rules that `htv redact` applies too: no bodies; every request and response header, with cookie values turned into `*` (or `[redacted]` and `*`), one per character, their names kept, and the values of `Authorization`, `Proxy-Authorization`, `X-Api-Key` and every header whose name says it holds a credential turned into `[redacted]`; and every URL the HAR or the trace names (requests, redirects, initiators, the LCP image, the scripts of the main thread), page titles, Server-Timing descriptions and the trace's node names, with their secrets masked as the rules below say. Hosts, paths and the other query values stay as recorded, so the analysis works as it does on the recording. No secret those rules recognize reaches the report, whatever the options: the waterfall, the request detail, Copy URL and Copy cURL, the exports and the terminal all show the masked URL. A report from a version that kept URLs as recorded is masked the same way when the web app opens it.

The rules over URLs and text:

- Query and fragment values whose name is sensitive (`token`, `auth`, `key`, `apikey`, `api_key`, `session`, `sid`, `password`, `pwd`, `secret`, `access_token`, `id_token`, `code`, `state`, `email`, `user`, `uid`, `cid`, `signature`, `sig`, and any name containing `token`, `secret`, `session`, `password`, `signature`, `credential`, `api-key` or `auth`, whatever the case), or whose value looks like a JWT or a hex or base64 token of 32 characters or more, become `[redacted]`.
- Credentials in URLs (`https://user:pass@host`) become `[redacted]@`, emails (raw or as `%40`) `[email]`, and a JWT anywhere else `[redacted]`.
- A whole path segment of 32 or more letters, digits, `-` and `_` that mixes upper case, lower case and digits, as a reset or invite token does (`/reset/<token>`), becomes `[redacted]`. A segment with a dot in it (`main-93d7eb3c1c216c38.js`, a font file named by a long id) or in one case only (a hex fingerprint, a slug) stays.

The same value always masks the same way, so URLs that were equal stay equal, and a request of the HAR still matches its event in the trace. Two URLs that differed only in a masked value read the same, though: in the waterfall, in the duplicate-download finding and in the requests of a comparison.

Every output masks its secrets this way (HTML, JSON, findings, Markdown, CSV, Mermaid and the terminal), and so does the web app, its exports included. The page names given with `--page` go through the same rules, so a name that holds an email or a token is masked too. `--redact` and `--redact=mask-hosts` are deprecated aliases kept for existing pipelines: `--redact` changes nothing and prints a notice on stderr, and `--redact=mask-hosts` is `--mask-hosts` with a notice.

`--mask-hosts` replaces third-party hostnames with `host-1.redacted`, `host-2.redacted`... consistently, in every format: every host outside the registrable domain of the page's document and outside well-known shared services (Google, Facebook, Cloudflare, jsDelivr, unpkg, Cloudinary and other analytics, font and CDN hosts). Hosts under per-customer domains (`*.vercel.app`, `*.cloudfront.net`) name their customer, so they are masked. So is a host that only a header names, such as the site in the `Referer` or the `Origin` of a page reached from another one, and every header (`Host`, `:authority`, `Origin`, `Referer`) shows the masked name. It prints the count on stderr (`Masked 2 third-party hosts in the report.`). The web app's Export menu has a "Mask third-party hosts" checkbox, off by default, for its CSV, Markdown and Mermaid exports.

Timings, sizes, statuses and the analysis stay the same, and both sides of a comparison share the placeholders.

`htv redact` writes a redacted copy of the HAR itself, still a valid HAR that htv and DevTools open:

```bash
$ htv redact page.har -o page.shared.har --mask-hosts
Redacted HAR written: /home/me/page.shared.har
Redacted: 6 cookie values, 6 header values, 20 query values, 3 bodies, 10 emails, 2 hosts masked
```

On top of the rules above over URLs, headers, initiators, redirects and page titles, with numbered placeholders (`[redacted-N]`, so URLs that differed still differ), it drops the response bodies (`content.text`; `content.size` stays), replaces request bodies, form values and WebSocket messages with `[redacted]`, masks cookie values (in the cookie lists, `Cookie` and `Set-Cookie`) with as many characters as they had, keeping their names and attributes, and replaces the values of `Authorization`, `Proxy-Authorization`, `X-Api-Key` and every header whose name contains `token`, `secret`, `session`, `password`, `api-key` or `credential`, keeping their names. The cache and CDN headers (`Cache-Control`, `Age`, `X-Vercel-Id`, `CF-Ray`, `Server-Timing`...) stay, so the redacted HAR gives the same metrics and findings as the original. Without `-o` the HAR goes to stdout and the counts to stderr; an output ending in `.gz` is gzipped. Redacting a redacted HAR changes nothing.

Masking follows rules: a secret in a short or single-case path segment (`/reset/abc123`, a hex token), in a query parameter whose name does not say so and whose value is short, in a header whose name does not say so, in a cookie's name, or in a URL encoded inside a query value can get through. Read the output before you share it.

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

Client in China (adds the Great Firewall to the diagram). Without `--region`, htv draws it when the latencies of any page look compatible with China/GFW routing (two of a document DNS lookup of 300 ms or more, a TCP connect of 500 ms or more, and three TLS handshakes or more, on two hosts or more, that take 350 ms and three times their TCP connect; or one of them with a `.cn` document host or a CDN PoP in mainland China) and prints a note saying why; a slow or mobile network shows the same latencies, so `--region default` draws the default topology:

```bash
htv --page "Home" --har home.har --output report/ --region cn
htv --page "Home" --har home.har --output report/ --region default
```

Each side of a comparison has its own region, so loads of the same page from different places compare as they were: one recorded in China draws the Great Firewall, one from Australia or the US does not. Each side takes the region its own latencies suggest; `--region` sets A's and `--compare-region` B's:

```bash
htv sydney.har --compare-with shanghai.har -o au-vs-cn.html
htv sydney.har --compare-with shanghai.har --compare-region cn -o au-vs-cn.html
```

The web app does the same on Auto, with a notice for each side its latencies place behind the Great Firewall; a region chosen in the builder applies to both sides.

Comparison of a WebPageTest first view and repeat view (without and with cache), both from the same HAR:

```bash
htv --har wpt.har --select page_1_0_1,page_1_1_1 --compare --output compare.html
```

Comparison of two recordings, each with its trace:

```bash
htv --page "Without cache" --har cold.har --trace cold.json.gz \
    --compare-with warm.har --compare-trace warm.json.gz --output compare/
```

A comparison report stacks the two diagrams (A on top, B below) and drives them with one step track: each step shows the step of the same kind (connection, TTFB, critical resources, FCP, third parties, LCP, load) on both, and a side without that step keeps its previous one, dimmed. The step panel lists both sides' metrics with the B − A delta, and the Deltas panel compares the metrics summary (TTFB, paints, CLS, INP, DCL, onLoad, requests, transfer, cache hit ratios) and every host's requests and TTFB. Its Requests view compares the two pages request by request: each request of A paired with its request in B, with the time and size of both, the B − A of time, TTFB and size, and the status, cache (network or browser cache), protocol and priority, `A → B` where they changed; then the requests only B made (added) and only A made (removed). The biggest change of time comes first, the column headers sort by request, start, Δ time, Δ TTFB or Δ size, and chips keep the changed, the added or the removed requests.

Requests pair by their URL first, the same URL requested again pairing in its order of start (the second with the second), and the type of request breaking a tie, so a prefetched chunk pairs with its prefetch. What is left pairs by a similar URL, marked `≈`: the same method, type, host and path once hashes (a content hash such as `main-93d7eb3c1c216c38.js`, a build id, a UUID, a timestamp) are taken out, with the query minus its cache busters, session ids and campaign parameters, and then without the query (a beacon whose parameters change on every load). A similar pair is a guess: two hashed files of one folder that differ only in their hash pair in their order of start, and a file renamed or moved, a hash shorter than eight characters or a host that changes between loads (`img1`, `img2`) leaves its requests added and removed. In the web app, the builder's "Compare with…" drop target takes the second HAR (and trace), and a multi-page HAR offers "Compare pages", which proposes the first and the repeat view of a WebPageTest run.

Portable single-file report:

```bash
htv --page "Home" --har home.har --output report.html
```

CI check that still publishes the report: exits 2 when the LCP goes over 2.5 s, the CDN serves less than 90% of the own resources or a critical finding shows up:

```bash
htv page.har trace.json.gz -o report.html --budget lcp=2.5s,cdn-hit-ratio=90% --fail-on critical
```

A directory report (`--output report/`) without `--bundle` loads its scripts as ES modules from `assets/`, which browsers block over `file://`; serve the folder over HTTP (for example `npx serve report/`), add `--bundle`, or write a `.html` file, which opens by double-click.

## Why htv

- **Hop-by-hop diagram from the HAR alone.** The page load is drawn step by step across browser, CDN edge (with its PoP location), origin and third parties, using only the headers and timings already in the capture.
- **Cache analysis that includes the CDN.** Browser cache headers and CDN hit/miss are read together, flagging immutable candidates and hashed assets served with `no-store`.
- **First vs repeat comparison.** Two captures of the same page are compared with per-request and per-metric deltas.
- **One core, three outputs.** The terminal report, the self-contained HTML report and the JSON output come from the same analysis, so scripts and AI agents see what people see.
- **Offline and MIT.** Nothing is uploaded; HAR files, which often contain cookies and tokens, stay on your machine.

| Tool                         | What it does better                           | What htv adds                                               |
| ---------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Google HAR Analyzer          | Request filters and HAR sanitizing            | CDN and origin hops, cache analysis, first-vs-repeat deltas |
| HAR Viewer (Jan Odvarko)     | Classic, familiar waterfall                   | Step-by-step diagram by network node, CDN and cache context |
| wiretrail                    | CI failure thresholds, fast Rust binary       | Interactive HTML report, CDN diagram, comparison            |
| waterfall-tools (Pat Meenan) | Many input formats                            | CDN/PoP hop diagram and cache recommendations               |
| WebPageTest                  | Live tests from many locations, CDN detection | Works offline on captures you already have                  |

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

### Fixtures

Real recordings live in `fixtures/` (see its README for what each one is); small hand-built HARs and traces live in `packages/core/tests/fixtures/`. Strip response bodies from a recording before adding it with `node packages/core/scripts/trim-har.mjs in.har out.har`. `node packages/core/scripts/gen-large-har.mjs` regenerates the 1,500-entry `large.har.fixture.json.gz` deterministically.

### Demo flow

The web app's empty state offers a "Load demo flow" button, and `htv --demo` reports the same flow from the command line (the CLI build copies it to `dist/demo-flow.json`). The flow is pre-generated from the core test fixtures (`webperf-snippets.har.fixture.json` and `webperf-snippets.trace.fixture.json`) and stored in `packages/web/src/demo/demo-flow.json`. It is a separate chunk fetched on click, so it does not weigh on the main bundle, and it is not offered inside generated reports. Regenerate it after changing the flow format or the fixtures with `npm run demo:build -w @htv/web`.

### Terminal recordings

`python3 packages/cli/scripts/record-tui.py` records the two animations of the [terminal report](#terminal-report), `docs/tui-tour.gif` and `docs/tui-compare.gif`: it runs the built CLI in a pseudo-terminal (the tour over the built-in example of `--demo`, the comparison over the recordings in `fixtures/`), presses a fixed list of keys, renders each session with [agg](https://github.com/asciinema/agg) and, when [gifsicle](https://www.lcdf.org/gifsicle/) is installed, compresses the result. Run it after `npm run build` when the terminal report changes; `record-tui.py tour` records one of them.

### Public site

The web app is public at `https://perf.reviews/har-trace-viewer`. perf.reviews runs a reverse proxy that forwards `/har-trace-viewer` and `/har-trace-viewer/...`, path unchanged, to this app's Vercel deployment (`har-trace-viewer-web.vercel.app`), which builds it with `npm run build:site -w @htv/web` and serves `packages/web/dist-site`.

The site build differs from the one the CLI bundles into its reports: every URL sits under `/har-trace-viewer/` (the proxy requests the page with no trailing slash, against which relative URLs would resolve to perf.reviews' root), and the head names `https://perf.reviews/har-trace-viewer` as the canonical address and the social image's. The deployment's own root sends visitors to perf.reviews and its `robots.txt` keeps search engines off the vercel.app address. `e2e/site.spec.ts` serves the build as Vercel does and checks all three.

## Releasing

The CLI is published to npm as `har-trace-viewer` by `.github/workflows/release.yml` when a `v*` tag is pushed. The README npm shows, `packages/cli/README.md`, is written by the CLI build from this one, up to [Why htv](#why-htv) and with absolute links: edit this README, and a test fails until the build has written it again. The tag must equal `v` plus the version in `packages/cli/package.json`, otherwise the workflow fails.

```bash
npm version <patch|minor|major> -w har-trace-viewer
git commit -am "Release v<version>"
git tag -a v<version> -m "v<version>"
git push --follow-tags
```

[CHANGELOG.md](CHANGELOG.md) lists the changes of every version. A change adds its line under `Unreleased`; the release commit renames that section to the version with its date, and adds the compare link at the bottom of the file. The workflow publishes that section as the notes of the GitHub Release, and fails before publishing when the changelog has no section for the version.

The tag has to be annotated (`-a`): `--follow-tags` pushes annotated tags only, and a lightweight tag stays local without starting the workflow (push it with `git push origin v<version>`).

The workflow publishes with npm trusted publishing: npm accepts the OIDC token of the run instead of a stored secret, and adds the provenance of the package. The package settings on npmjs.com name `nucliweb/har-trace-viewer`, the workflow `release.yml` and the environment `npm-publish` as its trusted publisher, and the `npm-publish` environment asks a maintainer to approve each run before it publishes.
