import { useState } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";
import type { ResourceType } from "@htv/core";
import { useMessages } from "../i18n/context.js";
import { ResourceTypeIcon } from "./ResourceTypeIcon.js";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  title: string;
  subtitle?: string;
  side?: "left" | "right";
  width?: number;
  onClose?: () => void;
  children: ReactNode;
}

export function Sidebar({
  title,
  subtitle,
  side = "right",
  width = 300,
  onClose,
  children,
}: SidebarProps) {
  const t = useMessages().sidebar;
  return (
    <div
      className={`${styles.sidebar} ${side === "left" ? styles.left : styles.right}`}
      style={{ "--sidebar-width": `${width}px` } as CSSProperties}
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>{title}</span>
        {subtitle && <span className={styles.headerCount}>{subtitle}</span>}
        {onClose && (
          <button className={styles.closeBtn} onClick={onClose} aria-label={t.close}>
            ✕
          </button>
        )}
      </div>
      {/* Scrollable region must be keyboard focusable (WCAG 2.1.1, axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.body} role="region" aria-label={title} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}

interface GroupProps {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  [prop: string]: unknown;
}

export function SidebarGroup({ as: Tag = "div", className, children, ...rest }: GroupProps) {
  return (
    <Tag className={`${styles.group} ${className ?? ""}`} {...rest}>
      {children}
    </Tag>
  );
}

interface GroupHeaderProps {
  as?: ElementType;
  type?: ResourceType;
  label: string;
  count: number;
}

/** Group heading; with `type` it shows the colored type icon and label. */
export function SidebarGroupHeader({ as: Tag = "div", type, label, count }: GroupHeaderProps) {
  const typeClass = type ? styles[`type_${type}`] : "";
  return (
    <Tag className={styles.groupHeader}>
      {type && (
        <span className={`${styles.typeIcon} ${typeClass}`}>
          <ResourceTypeIcon type={type} />
        </span>
      )}
      <span className={`${styles.groupLabel} ${typeClass}`}>{label}</span>
      <span className={styles.groupCount}>{count}</span>
    </Tag>
  );
}

export function SidebarTypeHeader({
  as,
  type,
  count,
}: {
  as?: ElementType;
  type: ResourceType;
  count: number;
}) {
  const t = useMessages().sidebar;
  return <SidebarGroupHeader as={as} type={type} label={t.types[type]} count={count} />;
}

export function SidebarRows({ children }: { children: ReactNode }) {
  return <div className={styles.rows}>{children}</div>;
}

// Rows rendered at once: a page of 10 000 requests lists its first rows and waits for
// "Show more", so that opening the sidebar stays quick.
const PAGE_SIZE = 200;

interface PagedRowsProps<T> {
  items: T[];
  render: (item: T, index: number) => ReactNode;
}

/** The first rows of a list, with a button for the next page; a new list starts over. */
export function SidebarPagedRows<T>({ items, render }: PagedRowsProps<T>) {
  const t = useMessages().sidebar;
  const [paging, setPaging] = useState({ items, limit: PAGE_SIZE });
  const limit = paging.items === items ? paging.limit : PAGE_SIZE;
  const left = items.length - limit;
  return (
    <div className={styles.rows}>
      {items.slice(0, limit).map(render)}
      {left > 0 && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setPaging({ items, limit: limit + PAGE_SIZE })}
        >
          {t.showMore(Math.min(PAGE_SIZE, left), left)}
        </button>
      )}
    </div>
  );
}

interface RowProps {
  url: string;
  label: string;
  size: string;
  children?: ReactNode;
}

/** Resource row: short URL (full URL as tooltip), size, then an optional trailing cell. */
export function SidebarRow({ url, label, size, children }: RowProps) {
  return (
    <div className={styles.row} title={url}>
      <span className={styles.rowUrl}>{label}</span>
      <span className={styles.rowSize}>{size}</span>
      {children}
    </div>
  );
}
