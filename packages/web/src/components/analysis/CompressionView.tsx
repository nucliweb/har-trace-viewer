import { formatBytes } from "@htv/core";
import type { CompressibleType, CompressionReport } from "@htv/core";
import { useMessages } from "../../i18n/context.js";
import styles from "../AnalysisPanel.module.css";
import { TableSection, Url } from "./parts.js";

const approx = (bytes: number) => `~${formatBytes(bytes)}`;

/** What the page's downloads weighed by encoding and format, and what each saving comes from. */
export function CompressionView({ report }: { report: CompressionReport }) {
  const m = useMessages();
  const c = m.analysis.compression;
  const { name, type, encoding } = m.waterfall.columns;
  const transfer = { label: m.metrics.transfer, num: true };
  const toSave = { label: c.toSave, num: true };
  const { byType, images } = report;
  if (byType.length === 0 && images.byFormat.length === 0) return <p>{c.nothing}</p>;
  const typeLabel = (t: CompressibleType) => (t === "text" ? c.otherText : t.toUpperCase());
  return (
    <>
      <p className={styles.summary}>
        {report.potentialSavings > 0
          ? c.savings(formatBytes(report.potentialSavings))
          : c.noSavings}
      </p>
      <TableSection
        title={c.byType}
        head={[
          { label: type },
          { label: m.hops.requests, num: true },
          { label: c.encodings },
          { label: c.decoded, num: true },
          transfer,
        ]}
        rows={byType}
        cells={(row) => [
          typeLabel(row.type),
          row.requests,
          Object.entries(row.encodings)
            .map(([enc, requests]) => `${enc} ${requests}`)
            .join(" · "),
          formatBytes(row.uncompressedBytes),
          formatBytes(row.wireBytes),
        ]}
      />
      <TableSection
        title={c.uncompressed}
        head={[{ label: name }, { label: type }, { label: c.decoded, num: true }, transfer, toSave]}
        rows={report.uncompressed}
        cells={(row) => [
          <Url url={row.url} />,
          typeLabel(row.type),
          formatBytes(row.bytes),
          formatBytes(row.wireBytes),
          approx(row.potentialSavings),
        ]}
      />
      <TableSection
        title={c.gzipOnly}
        head={[{ label: name }, { label: type }, { label: encoding }, transfer, toSave]}
        rows={report.gzipOnly}
        cells={(row) => [
          <Url url={row.url} />,
          typeLabel(row.type),
          row.encoding,
          formatBytes(row.wireBytes),
          approx(row.potentialSavings),
        ]}
      />
      <TableSection
        title={c.images}
        head={[{ label: c.format }, { label: m.hops.requests, num: true }, transfer]}
        rows={images.byFormat}
        cells={(row) => [row.format, row.requests, formatBytes(row.bytes)]}
      />
      <TableSection
        title={c.legacy}
        head={[
          { label: name },
          { label: c.format },
          transfer,
          { label: c.as("WebP"), num: true },
          { label: c.as("AVIF"), num: true },
        ]}
        rows={images.legacy}
        cells={(row) => [
          <Url url={row.url} />,
          row.format,
          formatBytes(row.bytes),
          approx(row.webpSavings),
          approx(row.avifSavings),
        ]}
      />
      <TableSection
        title={c.encoded}
        head={[{ label: name }, { label: c.format }, { label: encoding }, transfer]}
        rows={images.encoded}
        cells={(row) => [<Url url={row.url} />, row.format, row.encoding, formatBytes(row.bytes)]}
      />
    </>
  );
}
