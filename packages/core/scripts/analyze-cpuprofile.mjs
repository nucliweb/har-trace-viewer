#!/usr/bin/env node
// Reads a V8 .cpuprofile (from `node --cpu-prof` or `bench.mjs --cpu-profile`) and prints the
// functions with the most self time, then the inclusive time (the function and everything it
// calls) of the functions named in --include.
//
// With --callers, it also lists the functions that call the named one, by the self time spent
// in it under each caller.
//
// Usage: node analyze-cpuprofile.mjs <file.cpuprofile> [--top 10] [--include a,b,c]
//                                    [--callers name] [--under name]
//
// With --under, only the samples taken while the named function is on the stack count, and the
// shares are of that time.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
const [file] = args;
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
if (file === undefined || file.startsWith("--")) {
  console.error(
    "Usage: analyze-cpuprofile.mjs <file.cpuprofile> [--top 10] [--include a,b,c] [--callers name] [--under name]"
  );
  process.exit(1);
}
const top = Number(option("--top") ?? 10);
const include = (option("--include") ?? "").split(",").filter(Boolean);
const callersOf = option("--callers");
const underName = option("--under");

const profile = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const parentOf = new Map();
for (const node of profile.nodes) {
  for (const child of node.children ?? []) parentOf.set(child, node.id);
}

const labelOf = (node) => {
  const { functionName, url, lineNumber } = node.callFrame;
  const name = functionName === "" ? "(anonymous)" : functionName;
  return url === "" ? name : `${name} ${basename(url)}:${lineNumber + 1}`;
};

const stackHas = (id, name) => {
  for (let at = id; at !== undefined; at = parentOf.get(at)) {
    if (byId.get(at).callFrame.functionName === name) return true;
  }
  return false;
};

// Microseconds per sample: the delta to the next sample.
const self = new Map();
const inclusive = new Map(); // function name -> µs
const callers = new Map(); // caller label -> µs of self time in the --callers function
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const us = profile.timeDeltas[i + 1] ?? profile.timeDeltas[i];
  const leaf = byId.get(profile.samples[i]);
  if (underName !== null && !stackHas(leaf.id, underName)) continue;
  total += us;
  const label = labelOf(leaf);
  if (callersOf !== null && leaf.callFrame.functionName === callersOf) {
    const parent = byId.get(parentOf.get(leaf.id));
    const caller = parent ? labelOf(parent) : "(root)";
    callers.set(caller, (callers.get(caller) ?? 0) + us);
  }
  self.set(label, (self.get(label) ?? 0) + us);
  // Each function counts once per sample, however deep it recurses.
  const seen = new Set();
  for (let id = leaf.id; id !== undefined; id = parentOf.get(id)) {
    const name = byId.get(id).callFrame.functionName;
    if (seen.has(name)) continue;
    seen.add(name);
    inclusive.set(name, (inclusive.get(name) ?? 0) + us);
  }
}

const share = (us) => `${((us / total) * 100).toFixed(1).padStart(5)}%`;
const msOf = (us) => (us / 1000).toFixed(0).padStart(7);

console.log(`Sampled time: ${(total / 1000).toFixed(0)} ms (idle included)\n`);
console.log(`Top ${top} by self time`);
for (const [label, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top)) {
  console.log(`${msOf(us)} ms ${share(us)}  ${label}`);
}
if (include.length > 0) {
  console.log("\nInclusive time (the function and what it calls)");
  for (const name of include) {
    const us = inclusive.get(name) ?? 0;
    console.log(`${msOf(us)} ms ${share(us)}  ${name}`);
  }
}
if (callersOf !== null) {
  console.log(`\nSelf time of ${callersOf} by caller`);
  for (const [label, us] of [...callers].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`${msOf(us)} ms ${share(us)}  ${label}`);
  }
}
