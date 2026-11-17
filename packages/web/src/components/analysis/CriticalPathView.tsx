import { formatBytes, formatMs } from "@htv/core";
import type { RenderBlockingReport } from "@htv/core";
import { useMessages } from "../../i18n/context.js";
import styles from "../AnalysisPanel.module.css";
import { Table, Url } from "./parts.js";

/** The critical request chains, deepest first: from the document to what the first paint waited for. */
export function CriticalPathView({ report }: { report: RenderBlockingReport }) {
  const m = useMessages();
  const t = m.analysis;
  const c = t.criticalPath;
  const columns = m.waterfall.columns;
  const { source, chains } = report;
  if (source === "none") return <p>{t.unknownBlocking}</p>;
  if (chains.length === 0) return <p>{c.noChains}</p>;
  const [deepest] = chains;
  return (
    <>
      <p className={styles.summary}>
        {c.summary(chains.length, deepest.depth, formatMs(deepest.durationMs))}
      </p>
      <p>
        {c.intro} {t.times}
      </p>
      {chains.map((chain, i) => (
        <Table
          key={i}
          caption={c.chain(
            i + 1,
            chain.depth,
            formatMs(chain.durationMs),
            formatBytes(chain.transferSize)
          )}
          head={[
            { label: "#", num: true },
            { label: columns.name },
            { label: columns.type },
            { label: m.metrics.transfer, num: true },
            { label: columns.start, num: true },
            { label: t.end, num: true },
          ]}
          rows={chain.requests}
          rowHeader={1}
          cells={(request, step) => [
            step + 1,
            <Url url={request.url} />,
            request.resourceType,
            formatBytes(request.transferSize),
            formatMs(request.startMs),
            formatMs(request.endMs),
          ]}
        />
      ))}
    </>
  );
}
