import { describe, expect, it } from "vitest";
import { formatCheckResult, githubEscape, parseCheckFormat, xmlEscape } from "../src/check-format";
import { formatChecks } from "../src/budget";
import type { CheckResult } from "../src/budget";

const result: CheckResult = {
  budgets: [
    { page: "Home", metric: "lcp", limit: 2500, actual: 3000, passed: false },
    { page: "Home", metric: "requests", limit: 80, actual: 40, passed: true },
    { page: "Home", metric: "inp", limit: 200, actual: null, passed: true },
    {
      page: "A: Home vs B: Home",
      metric: "transfer",
      limit: 10,
      actual: 15,
      baseline: 1000,
      candidate: 1150,
      passed: false,
      mode: "delta-percent",
    },
  ],
  failOn: "warning",
  findings: [
    { page: "Home", source: "cache", id: "x<y", title: 'Bad "cache" & more', severity: "warning" },
    { page: "Home", source: "cwv", id: "lcp", title: "LCP poor", severity: "critical" },
  ],
  passed: false,
};

const passing: CheckResult = { budgets: [result.budgets[1]], findings: [], passed: true };

describe("parseCheckFormat", () => {
  it("accepts the four names and rejects others", () => {
    expect(parseCheckFormat("junit")).toBe("junit");
    expect(() => parseCheckFormat("xml")).toThrow(
      /Invalid --check-format "xml".*text, json, junit, github/
    );
  });
});

describe("text", () => {
  it("is the existing table", () => {
    expect(formatCheckResult(result, "text")).toBe(formatChecks(result));
  });
});

describe("json", () => {
  const json = JSON.parse(formatCheckResult(result, "json"));

  it("has the documented shape", () => {
    expect(json.passed).toBe(false);
    expect(json.failOn).toBe("warning");
    expect(json.summary).toEqual({
      budgets: { total: 4, passed: 1, failed: 2, skipped: 1 },
      findings: 2,
    });
    expect(json.budgets[0]).toEqual({
      page: "Home",
      metric: "lcp",
      operator: "<=",
      limit: 2500,
      actual: 3000,
      unit: "ms",
      status: "failed",
      type: "value",
    });
    expect(json.budgets[2]).toMatchObject({ actual: null, status: "skipped" });
    expect(json.budgets[3]).toEqual({
      page: "A: Home vs B: Home",
      metric: "transfer",
      operator: "<=",
      limit: 10,
      actual: 15,
      unit: "percent",
      status: "failed",
      type: "delta",
      baseline: 1000,
      candidate: 1150,
    });
    expect(json.findings[0]).toEqual({
      page: "Home",
      severity: "warning",
      source: "cache",
      id: "x<y",
      title: 'Bad "cache" & more',
    });
  });

  it("has failOn null and no findings without --fail-on", () => {
    const p = JSON.parse(formatCheckResult(passing, "json"));
    expect(p).toMatchObject({ passed: true, failOn: null, findings: [] });
  });
});

describe("junit", () => {
  const xml = formatCheckResult(result, "junit");

  it("has one testsuite and a testcase per check", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<testsuite name="htv checks" tests="6" failures="4" skipped="1">');
    expect(xml.match(/<testcase /g)).toHaveLength(6);
    expect(xml.match(/<failure /g)).toHaveLength(4);
    expect(xml).toContain("<skipped");
  });

  it("escapes XML in names and messages", () => {
    expect(xml).toContain("Bad &quot;cache&quot; &amp; more");
    expect(xml).not.toContain('Bad "cache" & more');
    expect(xmlEscape('<a href="x">&\u0001</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("is a passing suite without failures", () => {
    const ok = formatCheckResult(passing, "junit");
    expect(ok).toContain('failures="0"');
    expect(ok).not.toContain("<failure");
  });

  it("records a passing case when --fail-on found nothing", () => {
    const clean = formatCheckResult({ ...passing, failOn: "warning" }, "junit");
    expect(clean).toContain('name="no warning or worse findings"');
    expect(clean).toContain('failures="0"');
  });
});

describe("github", () => {
  it("emits an error per failure, a warning per warning finding and a notice per skipped budget", () => {
    const lines = formatCheckResult(result, "github").split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^::error title=Budget lcp \(Home\)::/);
    expect(lines.filter((l) => l.startsWith("::error"))).toHaveLength(3);
    expect(lines.filter((l) => l.startsWith("::warning"))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("::notice"))).toHaveLength(1);
  });

  it("emits a notice when all pass", () => {
    expect(formatCheckResult(passing, "github")).toBe(
      "::notice title=htv checks::All checks passed."
    );
  });

  it("escapes data and properties per the workflow command rules", () => {
    expect(githubEscape("a%b\r\nc", false)).toBe("a%25b%0D%0Ac");
    expect(githubEscape("a:b,c%\n", true)).toBe("a%3Ab%2Cc%25%0A");
  });
});
