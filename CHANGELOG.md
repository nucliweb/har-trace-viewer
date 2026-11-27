# Changelog

All notable changes to `har-trace-viewer` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions 0.3.0, 0.4.0, 0.4.1 and 0.5.0 were tagged but not published to npm; their changes reached npm with 0.6.0.

## [Unreleased]

### Fixed

- Start the times of a HAR whose entries are not in chronological order at its earliest entry, where the first one listed could leave requests with a negative start.
- Word a single revalidated resource as "1 resource revalidated (304)".
- List `mainThread` among the sources of a finding in the findings schema.

## [0.27.0] - 2026-11-18

### Added

- Group the steps of each page in the step track of a flow of several pages: a mark (P1, P2…) leads each page's steps, and each step's tab names its page.

## [0.26.0] - 2026-11-18

### Added

- Play and step through the sequence of a request in the web app and the HTML report: Play reveals its steps one after another, Step one at a time, and Show all brings back the whole sequence.

### Fixed

- The tooltip of a waterfall row near the bottom of the list opens above the row, instead of below it where the list cut it off.

## [0.25.0] - 2026-11-18

### Added

- List the HTTP versions a page used in the Hosts tab of the terminal and the Hops panel of the web app and the HTML report, each with its hosts and network requests and a sentence on what it does.

## [0.24.0] - 2026-11-18

### Added

