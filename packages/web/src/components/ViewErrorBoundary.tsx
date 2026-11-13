import { Component } from "react";
import type { ReactNode } from "react";
import { useMessages } from "../i18n/context.js";
import styles from "./ViewErrorBoundary.module.css";

interface Texts {
  title: string;
  message: string;
  startOver: string;
}

interface Props {
  texts: Texts;
  /** Leaves the failed view, back to the start screen. */
  onReset: () => void;
  children: ReactNode;
}

class Boundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    const { texts, onReset, children } = this.props;
    if (!this.state.failed) return children;
    return (
      <div className={styles.failure} role="alert">
        <h2 className={styles.title} tabIndex={-1} ref={(node) => node?.focus()}>
          {texts.title}
        </h2>
        <p className={styles.message}>{texts.message}</p>
        <button type="button" className={styles.action} onClick={onReset}>
          {texts.startOver}
        </button>
      </div>
    );
  }
}

/**
 * Keeps a view that throws while rendering from blanking the whole app: a message and a way
 * back to the start screen take its place.
 */
export function ViewErrorBoundary({
  onReset,
  children,
}: {
  onReset: () => void;
  children: ReactNode;
}) {
  const t = useMessages().errors;
  return (
    <Boundary
      texts={{ title: t.viewTitle, message: t.viewMessage, startOver: t.startOver }}
      onReset={onReset}
    >
      {children}
    </Boundary>
  );
}
