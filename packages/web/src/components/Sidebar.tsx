import type { CSSProperties, ElementType, ReactNode } from "react";
import type { ResourceType } from "@htv/core";
import { TYPE_LABELS } from "../lib/resource-types.js";
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
  return (
    <div
      className={`${styles.sidebar} ${side === "left" ? styles.left : styles.right}`}
      style={{ "--sidebar-width": `${width}px` } as CSSProperties}
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>{title}</span>
        {subtitle && <span className={styles.headerCount}>{subtitle}</span>}
        {onClose && (
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <div className={styles.body}>{children}</div>
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
  return <SidebarGroupHeader as={as} type={type} label={TYPE_LABELS[type]} count={count} />;
}

export function SidebarRows({ children }: { children: ReactNode }) {
  return <div className={styles.rows}>{children}</div>;
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
