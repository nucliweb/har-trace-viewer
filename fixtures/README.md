# Recordings

Real captures that tests and the e2e setup read by path. `fixtures/` is not in `.gitignore`, so a new recording shows up in `git status`.

| File | Site | Date | Tool | Cache state |
| --- | --- | --- | --- | --- |
| `webperf-snippets.nucliweb.net_Cache-20260519T123746.har` | webperf-snippets.nucliweb.net | 2026-05-19 | Chrome DevTools HAR export (`WebInspector`) | Warm: 31 of 34 entries served from the browser cache |
| `webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har` | webperf-snippets.nucliweb.net | 2026-05-19 | Chrome DevTools HAR export (`WebInspector`) | Cold: "Disable cache" on, every entry hit the network |
| `WebPerf-Snippets-Cache_Trace-20260519T123746.json.gz` | webperf-snippets.nucliweb.net | 2026-05-19 | Chrome DevTools performance trace | Matches the warm HAR |
| `WebPerf-Snippets-Disable-Cache_Trace-20260519T123602.json.gz` | webperf-snippets.nucliweb.net | 2026-05-19 | Chrome DevTools performance trace | Matches the cold HAR |

## Adding a recording

Strip `content.text` (and `request.postData.text`) first: response bodies are about 95% of a HAR and no analyzer reads them.

```sh
node packages/core/scripts/trim-har.mjs recording.har recording.trimmed.har
```

Then add a row to the table above (site, date, tool, cache state). Small hand-built fixtures for unit tests live in `packages/core/tests/fixtures/`.
