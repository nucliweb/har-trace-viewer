import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/reset.css";
import { App } from "./App.js";
import { preloadAll } from "./components/lazy.js";
import { initialLocale, loadMessages } from "./i18n/useLocale.js";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

// The first render waits for the interface language, so it never flashes English first, and in a
// report (whose build inlines every module) for the view of its embedded flow. Failing either,
// the app renders anyway: in English, or with the view's error.
void Promise.allSettled([
  loadMessages(initialLocale()),
  window.__HTV_FLOW__ ? preloadAll() : null,
]).then(() =>
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
);
