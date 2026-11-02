import { identifyThirdParty } from "./third-party-entities.js";
import { getRootDomain } from "../utils/domain.js";
import { formatMs } from "../utils/format.js";
import type {
  MainThreadParty,
  MainThreadReport,
  MainThreadScript,
  ParsedHar,
  ParsedTrace,
  Recommendation,
  RecommendationResource,
  ScriptParty,
  ScriptTime,
} from "../types.js";

// Lighthouse's lab thresholds for the Total Blocking Time.
const TBT_WARNING_MS = 200;
const TBT_CRITICAL_MS = 600;
// Third-party scripts past this much main-thread time, or this much blocking, are worth a finding.
const THIRD_PARTY_WARNING_MS = 250;
const THIRD_PARTY_BLOCKING_MS = 100;
const MAX_SCRIPTS = 20;
const MAX_RESOURCES = 8;
const EXTENSIONS = "Browser extensions";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function describeScript(script: ScriptTime, documentRoot: string): MainThreadScript {
  if (script.url.startsWith("chrome-extension://")) {
    return { ...script, party: "extension", entity: EXTENSIONS };
  }
  if (getRootDomain(script.url) === documentRoot) {
    return { ...script, party: "first", entity: documentRoot };
  }
  return { ...script, party: "third", entity: identifyThirdParty(script.url).name };
}

function partiesOf(scripts: MainThreadScript[]): MainThreadParty[] {
  const parties = new Map<string, MainThreadParty>();
  for (const script of scripts) {
    const key = `${script.party}:${script.entity}`;
    const party = parties.get(key) ?? {
      entity: script.entity,
      party: script.party,
      ...(script.party === "third" ? { category: identifyThirdParty(script.url).category } : {}),
      ms: 0,
      blockingMs: 0,
      scripts: 0,
    };
    party.ms += script.ms;
    party.blockingMs += script.blockingMs;
    party.scripts += 1;
    parties.set(key, party);
  }
  return [...parties.values()].sort((a, b) => b.ms - a.ms);
}

// ── Recommendations ──────────────────────────────────────────────────────────

const transferSizeOf = (har: ParsedHar, url: string) =>
  har.entries.find((e) => e.url === url)?.transferSize ?? 0;

function scriptResources(har: ParsedHar, scripts: MainThreadScript[]): RecommendationResource[] {
  return scripts.slice(0, MAX_RESOURCES).map((s) => ({
    url: s.url,
    transferSize: transferSizeOf(har, s.url),
    detail: `${formatMs(s.ms)} on the main thread · ${formatMs(s.blockingMs)} blocking · ${plural(s.tasks, "task")}`,
  }));
}

function longTasksRecommendation(
  har: ParsedHar,
  profile: NonNullable<ParsedTrace["mainThread"]>,
  scripts: MainThreadScript[]
): Recommendation | null {
  const { tbtMs, longTasks, tbtEndedBy } = profile;
  if (tbtMs === null || tbtMs === 0) return null;
  const counted = longTasks.filter(
    (t) => t.startMs >= (profile.tbtFromMs ?? 0) && t.startMs < profile.tbtToMs
  );
  const worst = counted.reduce<(typeof counted)[number] | null>(
    (max, t) => (max === null || t.durationMs > max.durationMs ? t : max),
    null
  );
  const windowEnd =
    tbtEndedBy === "interaction" ? "the first interaction" : "the end of the recording";
  const blocking = scripts
    .filter((s) => s.blockingMs > 0)
    .sort((a, b) => b.blockingMs - a.blockingMs);
  const longest = worst
    ? `; the longest took ${formatMs(worst.durationMs)}${worst.url ? ` running ${worst.url}` : ""}`
    : "";
  return {
    label: "Long tasks block the main thread",
    description: `${plural(counted.length, "long task")} (over 50 ms) ran between the first contentful paint and ${windowEnd} and blocked the main thread for ${formatMs(tbtMs)} in total (the Total Blocking Time)${longest}. While a long task runs the page cannot answer a tap or a key press. Split the work into tasks under 50 ms and yield between them (scheduler.yield, setTimeout), move heavy computation to a Web Worker, and defer the scripts the page does not need to become interactive.`,
    severity: tbtMs > TBT_CRITICAL_MS ? "critical" : tbtMs > TBT_WARNING_MS ? "warning" : "info",
    resources: scriptResources(har, blocking),
  };
}

