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

describe("buildFlowInjection — comparison", () => {
  it("adds the second flow in a script of its own only when given", () => {
    expect(buildFlowInjection({ a: 1 })).not.toContain("__HTV_COMPARE__");

    const injection = buildFlowInjection({ a: 1 }, { b: "</script>" });

    expect(injection.match(/<script>/g)).toHaveLength(2);
    const compare = injection.match(/window\.__HTV_COMPARE__ = (.*?);<\/script>/s)![1];
    expect(JSON.parse(compare)).toEqual({ b: "</script>" });
  });
});
