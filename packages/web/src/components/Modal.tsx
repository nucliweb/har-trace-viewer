import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { useMessages } from "../i18n/context.js";
import styles from "./Modal.module.css";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal dialog on the browser's <dialog>: it opens in the top layer, holds the focus until it
 * closes and closes on Escape (its "cancel" event), which hands the closing to `onClose`.
 */
export function Modal({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useMessages().modal;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
