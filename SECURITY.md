# Security policy

## Reporting a vulnerability

Report a suspected vulnerability privately with GitHub's private vulnerability reporting. Open the Security tab of [nucliweb/har-trace-viewer](https://github.com/nucliweb/har-trace-viewer/security) and choose "Report a vulnerability". Do not open a public issue or pull request for it.

## Supported versions

Only the latest release of `har-trace-viewer` on npm is supported.

## Data handled by the tool

HAR files and Chrome traces can contain cookies, `Authorization` headers, tokens and personal data. A HAR also holds response bodies, and its URLs can carry session ids, tokens and email addresses.

htv runs locally and works offline. Nothing is uploaded: the web app parses the files in the browser.

Before you share a capture, or attach one to an issue, remove what should not leave your machine:

- `htv redact <file.har> -o <out.har> --mask-hosts` writes a copy of the HAR that is still valid and keeps the timings. It drops the response bodies, masks cookie values, replaces the values of `Authorization` and similar headers, and redacts sensitive URL values. `--mask-hosts` also masks third-party hostnames.
- The web app masks secrets in everything it shows and exports, and its Export menu can also mask third-party hostnames in the CSV, Markdown and Mermaid exports. Images are not covered.

Redaction follows rules. A secret in a path segment, in a header whose name does not say so, or in a URL encoded inside a query value can get through. Read the output before you share it. The [sharing a report safely](README.md#sharing-a-report-safely) section of the README describes what each option removes.
