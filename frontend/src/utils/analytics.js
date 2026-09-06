// Privacy-first analytics (Fathom) — fail-silent by design.
//
// Contract:
//   - No site ID configured → zero network requests, zero console noise.
//     The dashboard is byte-for-byte identical to an untracked build.
//   - Configured → loads Fathom's cookieless script from cdn.usefathom.com
//     (the ONLY third-party origin permitted by the CSP in netlify.toml).
//   - Every helper is wrapped so an analytics outage can never break the
//     dashboard — analytics is observational, never load-bearing.
//   - No cookies, no fingerprinting, no localStorage. Fathom aggregates
//     anonymously; see docs/analytics.md for the full privacy stance and
//     the north-star metric definition.
//
// Site ID delivery: Vite env var VITE_FATHOM_SITE_ID at build time.
// Netlify sets it in Site settings → Environment variables; a local
// `.env` is optional and gitignored.

const SCRIPT_ORIGIN = "https://cdn.usefathom.com/script.js";

let loaded = false;
let enabled = false;

/**
 * Inject the Fathom script once. Safe to call multiple times.
 * @param {string|undefined} siteId
 */
export function initAnalytics(siteId) {
  if (!siteId || typeof siteId !== "string" || loaded) return;
  loaded = true;
  try {
    const s = document.createElement("script");
    s.src = SCRIPT_ORIGIN;
    s.setAttribute("data-site", siteId);
    s.defer = true;
    s.addEventListener("error", () => { enabled = false; });
    s.addEventListener("load", () => { enabled = true; });
    document.head.appendChild(s);
  } catch {
    /* never let analytics break the app */
  }
}

/**
 * Track a named custom event. Names are stable snake_case strings — they
 * become dashboard series (see docs/analytics.md instrumentation map).
 * Fathom rejects events when its script hasn't loaded (e.g. offline);
 * we swallow everything.
 * @param {string} name
 */
export function trackEvent(name) {
  if (!loaded || !enabled) return;
  try {
    if (typeof window.fathom?.trackEvent === "function") {
      window.fathom.trackEvent(name);
    }
  } catch {
    /* ignore */
  }
}

// Canonical event names (single source of truth — grep this file for the
// full instrumentation map before adding new ones).
export const EVENTS = {
  DRAWER_OPEN: "drawer_open",
  PER_SYMBOL_LOOKUP: "per_symbol_lookup",
  CSV_EXPORT: "csv_export",
  DIGEST_OPEN: "digest_open",
};
