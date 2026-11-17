import { formatBytes, formatMs } from "@htv/core";
import type { ConnectionsReport, HostProtocol } from "@htv/core";
import { useMessages } from "../../i18n/context.js";
import styles from "../AnalysisPanel.module.css";
import { TableSection } from "./parts.js";

/** How the page's requests reached each host, and the document's Server-Timing. */
export function ConnectionsView({
  report,
  hasDocument,
}: {
  report: ConnectionsReport;
  hasDocument: boolean;
}) {
  const m = useMessages();
  const t = m.analysis;
  const c = t.connections;
  const na = m.hops.na;
  const { hosts } = report;
  const requests = hosts.reduce((sum, h) => sum + h.requests, 0);
  const protocol = (p: HostProtocol) => (p === "unknown" ? na : p === "mixed" ? c.mixed : p);
  const handshakes = { title: c.handshakesTitle, num: true };
  return (
    <>
      {hosts.length === 0 ? (
        <p>{c.noHosts}</p>
      ) : (
        <>
          <p className={styles.summary}>{c.summary(hosts.length, requests)}</p>
          {hosts.every((h) => h.protocol === "unknown") && <p>{c.noProtocol}</p>}
          {hosts.every((h) => h.connections === null) && <p>{c.noConnectionIds}</p>}
          <TableSection
            title={c.caption}
            head={[
              { label: m.hops.host },
              { label: m.hops.protocol },
              { label: m.hops.requests, num: true },
              { label: c.connections, num: true },
              { label: c.perConnection, num: true },
              { label: "DNS", ...handshakes },
              { label: "TCP", ...handshakes },
              { label: "TLS", ...handshakes },
              { label: "Alt-Svc h3", title: c.http3Title },
              { label: c.cookies, num: true },
            ]}
            rows={hosts}
            cells={(h) => [
              h.host,
              protocol(h.protocol),
              h.requests,
              h.connections ?? na,
              h.requestsPerConnection ?? na,
              h.dnsLookups,
              h.tcpHandshakes,
              h.tlsHandshakes,
              h.advertisesHttp3 ? t.yes : "—",
              h.cookieBytes > 0
                ? c.cookieBytes(formatBytes(h.cookieBytes), formatBytes(h.maxCookieBytes))
                : "—",
            ]}
          />
        </>
      )}
      <TableSection
        title="Server-Timing"
        empty={hasDocument ? c.noServerTiming : c.noServerTimingDocument}
        head={[
          { label: m.metrics.metric },
          { label: c.duration, num: true },
          { label: c.description },
        ]}
        rows={report.serverTiming}
        cells={(metric) => [
          metric.name,
          metric.dur === undefined ? na : formatMs(metric.dur),
          metric.desc ?? "",
        ]}
      />
    </>
  );
}
