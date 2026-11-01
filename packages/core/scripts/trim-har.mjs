#!/usr/bin/env node
// Removes response bodies (`response.content.text`) and request bodies (`request.postData.text`)
// from every entry of a HAR and keeps everything else, written as 2-space JSON.
//
// Usage: node trim-har.mjs <input.har> [output.har]
// Without an output path the trimmed HAR goes to stdout.
import { readFileSync, writeFileSync } from "node:fs";

function trimHar(har) {
  for (const entry of har.log?.entries ?? []) {
    if (entry.response?.content && "text" in entry.response.content) {
      delete entry.response.content.text;
    }
    if (entry.request?.postData && "text" in entry.request.postData) {
      delete entry.request.postData.text;
    }
  }
  return har;
}

const [input, output] = process.argv.slice(2);
if (input === undefined) {
  console.error("Usage: trim-har.mjs <input.har> [output.har]");
  process.exit(1);
}
const raw = readFileSync(input, "utf8");
const trimmed = `${JSON.stringify(trimHar(JSON.parse(raw)), null, 2)}\n`;
if (output === undefined) {
  process.stdout.write(trimmed);
} else {
  writeFileSync(output, trimmed);
  console.error(`${input}: ${raw.length} -> ${trimmed.length} bytes`);
}
