import { budgetOperator, budgetRow, formatChecks, metricUnit } from "./budget";
import type { BudgetResult, CheckResult } from "./budget";

/** The formats of the check result (--check-format). */
const CHECK_FORMATS = ["text", "json", "junit", "github"] as const;
export type CheckFormat = (typeof CHECK_FORMATS)[number];

export function parseCheckFormat(value: string | undefined): CheckFormat {
  if ((CHECK_FORMATS as readonly string[]).includes(value ?? "")) return value as CheckFormat;
  throw new Error(
    `Invalid --check-format "${value ?? ""}". Valid values: ${CHECK_FORMATS.join(", ")}.`
  );
}

type BudgetStatus = "passed" | "failed" | "skipped";

/** A budget a page cannot provide passes as skipped; a failed one is failed, strict or not. */
const budgetStatus = (b: BudgetResult): BudgetStatus =>
  !b.passed ? "failed" : b.actual === null ? "skipped" : "passed";

/** One line saying what a budget measured against its limit, for a failure or annotation message. */
function budgetMessage(b: BudgetResult): string {
  const [, page, metric, actual, limit, note] = budgetRow(b);
  return `${page}: ${metric} ${actual}, limit ${limit}${note ? `; ${note}` : ""}`;
}

/**
 * The check result as JSON:
 *
 * ```
 * { passed, failOn, summary: { budgets: { total, passed, failed, skipped }, findings },
 *   budgets: [{ page, metric, operator, limit, actual, unit, status, type, baseline?, candidate? }],
 *   findings: [{ page, severity, source, id, title }] }
 * ```
 *
 * `status` is `passed`, `failed` or `skipped` (the page cannot provide the metric and
 * --budget-strict is absent; `actual` is then null). `type` is `value` for a page checked against
 * a limit, or `delta` for a `delta:` budget, whose `actual` is how much worse B is than A in the
 * `unit` (`percent` for a percentage of A) and which carries the `baseline` (A) and `candidate` (B).
 * Units are `ms`, `bytes`, `count`, `score`, `ratio` and `percent`; `limit` and `actual` are in them.
 * `findings` lists those that reached `failOn`; `failOn` is null without --fail-on.
 */
function formatJson(result: CheckResult): string {
  const budgets = result.budgets.map((b) => ({
    page: b.page,
    metric: b.metric,
    operator: budgetOperator(b),
    limit: b.limit,
    actual: b.actual,
    unit: b.mode === "delta-percent" ? "percent" : metricUnit(b.metric),
    status: budgetStatus(b),
    type: b.mode ? "delta" : "value",
    ...(b.mode ? { baseline: b.baseline ?? null, candidate: b.candidate ?? null } : {}),
  }));
  const count = (status: BudgetStatus) => budgets.filter((b) => b.status === status).length;
  return JSON.stringify(
    {
      passed: result.passed,
      failOn: result.failOn ?? null,
      summary: {
        budgets: {
          total: budgets.length,
          passed: count("passed"),
          failed: count("failed"),
          skipped: count("skipped"),
        },
        findings: result.findings.length,
      },
      budgets,
      findings: result.findings.map(({ page, severity, source, id, title }) => ({
        page,
        severity,
        source,
        id,
        title,
      })),
    },
    null,
    2
  );
}

/** Escapes the text of an XML document; characters XML 1.0 forbids are dropped. */
export function xmlEscape(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

interface TestCase {
  classname: string;
  name: string;
  /** A failure message, or "skipped" with the reason. */
  failure?: string;
  failureType?: "budget" | "finding";
  skipped?: string;
}

/** One testsuite: a testcase per budget and per failing finding, or one for no failing findings. */
function formatJunit(result: CheckResult): string {
  const cases: TestCase[] = result.budgets.map((b) => {
    const status = budgetStatus(b);
    const [, page, metric, , limit] = budgetRow(b);
    return {
      classname: page,
      name: `${metric} ${budgetOperator(b)} ${limit.replace(/^(<=|>=) /, "")}`,
      ...(status === "failed" ? { failure: budgetMessage(b), failureType: "budget" as const } : {}),
      ...(status === "skipped" ? { skipped: budgetMessage(b) } : {}),
    };
  });
  if (result.failOn) {
    if (result.findings.length === 0) {
      cases.push({ classname: "findings", name: `no ${result.failOn} or worse findings` });
    }
    for (const f of result.findings) {
      cases.push({
        classname: f.page,
        name: `${f.severity} ${f.source}: ${f.title}`,
        failure: `${f.page}: ${f.severity} ${f.source}: ${f.title}`,
        failureType: "finding",
      });
    }
  }
  const failures = cases.filter((c) => c.failure !== undefined).length;
  const skipped = cases.filter((c) => c.skipped !== undefined).length;
  const body = cases.map((c) => {
    const attrs = `classname="${xmlEscape(c.classname)}" name="${xmlEscape(c.name)}"`;
    if (c.failure !== undefined) {
      return `    <testcase ${attrs}>\n      <failure message="${xmlEscape(c.failure)}" type="${c.failureType}">${xmlEscape(c.failure)}</failure>\n    </testcase>`;
    }
    if (c.skipped !== undefined) {
      return `    <testcase ${attrs}>\n      <skipped message="${xmlEscape(c.skipped)}"/>\n    </testcase>`;
    }
    return `    <testcase ${attrs}/>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<testsuites>",
    `  <testsuite name="htv checks" tests="${cases.length}" failures="${failures}" skipped="${skipped}">`,
    ...body,
    "  </testsuite>",
    "</testsuites>",
  ].join("\n");
}

/** Escapes a GitHub Actions workflow command: `%`, CR and LF, and for a property `:` and `,` too. */
export function githubEscape(text: string, property: boolean): string {
  const data = text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return property ? data.replace(/:/g, "%3A").replace(/,/g, "%2C") : data;
}

const command = (level: "error" | "warning" | "notice", title: string, message: string) =>
  `::${level} title=${githubEscape(title, true)}::${githubEscape(message, false)}`;

/** Workflow commands: an annotation per failed budget and finding, a notice per skipped budget. */
function formatGithub(result: CheckResult): string {
  const lines: string[] = [];
  for (const b of result.budgets) {
    const status = budgetStatus(b);
    if (status === "passed") continue;
    const [, page, metric] = budgetRow(b);
    lines.push(
      command(
        status === "failed" ? "error" : "notice",
        `Budget ${metric} (${page})`,
        budgetMessage(b)
      )
    );
  }
  for (const f of result.findings) {
    lines.push(
      command(
        f.severity === "critical" ? "error" : "warning",
        `Finding ${f.id} (${f.page})`,
        `${f.page}: ${f.severity} ${f.source}: ${f.title}`
      )
    );
  }
  if (result.passed && lines.every((l) => l.startsWith("::notice"))) {
    lines.push(command("notice", "htv checks", "All checks passed."));
  }
  return lines.join("\n");
}

/** The check result in the format --check-format asks for. */
export function formatCheckResult(result: CheckResult, format: CheckFormat): string {
  switch (format) {
    case "text":
      return formatChecks(result);
    case "json":
      return formatJson(result);
    case "junit":
      return formatJunit(result);
    case "github":
      return formatGithub(result);
  }
}
