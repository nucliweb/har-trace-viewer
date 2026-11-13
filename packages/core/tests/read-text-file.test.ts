import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTextFile } from "../src/parsers/trace-parser-node.js";

describe("readTextFile", () => {
  it("rejects with the ENOENT error of a missing .gz file instead of an unhandled event", async () => {
    await expect(readTextFile(join(tmpdir(), "htv-missing-file.har.gz"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
