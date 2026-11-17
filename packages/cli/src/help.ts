import { CLIENT_REGIONS } from "@htv/core";

export const USAGE = `Usage: htv <file.har[.gz]> [<trace.json[.gz]>] [-o <dir|file.html|file.json>] [--format tui|html|json|findings|markdown|csv|mermaid] [options]
       htv --page <name> --har <file.har[.gz]> [--trace <file.json[.gz]>] [--page <name> ...] [options]
       htv redact <file.har[.gz]> [-o <out.har[.gz]>] [--mask-hosts]
       htv completion bash|zsh|fish    (print a shell completion script)
       htv --demo    (the built-in example, no file needed)`;

export const HELP = `${USAGE}

Analyzes HAR and Chrome trace files: browses the report in the terminal, writes a
self-contained HTML report to share, or writes JSON for other tools and AI agents.

Output (where the report goes):
  (no --output)       Browse the report in the terminal: findings, waterfall,
                      metrics, steps, hosts and cache & network, one tab each.
                      Needs an interactive terminal.
  -o, --output <path> file.html: a single self-contained HTML file that opens offline.
                      file.json: the full analysis as JSON.
                      file.md, file.csv: the markdown or CSV text export (below).
                      Any other path: a directory with index.html and its assets.
  --format <format>   tui | html | json | findings | markdown | csv | mermaid.
                      --format json without --output prints the JSON to stdout,
                      e.g. to pipe it into an agent.
                      --format findings writes only the findings of each page (rule
                      id, severity, metric, summary, recommendation, evidence) and its
                      metrics as compact JSON, to stdout or a .json --output.
                      --format markdown writes a report to paste into a ticket or a
                      doc (metrics, findings and hosts per page; a comparison table
                      first for two sides), to stdout or a .md --output (-o file.md
                      alone picks it). --format csv writes one row per request of
                      every page, as RFC 4180 CSV, to stdout or a .csv --output.
                      --format mermaid writes a sequence diagram of the document
                      request per page (Browser, CDN edge, origin), to stdout or a
                      .md, .mmd or .mermaid --output.
  --bundle            For a directory --output: inline every asset into index.html.
  --redact[=mask-hosts]
                      Every report masks the secrets of URLs, titles and headers
                      as the files are read: query values with a sensitive name
                      (token, session, email...) or that look like a token,
                      credentials in URLs, emails and JWTs. --redact applies the
                      same rules once more to all the report holds, page names
                      included, before it is written or shown, in every format,
                      numbering what it masks. =mask-hosts also replaces
                      third-party hostnames with host-N.redacted. Prints the
                      counts on stderr. Timings, sizes and the analysis stay the
                      same.
  htv redact <file.har[.gz]> [-o <out.har[.gz]>] [--mask-hosts]
                      Write a redacted copy of the HAR itself, still a valid HAR:
                      bodies dropped (sizes kept), cookie values masked, credential
                      headers (Authorization, *token*, *session*...) replaced, and
                      the rules of --redact on URLs, headers and titles. Prints the
                      HAR to stdout without -o.

Input:
  --demo              Report the built-in example instead of a recording: one page
                      of a real site with its Chrome trace. Needs no file, and goes
                      to any output (htv --demo, htv --demo -o demo.html,
                      htv --demo --format markdown).
  <file>              A HAR (.har or .har.gz) or a Chrome trace (.json or .json.gz)
                      given without its flag, attached to the preceding --page.
                      A HAR with another extension needs --har.
  --page <name>       Start a page in the report; repeat once per page.
                      The following files, --har and --trace attach to it.
  --har <file>        HAR file for the preceding --page (.har or .har.gz).
                      Without a --page, a page named "Page 1" is created.
  --trace <file>      Chrome trace for the preceding --page (.json or .json.gz).
  --select <value>    For the preceding --har with several pages (e.g. WebPageTest
                      runs): keep only the matching pages. A page id, a comma-
                      separated list of ids, or text/regex matched against id,
                      title and URL ("Run 1, First"). Default: all pages, but
                      only the median run of a WebPageTest HAR (see --runs).
  --runs <median|all|N>
                      For the preceding --har with several WebPageTest runs:
                      median keeps the median run of each view (first, repeat)
                      and step, ranked by LCP (else onLoad, else DCL), named
                      "median of N runs", with the min, median and max of every
                      metric over the runs. median:<metric> ranks by another
                      metric (ttfb, fcp, lcp, dcl, onload, ...). all keeps every
                      run, N keeps run N. Default: median without --select, all
                      with it; with both, the median of the selected pages.
  --list-pages        Print the pages (id, title, entries) of each --har and exit.
                      With --format json, print { files: [{ file, pages: [{ id,
                      title, url, entries }] }] } instead.
  -                   As the HAR (htv - --format csv, or --har -): read it from
                      stdin, gzipped or not, e.g. cat page.har | htv - --format csv.
                      The terminal report needs a terminal, so pass --format or -o.
                      A HAR only, once per run.
  --filter <query>    With --format csv or json: keep only the requests matching the
                      query, the language of the waterfall filter: free text matches
                      the URL; type:js, domain:cdn.*, status:4xx, method:post,
                      larger-than:100k, party:third, is:render-blocking...; a leading -
                      negates (write --filter=-type:image, as a value cannot start
                      with a dash otherwise). In JSON it narrows har.entries of each
                      page; the metrics and findings still describe the whole capture.
                      Any other format is an error; an invalid query exits 1.

Comparison:
  --compare           Compare the two pages of the flow instead of chaining them:
                      the first page is A (top), the second B (bottom). The flow
                      must have exactly two pages, e.g. a WebPageTest first view
                      and repeat view picked with --select.
  --compare-with <file>
                      Compare the flow (A, one page) with another HAR (B).
  --compare-trace <file>
                      Chrome trace for the --compare-with HAR.
  --compare-select <value>
                      Page of a multi-page --compare-with HAR, as --select.
  --compare-region <id>
                      Client network region of B, as --region is A's. Each side
                      without one takes the region its own latencies suggest, so a
                      load from China can be compared with one from elsewhere.

CI checks (each page, both sides of a comparison; the result goes to stderr after
the report, or to stdout without --output instead of the terminal report):
  --budget <metric>=<value>[,<metric>=<value>...]
                      Fail when a page goes over a limit; repeatable. Metrics:
                      ttfb, server-wait, fcp, lcp, dcl, onload, inp, tbt in ms
                      (2500, 2500ms or 2.5s); cls (0.1); requests (80);
                      transfer in bytes (500000, 500kb, 1.5mb; 1 kb = 1000 B);
                      cdn-hit-ratio and cache-hit-ratio as minimums (0.9 or 90%).
                      delta:<metric><=<value> limits how much worse B may be than A
                      in a comparison (--compare or --compare-with): delta:lcp<=200,
                      or a percentage of A, delta:transfer<=10%; a hit ratio delta is
                      in points (delta:cdn-hit-ratio<=5%).
  --check-format <format>
                      text | json | junit | github: the format of the check result.
                      github prints ::error and ::warning workflow commands, which
                      show as annotations on the run. Default: text.
  --check-output <path>
                      Also write the check result, in --check-format, to a file; the
                      terminal keeps the text result.
  --budget-strict     Fail a budget whose metric the page lacks (LCP without a
                      trace); by default it passes as n/a.
  --fail-on <severity>
                      critical | warning: fail when a finding of that severity or
                      worse exists: a recommendation of the cache, network or
                      other reports, or a Core Web Vital or TTFB rated poor
                      (critical) or needing improvement (warning).
  Exit codes: 0 every check passed, 2 a check failed (the report is still
  written), 1 usage or input errors.

Terminal report and diagnostics:
  --no-mouse          Start the terminal report without mouse reporting, which leaves
                      the terminal's own text selection alone. By default the wheel
                      scrolls, a click picks a tab or a request, and the m key turns
                      the mouse off and on.
  --debug             Write diagnostics to stderr: the input detected (HAR or trace,
                      gzip), the pages, the timings of the phases and the full stack
                      trace of an error. stdout stays as it is.

Other:
  --region <id>       Client network region: ${CLIENT_REGIONS.join(" | ")}. "cn" draws the
                      Great Firewall before the first server. Without --region, cn when
                      the latencies look compatible with China/GFW routing, else default.
                      In a comparison it is A's region (--compare-region is B's).
  -h, --help          Show this help.
  -v, --version       Show the version.

Examples:
  htv page.har                                # browse in the terminal
  htv page.har trace.json.gz -o report.html   # share one HTML file, with a trace
  htv page.har --format json | my-agent       # JSON for an AI agent
  htv page.har trace.json.gz --format findings # what to fix, as compact JSON

  # Two pages, with a trace for the first one:
  htv --page "Home" --har home.har --trace home.json.gz \
      --page "Checkout" --har checkout.har -o report.html

  # WebPageTest first view vs repeat view, i.e. without and with cache:
  htv --har wpt.har --select page_1_0_1,page_1_1_1 --compare -o compare.html

  # CI: exit 2 when LCP goes over 2.5 s, the page over 1.5 MB or a warning shows up:
  htv page.har trace.json.gz --budget lcp=2.5s,transfer=1.5mb --fail-on warning

Without --bundle a directory report loads ES modules from assets/, which browsers
block over file://; serve the folder over HTTP (npx serve report/) or write a
.html file, which opens by double-click.`;

export function printUsage() {
  console.error(USAGE);
}
