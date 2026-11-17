import { formatBytes, formatMs, pct } from "@htv/core";
import type { LcpAttribution, LcpPhases, RenderBlockingReport } from "@htv/core";
import { useMessages } from "../../i18n/context.js";
import styles from "../AnalysisPanel.module.css";
import { Section, Table, Url } from "./parts.js";

const PHASES: (keyof LcpPhases)[] = [
  "ttfb",
  "resourceLoadDelay",
  "resourceLoadDuration",
  "elementRenderDelay",
];

function LcpDetails({ lcp }: { lcp: LcpAttribution }) {
  const m = useMessages();
  const t = m.analysis;
  const r = t.render;
  const columns = m.waterfall.columns;
  const { element, resource } = lcp;
  const named = element?.tagName
    ? `${element.tagName}${element.type ? ` (${element.type})` : ""}`
    : null;
  const yesNo = (value: boolean) => (value ? t.yes : t.no);
  return (
    <>
      <p className={styles.summary}>{r.lcpSummary(formatMs(lcp.lcpMs), named)}</p>
      <Table
        caption={r.phasesCaption}
        head={[
          { label: r.phase },
          { label: columns.time, num: true },
          { label: r.share, num: true },
        ]}
        rows={PHASES}
        cells={(phase) => [
          r.phases[phase],
          formatMs(lcp.phases[phase]),
          lcp.lcpMs > 0 ? pct(lcp.phases[phase] / lcp.lcpMs) : m.hops.na,
        ]}
      />
      {resource && (
        <dl className={styles.details}>
          <dt>{r.resource}</dt>
          <dd>
            <Url url={resource.url} />
          </dd>
          <dt>{m.metrics.transfer}</dt>
          <dd>{formatBytes(resource.transferSize)}</dd>
          <dt>{columns.priority}</dt>
          <dd>{resource.priority ?? m.hops.na}</dd>
          <dt>fetchpriority</dt>
          <dd>{resource.fetchPriorityHint ?? m.hops.na}</dd>
          <dt>{r.preloaded}</dt>
          <dd>{yesNo(resource.preloaded)}</dd>
          <dt>{r.fromCache}</dt>
          <dd>{yesNo(resource.fromCache)}</dd>
        </dl>
      )}
      {lcp.notes.length > 0 && (
        <ul className={styles.notes}>
          {lcp.notes.map((note) => (
            <li key={note}>{r.notes[note]}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function BlockingDetails({
  report,
  tableName,
}: {
  report: RenderBlockingReport;
  tableName: string;
}) {
  const m = useMessages();
  const t = m.analysis;
  const r = t.render;
  const columns = m.waterfall.columns;
  const { source, fcpMs, resources } = report;
  if (source === "none") return <p>{t.unknownBlocking}</p>;
  return (
    <>
      <p>{r.source[source]}</p>
      <p>{fcpMs === null ? r.noFcp : `FCP ${formatMs(fcpMs)}`}</p>
      {resources.length === 0 ? (
        <p>{r.nothingBlocks}</p>
      ) : (
        <>
          <p className={styles.summary}>
            {r.held(resources.length, formatBytes(report.totalBytes), formatMs(report.heldMs))}
            {fcpMs === null && r.uncapped}
          </p>
          <Table
            labelledBy={tableName}
            head={[
              { label: columns.name },
              { label: columns.type },
              { label: columns.status },
              { label: m.hops.party },
              { label: m.metrics.transfer, num: true },
              { label: columns.start, num: true },
              { label: t.end, num: true },
            ]}
            rows={resources}
            cells={(res) => [
              <Url url={res.url} />,
              res.resourceType,
              r.statuses[res.status] ?? res.status,
              res.thirdParty ? m.hops.third : m.hops.first,
              formatBytes(res.transferSize),
              formatMs(res.startMs),
              formatMs(res.endMs),
            ]}
          />
          <p>{t.times}</p>
        </>
      )}
    </>
  );
}

/** The LCP broken down into its phases, and the requests that held the first paint. */
export function RenderView({
  lcp,
  renderBlocking,
  hasTrace,
}: {
  lcp: LcpAttribution | null;
  renderBlocking: RenderBlockingReport;
  hasTrace: boolean;
}) {
  const r = useMessages().analysis.render;
  return (
    <>
      <Section title="Largest Contentful Paint">
        {() => (lcp ? <LcpDetails lcp={lcp} /> : <p>{hasTrace ? r.noLcp : r.noTrace}</p>)}
      </Section>
      <Section title={r.blocking}>
        {(id) => <BlockingDetails report={renderBlocking} tableName={id} />}
      </Section>
    </>
  );
}
