# Changelog

All notable changes to `har-trace-viewer` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions 0.3.0, 0.4.0, 0.4.1 and 0.5.0 were tagged but not published to npm; their changes reached npm with 0.6.0.

## [Unreleased]

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

[Unreleased]: https://github.com/nucliweb/har-trace-viewer/compare/v0.9.0...HEAD
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