- Tell each request as a sequence between the browser, the DNS resolver and the server, in the request detail of the web app and the HTML report and in the request view of the terminal: a step per phase with when it starts, how long it took and what happens in it (the queue, the DNS lookup, the TCP and TLS handshakes or the QUIC one of HTTP/3, the request, the server's wait and the response), whether the request opened its connection, reused one opened by another request or before the recording, or came from the browser cache, and, from the handshake, about one round trip to the server and how much of the TTFB the server took.

## [0.23.0] - 2026-11-17

### Added

- Carry the step on screen in the link of the web app and the HTML report, so a link opens on that step and its page, with the drawer and the selected request in place.
- Carry in the link of a comparison the open drawer and its side (A or B), or the Deltas drawer with its Summary or Requests view and its filter, and the step.

### Fixed

- Tell a HAR saved with a `.json` name from its trace by their content when both are given without flags (`htv capture.json trace.json`, in either order, gzipped or not), where the second file replaced the first.
- Name each file and what it is when two `.json` files given without flags are both traces or both HARs, or when a page gets more than two of them.
- Report a file that does not exist as `<file>: no such file or directory`, and a `.json` that is not a recording as what it is, where both were called a Chrome trace that needs a HAR.

## [0.22.0] - 2026-11-17

### Changed

- Mask the page names given with `--page` like the rest of the report, so a name that holds an email or a token does not reach a report.
- Mask the third-party hostnames of a report with `--mask-hosts`, as `htv redact --mask-hosts` does with a HAR.
- Offer one "Mask third-party hosts" checkbox in the Export menu of the web app in place of the three levels of redaction: the exports always carry masked secrets, and a stored choice of masking the hosts stays checked.

### Deprecated

- `--redact`, which adds nothing to the masking every report has, and `--redact=mask-hosts`, which is `--mask-hosts`. Both print a notice on stderr and will be removed.

## [0.21.0] - 2026-11-17

### Changed

- Mask the secrets in URLs as the HAR and the trace are read, with or without `--redact`: sensitive query and fragment values, credentials, emails, JWTs and token-like path segments become `[redacted]` or `[email]` wherever a URL appears, in the waterfall, the request detail, Copy URL and Copy cURL, page titles, initiators, the requests, LCP image and scripts of the trace, the exports, the terminal report and the JSON. Hosts, paths and the other values stay as recorded. The web app masks a report of an earlier version the same way when it opens it.
- Mask with `--redact`, `htv redact` and the redaction of the exports a whole path segment of 32 or more mixed-case letters and digits, such as a reset or invite token.

### Fixed

- Leave out of the Server-Timing descriptions a secret that the masked `Server-Timing` header hid.
- Leave out of the node name of the LCP element in the trace an email or a token it carried.

## [0.20.0] - 2026-11-17

### Added

- Compare two recordings request by request: the Deltas drawer of the web app has a Requests view that pairs the requests of A and B, shows the time and size of each side, B − A of time, TTFB and size, and any change of status, cache, protocol or priority, and lists the requests only one side made. It opens with the biggest change of time first, sorts by column and filters to the changed, added or removed requests. A pair matched by a similar URL (a hashed file name, a cache-busting query) is marked ≈.
- Carry the same comparison in the `requestDiff` field of `--format json`, in a "Requests A vs B" section of `--format markdown` (the counts, the ten biggest changes, and the added and removed requests) and in the Hosts tab of the terminal report.
- Open the detail of a request under its row in the waterfall of the web app and the HTML report: method, status, protocol, priority, type, the initiator chain, the timing phases, the sizes on the wire, compressed and uncompressed, the cache status, and the request and response headers, each list with a copy button and the masked values marked.
- Show the initiator chain, the compressed body size, the cache status and every request and response header in the request view of the terminal report, with the masked values marked.

### Changed

- Keep every request and response header of each request in the reports, with the values of cookies, credential headers, sensitive query values, emails and JWTs masked as the HAR is read, so no header secret reaches a report even without `--redact`. The flow format is version 8, and reports of earlier versions still open.

### Fixed

- Mask with `--redact=mask-hosts` and `htv redact --mask-hosts` the hosts that only a header names, such as the site in a `Referer` or an `Origin`.

## [0.19.0] - 2026-11-17

### Added

- Show the data behind the findings in an Analysis drawer of the web app, for the page of the step on screen: the connections per host (HTTP version, connections, DNS, TCP and TLS handshakes, HTTP/3 offered in Alt-Svc, cookies and the Server-Timing of the document), the compression (bytes per text type and encoding, and the responses and images each saving comes from), the render (the LCP phases and resource, and the render-blocking resources with the source of their status) and the critical request chains. The keys 6 to 9 open each view, and a link opens one with `#d=connections`, `#d=compression`, `#d=render` or `#d=critical-path`.
- Say in each analysis view what the page lacks (a trace, an HTML document, or a measure that an older version of the report did not take) instead of showing zeros.

### Changed

- Place the Export button of the diagram view at the end of the toolbar, after the drawers, so its menu and its redaction note stay on screen on a phone.

## [0.18.1] - 2026-11-17

### Changed

- Slide in the metrics, hops and deltas drawers of the web app when they open, like the other drawers, and give every drawer the same square close button. No drawer animates when the system asks for reduced motion.

## [0.18.0] - 2026-11-17

### Changed

- Move the focus by one view of requests with PageUp and PageDown in the waterfall of the web app, and return to the selected request, or to the top, when the sort, the filter or the view changes.

### Performance

- Scroll through every request of a page with thousands of them in the waterfall of the web app, which renders only the rows near the view, instead of showing 300 at a time behind a "Show more" button. Sorting 10,000 requests answers in under 20 ms instead of more than 1.5 s.

## [0.17.1] - 2026-11-16

### Fixed

- Report a HAR saved with a `.json` name when it is given without `--har` (`htv capture.json`), where its name made it read as a trace and the report asked for a HAR.

## [0.17.0] - 2026-11-16

### Added

- Open the drawer, filter, view, sort and selected request that a link names, in the web app and in a report, and keep the address in step with them, so a copied link reopens the same view.
- Remember the filter, sort order and chart or table view of the waterfall across reloads; a link takes precedence over the remembered values.
- Use the mouse in the terminal report: the wheel scrolls the view or moves the cursor, and a click picks a tab or a request. The `m` key turns the mouse off and on, `--no-mouse` starts without it, and the terminal is restored on exit, Ctrl+C, an error or a signal.
- Print a shell completion script with `htv completion bash|zsh|fish`, covering the flags, their values and the `redact` and `completion` commands.
- Write diagnostics to stderr with `--debug` (the input detected, the pages, the timings of the phases and the full stack trace of an error) while stdout stays as it is.

### Fixed

- Return the focus to the Export button of the web app after an image export, where it was lost.

## [0.16.0] - 2026-11-16

### Added

- Choose the format of the `--budget` and `--fail-on` result with `--check-format text|json|junit|github`: a stable JSON document, JUnit XML with one test case per check, or GitHub Actions workflow commands that show the failures as annotations on the run.
- Write the check result to a file with `--check-output <path>` while the report keeps `-o`, so a pipeline collects `report.html` and `checks.xml` together.
- Limit how much worse B may be than A in a comparison with `delta:` budgets (`--budget "delta:lcp<=200,delta:transfer<=10%"`), in the unit of the metric or as a percentage of A.
- Copy the URL of a request or a cURL command from the waterfall of the web app and from its table view, with a spoken confirmation and a visible message when the clipboard is not available.
- Toggle the findings, waterfall, hops, metrics and cache drawers of the web app with the keys 1 to 5, and focus the waterfall filter with `/`. The help lists the keys.

### Changed

- Show the file-loading errors of the web app (invalid JSON, not a HAR or a trace, a HAR without entries, a truncated gzip) in the language of the interface, and word them again when the language changes.

### Fixed

- Leave the header of the Resources table of the terminal report as it is when the filter matches no request, where it was drawn inverted.

### Performance

- Keep the terminal report responsive on captures of 100,000 requests or more: the Waterfall and Resources tabs draw only the visible rows. A key press on a capture of 150,000 requests answers in under half a second instead of about 9 s.

## [0.15.0] - 2026-11-15

### Added

- Try the command without a file with `htv --demo`: the built-in example, one page of a real site with its Chrome trace, in the terminal report or in any other output.

## [0.14.0] - 2026-11-14

### Added

- Keep only the requests that match a waterfall query with `--filter <query>` (`type:js`, `domain:cdn.*`, `status:4xx`, `-is:cached`) in the `csv` and `json` formats. Any other format, or an invalid query, exits with an error.
- Read the HAR from stdin when the input is `-` (`cat page.har | htv - --format csv`), gzipped or not.
- Print the pages of each HAR as JSON with `--list-pages --format json`.
- Load a HAR and its trace dropped or picked together in the web app, and accept files dropped anywhere on the start screen.

### Changed

- Go back from a flow to the start screen with the Home button of the web app, which keeps the loaded pages so one more can be added without reading the files again. Reset clears them, and is also offered on the start screen once a file is loaded.

### Fixed

- Analyse captures of more than about 100,000 requests, which failed with "Maximum call stack size exceeded".

### Performance

- Start `--version`, `--help` and every non-interactive format about 2.5 times faster: the terminal interface loads only when it opens.
- Read a HAR with many pages by grouping its entries once, and run the connections and render-blocking analyses in linear time. A capture of 150,000 requests in 3 pages takes 11 s instead of 105 s.

## [0.13.0] - 2026-11-14

### Changed

- Show the percent-encoded non-ASCII names of resources as text in the web app and in the terminal report. Reserved characters, malformed escapes and control or bidirectional characters stay encoded.
- Match the request filter against the name shown as well as the URL.
- Leave the page-load metrics out of the Markdown report and of the terminal Overview for a capture without an HTML document, and explain the `L` and `B` flags of the terminal legends only when the page can have them.
- Publish the changelog section of a version as the notes of its GitHub Release.
- Update the minor dependencies and align the Node types with Node 22.

### Fixed

- Keep the export menu, the redaction note and the export failure message inside the screen on narrow screens, without covering the toolbar.
- Print a request phase shorter than a millisecond as `<1 ms` in the terminal report.

## [0.12.0] - 2026-11-14

### Changed

- Load the diagram and comparison views, the drawers, the dialogs and the Spanish and Catalan texts of the web app on demand, which cuts its initial JavaScript by a third. An HTML report stays a single script that opens offline.
- Check the gzip size of the web app and of the report build against budgets in CI.

## [0.11.0] - 2026-11-14

### Added

- A row cursor in the Waterfall and Resources tabs of the terminal report, which stays on its request through sorts and filters.
- The details of a request in the terminal report with Enter: its full URL, its timing phases and its response headers, with `n` and `N` for the next and the previous request.
- `e` in the terminal report shows all the evidence of every finding, and `<` and `>` scroll the columns of the Hosts and third-party tables.
- Redaction in the web export menu: the CSV, Markdown and Mermaid downloads hide the secrets, or the secrets and the third-party hosts, with the same result as `--redact`.

### Fixed

- Name the cache profile of a page without an HTML document "Primary request" instead of "Document", in the web app and in the terminal report.

## [0.10.0] - 2026-11-14

### Added

- Export the requests as CSV, the report as Markdown and the diagrams as Mermaid from the web export menu, also in the compare view.
- Read a HAR without pages as one page, and put an entry whose `pageref` names no listed page in the page that was running when it started.
- Read an API capture that has no HTML document: the busiest domain is the first party, and the findings and metrics of a document are left out.
- Announce "Generating…" while a diagram is generated in the web app.

### Changed

- Generate the diagram in a background worker, so the web app stays responsive on large recordings.

### Fixed

- Skip the entries of a HAR that have no request URL or valid start time instead of failing, and order the pages with a missing or invalid start time by their first request.
- Measure the text of the terminal report by the columns it takes, so CJK characters and emoji keep the frames aligned and are never cut in half.
- Name the file and the expected format when `htv redact` cannot read its input, and refuse a file that is not a HAR instead of writing it back.
- Keep the Generate button from starting a second run while a diagram is generated.

## [0.9.0] - 2026-11-14

### Added

- Read a Chrome trace saved as a bare array of events in the CLI.
- Home and End in the scrollable views of the terminal report.
- A scrollable help screen in the terminal report, closed with `?`, `q` or Esc.
- Honour `NO_COLOR` in the terminal report.
- A translated message in the web app when a flow cannot be generated, and a way back to the start screen when a view fails to render.

### Changed

- Esc no longer quits the terminal report, so an arrow key split across reads cannot exit it; `q` and Ctrl+C quit.
- Re-render only the hovered waterfall rows, keep the filter field responsive on large recordings and measure the toolbar position once per frame while scrolling.

### Fixed

- Name the file and the expected format when the CLI cannot read a recording, and report a missing `.gz` file instead of crashing.
- Explain that the terminal report needs an interactive terminal when stdin is not a TTY.
- Clamp the scroll position of the terminal report when the terminal is resized.
- Keep an expanded resource list expanded when the page re-renders.
- List every output format and the `.md` and `.csv` output paths in `--help`.

## [0.8.1] - 2026-11-13

### Changed

- Document the terminal report in the README with a tour, a tutorial and two recordings.

### Fixed

- Keep the TUI filter and scroll tests well inside the timeout.

## [0.8.0] - 2026-11-13

### Added

- A getting started section in the help, and a Help button in the header.

## [0.7.2] - 2026-11-12

### Fixed

- Accept a trace before its HAR and ask for the HAR it needs.

## [0.7.1] - 2026-11-12

### Changed

- Publish the repository's README on npm.

## [0.7.0] - 2026-11-12

### Added

- Each side of a comparison takes its own client region.
- A build of the web app for perf.reviews/har-trace-viewer.

## [0.6.5] - 2026-11-11

### Changed

- Update TypeScript to 7.

### Fixed

- Keep the diagram labels readable on a phone.

## [0.6.4] - 2026-11-11

### Changed

- Update knip to 6.
- Run the e2e job in Playwright's container image.

### Fixed

- On a phone, open the waterfall below the toolbar.

## [0.6.3] - 2026-11-11

### Fixed

- Give every control the same focus ring.

## [0.6.2] - 2026-11-11

### Fixed

- Give the views headings to navigate by, and the small controls 24px targets.

## [0.6.1] - 2026-11-11

### Fixed

- Let the shortcuts work while a checkbox or radio has the focus.
- Cover the journeys setting when it is turned off or storage is blocked.

## [0.6.0] - 2026-11-11

### Changed

- Hide multi-page journeys behind a setting, and the page pickers until asked for.
- Update minor and patch dependencies.

## [0.5.0] - 2026-11-11

### Added

- Name the page of the step in a flow of several pages.

## [0.4.1] - 2026-11-10

### Fixed

- Time a Playwright page from its first document request.

## [0.4.0] - 2026-11-10

### Added

- Keyboard shortcuts, a settings dialog and a help dialog.
- The web interface in Spanish and Catalan.

### Changed

- Tag releases with an annotated tag.

### Fixed

- Make the drawers, the fields and the diagram accessible.
- Let Escape dismiss the waterfall tooltip.

## [0.3.0] - 2026-11-10

### Added

- A third-party report by entity, with consent detection and an A/B comparison.
- A main-thread profile: long tasks, Total Blocking Time and the scripts behind them.
- A field language to filter requests, and a resources view that sorts them.
- Split a HAR page at each navigation of its main frame.
- Draw the Great Firewall when the latencies suggest it, and list a repeat view's inferred cache hits.
- Read stalled TLS handshakes as a sign of the Great Firewall, on any page of the flow.
- Count the browser-cache hits of a Playwright HAR.

### Changed

- Open the findings, cache and resource drawers wider.
- Keep the viewer responsive on large recordings.
- Split the diagram layout and the flow builder into modules.
- Prune dead exports with knip and share the `pct` and `fileName` helpers.
- Move to ESLint 10 and TypeScript 6; upgrade vitest and coverage-v8 to 5, jsdom to 30 and the GitHub Actions used by CI.

### Fixed

- Read the timing phases a HAR leaves out as phases that did not happen.
- Keep the resource list on the last step that requested something.
- Keep the right-hand drawers from covering each other.

## [0.2.0] - 2026-11-01

### Added

- A waterfall in the HTML report, the web app and the TUI.
- Findings: every recommendation is a finding, with a Findings tab, a panel and `--format findings`.
- Export the report as Markdown, CSV and a Mermaid sequence diagram.
- Budgets and recommendation severity checks for CI with `--budget` and `--fail-on`.
- Redact secrets from a HAR and from the report before sharing.
- Keep the median run of a WebPageTest HAR and report the spread across runs.
- Attribute the LCP and find the render-blocking resources from the trace.
- Audit compression and image formats, and protocol and connection reuse per host.
- Report duplicate requests, redirects, failed requests and mixed content.
- Show parse errors in the web app.

### Changed

- Require Node 22.
- Upgrade to React 19 and Ink 8.
- Bundle Ink and React into the CLI so the package installs with no dependencies.
- Say when a connection was reused, measure TTFB from navigation and use host medians.
- Describe the package as a HAR analyzer and show `htv` in the README.

### Fixed

- Stop giving wrong cache, preconnect and GFW advice.
- Count TLS once, transfer bytes on the wire and network requests apart from cache hits.
- Follow redirects to the document, join repeated headers and read Vercel's function region.

## [0.1.1] - 2026-11-01

### Changed

- Take HAR and trace files as positional arguments.
- Lay the terminal report out as framed panels.
- Publish to npm with trusted publishing instead of a token.

## [0.1.0] - 2026-10-30

### Added

- A step diagram of a page load built from a HAR and an optional trace, with per-node resource stats, in a web app and in a self-contained HTML report written by the CLI (`--bundle`, multi-page support).
- A terminal report to browse in the TUI, and JSON output.
- A per-page metrics summary with Core Web Vitals ratings, including CLS and INP.
- A cache analysis panel with CDN and browser cache reporting.
- A Hops panel with the CDN, PoP and handshake cost of every host; CDN detection covers eleven more providers, `Cache-Status` and a PoP table.
- Third parties drawn as one node per CDN provider and region.
- A side by side comparison of two flows with aligned steps and deltas.
- Page selection for a multi-page HAR.
- Export of the diagram as SVG or PNG.
- Keyboard navigation of the diagram, light mode and `prefers-reduced-motion` support.
- Self-hosted subset fonts; bundled reports work offline.
- HAR and trace parsing in a Web Worker.

[Unreleased]: https://github.com/nucliweb/har-trace-viewer/compare/v0.27.0...HEAD
[0.27.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.18.1...v0.19.0
[0.18.1]: https://github.com/nucliweb/har-trace-viewer/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.17.1...v0.18.0
[0.17.1]: https://github.com/nucliweb/har-trace-viewer/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/nucliweb/har-trace-viewer/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/nucliweb/har-trace-viewer/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/nucliweb/har-trace-viewer/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.6.5...v0.7.0
[0.6.5]: https://github.com/nucliweb/har-trace-viewer/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/nucliweb/har-trace-viewer/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/nucliweb/har-trace-viewer/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/nucliweb/har-trace-viewer/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/nucliweb/har-trace-viewer/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/nucliweb/har-trace-viewer/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/nucliweb/har-trace-viewer/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/nucliweb/har-trace-viewer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nucliweb/har-trace-viewer/releases/tag/v0.1.0