function thirdPartyRecommendation(
  har: ParsedHar,
  scripts: MainThreadScript[],
  parties: MainThreadParty[]
): Recommendation | null {
  const third = parties.filter((p) => p.party === "third");
  const ms = third.reduce((sum, p) => sum + p.ms, 0);
  const blockingMs = third.reduce((sum, p) => sum + p.blockingMs, 0);
  if (ms < THIRD_PARTY_WARNING_MS && blockingMs < THIRD_PARTY_BLOCKING_MS) return null;
  const names = third.slice(0, 3).map((p) => `${p.entity} (${formatMs(p.ms)})`);
  return {
    label: "Third-party scripts cost main-thread time",
    description: `Scripts from ${plural(third.length, "third party", "third parties")} ran for ${formatMs(ms)} on the main thread, ${formatMs(blockingMs)} of it blocking input: ${names.join(", ")}${third.length > 3 ? " and others" : ""}. Load them after the page is interactive or once the visitor consents, drop the ones nobody reads, and ask the vendors of the rest for lighter builds.`,
    severity: blockingMs >= THIRD_PARTY_BLOCKING_MS ? "warning" : "info",
    resources: scriptResources(
      har,
      scripts.filter((s) => s.party === "third").sort((a, b) => b.ms - a.ms)
    ),
  };
}

function extensionsRecommendation(
  profile: NonNullable<ParsedTrace["mainThread"]>,
  scripts: MainThreadScript[]
): Recommendation | null {
  if (profile.extensionMs === 0) return null;
  const extensions = scripts.filter((s) => s.party === "extension");
  const blockingMs = extensions.reduce((sum, s) => sum + s.blockingMs, 0);
  return {
    label: "Browser extensions ran in the recording",
    description: `Scripts of the browser's extensions ran for ${formatMs(profile.extensionMs)} on the page's main thread${blockingMs > 0 ? `, ${formatMs(blockingMs)} of it inside long tasks` : ""}: that time belongs to the recording's browser, not to the page, yet it stretches its tasks and metrics. Record again in a profile without extensions (a guest or incognito window) before acting on the main-thread numbers.`,
    severity: "info",
    resources: extensions.slice(0, MAX_RESOURCES).map((s) => ({
      url: s.url,
      transferSize: 0,
      detail: `${formatMs(s.ms)} on the main thread · ${plural(s.tasks, "task")}`,
    })),
  };
}

function responsiveRecommendation(
  profile: NonNullable<ParsedTrace["mainThread"]>
): Recommendation | null {
  if (profile.tbtMs !== 0) return null;
  return {
    label: "Main thread stays responsive",
    description: `No task over 50 ms ran between the first contentful paint and ${profile.tbtEndedBy === "interaction" ? "the first interaction" : "the end of the recording"}: the page could answer input at any moment (main thread busy ${formatMs(profile.busyMs)} in all).`,
    severity: "good",
  };
}

/**
 * What the main thread cost the page: its busy time by category, the Total Blocking Time and
 * the long tasks behind it, the scripts that took the time by party (the page, each third
 * party, the browser's extensions), with a recommendation for each finding. Only for a trace
 * that profiles the main thread (see MainThreadProfile).
 */
export function analyzeMainThread(har: ParsedHar, trace: ParsedTrace): MainThreadReport {
  const profile = trace.mainThread;
  if (!profile) throw new Error("analyzeMainThread needs a trace with a main-thread profile");
  const documentRoot = getRootDomain(har.documentEntry.url);
  const scripts = profile.scripts.map((s) => describeScript(s, documentRoot));
  const parties = partiesOf(scripts);

  const findings = [
    longTasksRecommendation(har, profile, scripts),
    thirdPartyRecommendation(har, scripts, parties),
  ].filter((rec): rec is Recommendation => rec !== null);
  const extensions = extensionsRecommendation(profile, scripts);
  const good = findings.length === 0 ? responsiveRecommendation(profile) : null;
  const recommendations = [...(good ? [good] : findings), ...(extensions ? [extensions] : [])];

  return {
    busyMs: profile.busyMs,
    byCategory: profile.byCategory,
    tbtMs: profile.tbtMs,
    tbtFromMs: profile.tbtFromMs,
    tbtToMs: profile.tbtToMs,
    tbtEndedBy: profile.tbtEndedBy,
    longTasks: profile.longTasks,
    scripts: scripts.slice(0, MAX_SCRIPTS),
    parties,
    extensionMs: profile.extensionMs,
    recommendations,
  };
}

export const SCRIPT_PARTY_LABEL: Record<ScriptParty, string> = {
  first: "First party",
  third: "Third party",
  extension: "Extension",
};
