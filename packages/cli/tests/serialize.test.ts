import { describe, it, expect } from "vitest";
import { serializeFlowForHtml, buildFlowInjection } from "../src/serialize";

const hostileFlow = {
  url: "https://example.com/</script><script>document.title='x'</script>",
  comment: "<!-- start & end -->",
  header: "a & b",
  separators: "line\u2028para\u2029end",
  nested: [{ value: "</SCRIPT>" }],
};

describe("serializeFlowForHtml", () => {
  it("round-trips through JSON.parse", () => {
    expect(JSON.parse(serializeFlowForHtml(hostileFlow))).toEqual(hostileFlow);
  });

  it("emits no literal <, >, & or line/paragraph separators", () => {
    const out = serializeFlowForHtml(hostileFlow);
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
  });

  it("produces an injection without a closing script tag inside the payload", () => {
    const injection = buildFlowInjection(hostileFlow);
    const inner = injection.slice("<script>".length, -"</script>".length);
    expect(inner.toLowerCase()).not.toContain("</script");
    expect(injection.match(/<\/script/gi)).toHaveLength(1);
  });
});
