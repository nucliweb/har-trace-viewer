import { describe, expect, it } from "vitest";
import { classifyRecordingFile, planDrop } from "../src/components/flow-builder/drop-plan.js";
import { makeEntry } from "../src/components/flow-builder/page-entry.js";
import type { PageEntry } from "../src/components/flow-builder/page-entry.js";
import { makeFile } from "./fixtures.js";

const file = (name: string) => makeFile("{}", name);
const row = (id: string, patch: Partial<PageEntry> = {}): PageEntry => ({
  ...makeEntry(),
  id,
  ...patch,
});
// Stand-ins for parsed recordings: the plan only looks at whether a slot is filled.
const har = [{}] as unknown as PageEntry["har"];
const trace = {} as unknown as PageEntry["trace"];
const names = (plan: ReturnType<typeof planDrop>) =>
  plan.map((p) => [p.rowId, p.har?.name, p.trace?.name]);

describe("classifyRecordingFile", () => {
  it.each([
    ["site.har", "har"],
    ["site.har.gz", "har"],
    ["trace.json", "trace"],
    ["Trace.JSON.GZ", "trace"],
    ["notes.txt", "har"],
  ])("%s is a %s", (name, kind) => {
    expect(classifyRecordingFile(file(name))).toBe(kind);
  });
});

describe("planDrop", () => {
  it("puts a HAR and its trace dropped together in the same row", () => {
    const plan = planDrop([file("a.json"), file("a.har")], [row("r1")], "r1");
    expect(names(plan)).toEqual([["r1", "a.har", "a.json"]]);
  });

  it("makes a new row for each further HAR, pairing the traces by order", () => {
    const plan = planDrop(
      [file("1.har"), file("2.har"), file("t1.json"), file("t2.json")],
      [row("r1")],
      "r1"
    );
    expect(names(plan)).toEqual([
      ["r1", "1.har", "t1.json"],
      [undefined, "2.har", "t2.json"],
    ]);
  });

  it("gives a trace with no HAR in the drop a row of its own after the others", () => {
    const plan = planDrop([file("1.har"), file("t1.json"), file("t2.json")], [row("r1")], "r1");
    expect(names(plan)).toEqual([
      ["r1", "1.har", "t1.json"],
      [undefined, undefined, "t2.json"],
    ]);
  });

  it("sends a lone trace to the row it was dropped on", () => {
    const plan = planDrop([file("t.json")], [row("r1", { har }), row("r2")], "r2");
    expect(names(plan)).toEqual([["r2", undefined, "t.json"]]);
  });

  it("without a target, fills the rows still lacking a HAR before adding rows", () => {
    const rows = [row("r1", { har }), row("r2"), row("r3", { trace })];
    const plan = planDrop([file("1.har"), file("2.har"), file("3.har")], rows);
    expect(names(plan).map(([id]) => id)).toEqual(["r2", "r3", undefined]);
  });

  it("without a target, a lone trace goes to a row with a HAR and no trace", () => {
    const rows = [row("r1", { har, trace }), row("r2", { har }), row("r3")];
    expect(names(planDrop([file("t.json")], rows))).toEqual([["r2", undefined, "t.json"]]);
  });

  it("without a target, a lone trace falls back to an empty row, then to a new one", () => {
    expect(names(planDrop([file("t.json")], [row("r1", { har, trace }), row("r2")]))).toEqual([
      ["r2", undefined, "t.json"],
    ]);
    expect(names(planDrop([file("t.json")], [row("r1", { har, trace })]))).toEqual([
      [undefined, undefined, "t.json"],
    ]);
  });

  it("plans nothing for an empty drop", () => {
    expect(planDrop([], [row("r1")])).toEqual([]);
  });
});
