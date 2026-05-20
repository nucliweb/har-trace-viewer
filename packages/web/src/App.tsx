import { useState } from "react";
import { generateFlow } from "@htv/core/steps/step-generator.js";
import type { Flow, PageFlow } from "@htv/core/types.js";
import { DiagramView } from "./components/DiagramView.js";
import { FlowBuilder } from "./components/FlowBuilder.js";
import styles from "./App.module.css";

function getInitialTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const initial = getInitialTheme();
    document.documentElement.setAttribute("data-theme", initial);
    return initial;
  });

  const handleGenerate = (pages: PageFlow[]) => {
    setFlow(generateFlow(pages));
  };

  const handleReset = () => {
    setFlow(null);
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logo}>
          htv <span>HAR TRACE VIEWER</span>
        </div>
        <div className={styles.headerActions}>
          {flow && (
            <button
              className={styles.resetButton}
              onClick={handleReset}
              title="Reset — load a new flow"
            >
              ↩ Reset
            </button>
          )}
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {flow ? (
          <DiagramView flow={flow} />
        ) : (
          <div className={styles.builderWrapper}>
            <FlowBuilder onGenerate={handleGenerate} />
          </div>
        )}
      </main>
    </div>
  );
}
