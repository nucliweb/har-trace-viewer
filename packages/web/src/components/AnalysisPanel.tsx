import type { PageAnalysis } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import { ANALYSIS_VIEWS } from "../lib/view-state.js";
import type { AnalysisView } from "../lib/view-state.js";
import { Drawer, DrawerBody } from "./Drawer.js";
import { CompressionView } from "./analysis/CompressionView.js";
import { ConnectionsView } from "./analysis/ConnectionsView.js";
import { CriticalPathView } from "./analysis/CriticalPathView.js";
import { RenderView } from "./analysis/RenderView.js";
import styles from "./AnalysisPanel.module.css";

interface Props {
  view: AnalysisView;
  onViewChange: (view: AnalysisView) => void;
  /** The analysis of the page of the step on screen. */
  analysis: PageAnalysis;
  /** False for a page without an HTML document (an API capture), which paints nothing. */
  hasDocument: boolean;
  /** Whether the page has a trace, which the LCP and the FCP come from. */
  hasTrace: boolean;
  pageLabel: string;
  onClose: () => void;
}

function ViewContent({
  view,
  analysis,
  hasDocument,
  hasTrace,
}: Pick<Props, "view" | "analysis" | "hasDocument" | "hasTrace">) {
  const t = useMessages().analysis;
  const { connectionsReport, compressionReport, renderReport } = analysis;
  // Flows generated before a report existed lack it: say so, rather than show it empty.
  const notInReport = <p>{t.notInReport}</p>;
  if (view === "connections") {
    return connectionsReport ? (
      <ConnectionsView report={connectionsReport} hasDocument={hasDocument} />
    ) : (
      notInReport
    );
  }
  if (view === "compression") {
    return compressionReport ? <CompressionView report={compressionReport} /> : notInReport;
  }
  if (!renderReport) return notInReport;
  if (!hasDocument) return <p>{t.noDocument}</p>;
  return view === "render" ? (
    <RenderView
      lcp={renderReport.lcp}
      renderBlocking={renderReport.renderBlocking}
      hasTrace={hasTrace}
    />
  ) : (
    <CriticalPathView report={renderReport.renderBlocking} />
  );
}

/**
 * The data behind the findings of four analyses of a page: its connections per host, the
 * compression of its downloads, what delayed its paints and its critical request chains. One
 * view at a time, picked in the drawer, by key (6 to 9) or by link.
 */
export function AnalysisPanel({
  view,
  onViewChange,
  analysis,
  hasDocument,
  hasTrace,
  pageLabel,
  onClose,
}: Props) {
  const t = useMessages().analysis;
  return (
    <Drawer
      title={t.title}
      subtitle={pageLabel}
      closeLabel={t.close}
      onClose={onClose}
      width="1040px"
      coversPhone
    >
      <div className={styles.views} role="group" aria-label={t.views}>
        {ANALYSIS_VIEWS.map((name) => (
          <button
            key={name}
            type="button"
            className={`${styles.chip} ${view === name ? styles.chipActive : ""}`}
            aria-pressed={view === name}
            onClick={() => onViewChange(name)}
          >
            {t.view[name]}
          </button>
        ))}
      </div>
      <DrawerBody label={t.details} className={styles.body}>
        <ViewContent
          view={view}
          analysis={analysis}
          hasDocument={hasDocument}
          hasTrace={hasTrace}
        />
      </DrawerBody>
    </Drawer>
  );
}
