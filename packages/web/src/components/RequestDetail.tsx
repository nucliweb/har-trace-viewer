import { useId, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { formatBytes, formatMs, requestDetail, requestSequence } from "@htv/core";
import type { HeaderField, ParsedHar, WaterfallPhases, WaterfallRow } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import { RequestSequence } from "./RequestSequence.js";
import waterfallStyles from "./WaterfallPanel.module.css";
import styles from "./RequestDetail.module.css";

const PHASES: (keyof WaterfallPhases)[] = [
  "blocked",
  "dns",
  "connect",
  "ssl",
  "send",
  "wait",
  "receive",
];

const NONE = "—";

/** Copies `text` and says `done` in the waterfall's live region. */
export type OnCopyText = (text: string, done: string) => void;

const linesOf = (fields: HeaderField[]) =>
  fields.map(({ name, value }) => `${name}: ${value}`).join("\n");

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {items.map(([term, value]) => (
        <div key={term} className={styles.fact}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A part of the detail: a group named by its heading. Groups, lists and definition lists only,
 * no tables: the table view holds the detail in one of its cells.
 */
function Part({
  title,
  action,
  wide = false,
  children,
}: {
  title: string;
  action?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`${styles.part} ${wide ? styles.wide : ""}`} role="group" aria-labelledby={id}>
      <div className={styles.partHead}>
        <h4 id={id} className={styles.partTitle}>
          {title}
        </h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function HeaderList({ fields }: { fields: HeaderField[] }) {
  const d = useMessages().waterfall.detail;
  if (fields.length === 0) return <p className={styles.note}>{d.noHeaders}</p>;
  return (
    <dl className={styles.headers}>
      {fields.map((field, i) => (
        <div key={i} className={styles.header}>
          <dt>{field.name}</dt>
          <dd>
            <span className={styles.value}>{field.value}</span>
            {field.masked && <span className={styles.masked}>{d.masked}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Each phase with its duration and a bar placed where it falls within the request. */
function Timing({ row }: { row: WaterfallRow }) {
  const t = useMessages().waterfall;
  // Where each phase starts: the sum of the phases before it.
  const starts = PHASES.map((_, i) =>
    PHASES.slice(0, i).reduce((sum, key) => sum + (row.phases[key] ?? 0), 0)
  );
  const total = starts.at(-1)! + (row.phases.receive ?? 0);
  return (
    <dl className={styles.timing}>
      {PHASES.map((key, i) => {
        const ms = row.phases[key];
        const from = total > 0 ? (starts[i] / total) * 100 : 0;
        const width = total > 0 && ms ? (ms / total) * 100 : 0;
        return (
          <div key={key} className={styles.phaseRow}>
            <dt>{t.phases[key]}</dt>
            <dd>
              <span className={styles.ms}>
                {ms === null ? t.detail.notApplicable : formatMs(ms)}
              </span>
              <span className={styles.track} aria-hidden="true">
                {width > 0 && (
                  <span
                    className={`${styles.phase} ${waterfallStyles[`phase_${key}`]}`}
                    style={{ "--from": `${from}%`, "--width": `${width}%` } as CSSProperties}
                  />
                )}
              </span>
            </dd>
          </div>
        );
      })}
      <div className={`${styles.phaseRow} ${styles.total}`}>
        <dt>{t.detail.total}</dt>
        <dd>
          <span className={styles.ms}>{formatMs(row.endMs - row.startMs)}</span>
        </dd>
      </div>
    </dl>
  );
}

/**
 * One request in full, under its row: its URL and facts, its sequence over the network, what
 * requested it (the initiator chain), its timing phases, sizes and cache status, and its request and response headers, the
 * values the parser masked marked as such. A report from before the header lists shows the
 * allow-listed response headers it kept.
 */
export function RequestDetail({
  row,
  har,
  onCopyText,
}: {
  row: WaterfallRow;
  har: ParsedHar;
  onCopyText: OnCopyText;
}) {
  const t = useMessages().waterfall;
  const d = t.detail;
  const titleId = useId();
  const entry = har.entries[row.entryIndex];
  const detail = useMemo(() => (entry ? requestDetail(har, entry) : null), [har, entry]);
  const sequence = useMemo(() => (entry ? requestSequence(har, entry) : null), [har, entry]);
  if (!detail || !sequence || !entry) return null;
  const { initiator, sizes, cache, headers } = detail;
  const kept: HeaderField[] = Object.keys(entry.responseHeaders)
    .sort()
    .map((name) => ({ name, value: entry.responseHeaders[name], masked: false }));
  const response = headers?.response ?? kept;
  const copyButton = (fields: HeaderField[], label: string, done: string) =>
    fields.length > 0 && (
      <button
        type="button"
        className={waterfallStyles.chip}
        onClick={() => onCopyText(linesOf(fields), done)}
      >
        {label}
      </button>
    );

  return (
    <section className={styles.detail} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.title}>
        {d.title}
      </h3>
      <p className={styles.url}>{row.url}</p>
      {row.redirectURL && <p className={styles.redirect}>→ {row.redirectURL}</p>}
      <Facts
        items={[
          [d.method, row.method ?? NONE],
          [d.status, row.status > 0 ? String(row.status) : NONE],
          [d.protocol, row.httpVersion && row.httpVersion !== "unknown" ? row.httpVersion : NONE],
          [d.priority, row.priority ?? NONE],
          [d.type, `${row.resourceType} · ${row.mimeType || NONE}`],
          [d.party, row.party === "first" ? t.firstParty : t.thirdParty],
          [d.start, formatMs(row.startMs)],
          [d.duration, formatMs(row.endMs - row.startMs)],
        ]}
      />
      <div className={styles.parts}>
        <Part
          wide
          title={d.sequence.title(sequence.protocol === "unknown" ? null : sequence.protocol)}
        >
          <RequestSequence sequence={sequence} entry={entry} har={har} />
        </Part>
        <Part title={initiator ? `${d.initiator} · ${initiator.type}` : d.initiator}>
          {initiator === null ? (
            <p className={styles.note}>{d.noInitiator}</p>
          ) : (
            <>
              {initiator.chain.length === 0 ? (
                <p className={styles.note}>{d.noInitiatorUrl}</p>
              ) : (
                <ol className={styles.chain} aria-label={d.initiatorChain}>
                  {initiator.chain.map((link, i) => (
                    <li key={i}>
                      <span className={styles.linkType}>{link.type}</span>{" "}
                      <span className={styles.value}>
                        {link.lineNumber === undefined
                          ? link.url
                          : `${link.url}:${link.lineNumber + 1}`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Part>
        <Part title={d.timing}>
          <Timing row={row} />
        </Part>
        <Part title={d.size}>
          <Facts
            items={[
              [d.transfer, formatBytes(sizes.transfer)],
              [
                d.compressedBody,
                sizes.compressedBody === null ? NONE : formatBytes(sizes.compressedBody),
              ],
              [d.uncompressedBody, formatBytes(sizes.body)],
              [d.encoding, sizes.encoding ?? NONE],
            ]}
          />
        </Part>
        <Part title={d.cache}>
          <Facts
            items={[
              [d.browserCache, cache.browser ? d.stores[cache.browser] : d.network],
              [d.revalidated, cache.revalidated ? d.yes : d.no],
              [d.bypassed, cache.bypassed ? d.yes : d.no],
              [d.cdnCache, cache.cdn],
              [d.cacheControl, cache.cacheControl ?? NONE],
              [d.age, cache.age === null ? NONE : d.seconds(cache.age)],
            ]}
          />
        </Part>
        <Part
          wide
          title={headers ? d.requestHeaders(headers.request.length) : d.requestHeadersTitle}
          action={
            headers && copyButton(headers.request, d.copyRequestHeaders, d.requestHeadersCopied)
          }
        >
          {headers ? (
            <HeaderList fields={headers.request} />
          ) : (
            <p className={styles.note}>{d.notRecorded}</p>
          )}
        </Part>
        <Part
          wide
          title={d.responseHeaders(response.length)}
          action={copyButton(response, d.copyResponseHeaders, d.responseHeadersCopied)}
        >
          <HeaderList fields={response} />
        </Part>
      </div>
      <p className={styles.note}>{headers ? d.maskedNote : d.allowListNote}</p>
    </section>
  );
}
