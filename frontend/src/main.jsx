import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { initAnalytics } from "./utils/analytics.js";
import "./styles.css";

// Privacy-first, cookieless analytics. No-op unless VITE_FATHOM_SITE_ID is
// set at build time (see docs/analytics.md) — local dev stays untracked.
initAnalytics(import.meta.env.VITE_FATHOM_SITE_ID);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
