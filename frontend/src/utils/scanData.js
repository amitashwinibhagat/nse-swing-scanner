// Pure helpers for turning the committed scan JSON into renderable state.
// No React, no I/O, no globals — every function here is unit-tested in
// scanData.test.js so the shape assumptions the dashboard depends on are
// checked in CI instead of discovered as a blank screen.

/**
 * Validate + normalise a scan payload.
 *
 * The dashboard used to assume `data.stocks` was always an array and iterate
 * it directly: a payload without `stocks` (or with `stocks: null`, which an
 * older/partial writer could produce) threw "x is not iterable" during render
 * and, with no error boundary, left a blank page. Missing/renamed fields are a
 * contract bug, not a reason to crash.
 *
 * @returns {{ok: true, scan: object} | {ok: false, reason: string}}
 */
export function normalizeScan(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "payload is not an object" };
  }
  if (!Array.isArray(raw.stocks)) {
    return {
      ok: false,
      reason: `payload has no stocks array (got ${raw.stocks === null ? "null" : typeof raw.stocks})`,
    };
  }
  if (raw.stocks.length === 0) {
    return { ok: false, reason: "payload has an empty stocks array" };
  }
  const stocks = raw.stocks.filter((s) => s && typeof s === "object" && s.symbol);
  if (stocks.length === 0) {
    return { ok: false, reason: "no row in the payload has a symbol" };
  }
  return {
    ok: true,
    scan: {
      ...raw,
      stocks,
      universe_size: Number.isFinite(raw.universe_size) ? raw.universe_size : stocks.length,
      gate_pass_count: Number.isFinite(raw.gate_pass_count)
        ? raw.gate_pass_count
        : stocks.filter((s) => s.gate_pass).length,
    },
  };
}

/** True when the payload validates as a scan we can render. */
export function isRenderableScan(raw) {
  return normalizeScan(raw).ok;
}

/**
 * Per-gate source rollup, tolerant of an older payload that predates
 * `source_health` in the JSON contract (it was added with this fix).
 *
 * @returns {{critical: boolean, degraded: string[], details: object}}
 */
export function sourceHealthOf(scan, scanStatus) {
  const fromScan = scan && scan.source_health;
  const fromStatus = scanStatus && scanStatus.source_health;
  const health = fromScan && typeof fromScan === "object" ? fromScan : fromStatus;
  if (!health || typeof health !== "object") {
    return { critical: false, degraded: [], details: {}, known: false };
  }
  const degraded = Array.isArray(health.degraded_gates) ? health.degraded_gates : [];
  return {
    critical: Boolean(health.critical_source_failed),
    degraded,
    details: health,
    known: true,
  };
}

/**
 * Gates that passed only because a source was unreachable and the scanner ran
 * in lenient mode. A pick carrying one of these was NOT fully checked, and the
 * card must say so rather than showing a clean "GATES PASSED".
 *
 * @returns {string[]} human labels, empty when the row is fully verified
 */
export function unverifiedGateLabels(stock, dict = SOURCE_GATE_LABELS) {
  const keys = Array.isArray(stock?.unverified_gates) ? stock.unverified_gates : [];
  return keys.map((k) => {
    const normalized = String(k).replace(/_unverified$/, "");
    return dict[normalized] || String(k).replace(/_/g, " ");
  });
}

/** Human labels for the gate keys used in `source_health.degraded_gates`. */
export const SOURCE_GATE_LABELS = {
  corporate_actions: "corporate actions",
  surveillance: "surveillance (T-group / ASM / GSM)",
  holdings_conviction: "shareholding (Screener.in)",
};

/** "corporate actions and surveillance" — for a sentence, not a list. */
export function joinLabels(keys, dict = SOURCE_GATE_LABELS) {
  const labels = (keys || []).map((k) => dict[k] || k);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Does the tracker currently support "the top band is the evidenced band"?
 *
 * The label is read from the tracker's current scheme (pass_v4, "72+"), which
 * is the v2-weights recalibration of the v3 "63+" band — same selection share,
 * same measured outcome. On the committed payload that band is NEGATIVE
 * (T+5 -0.22%, T+10 -0.92%, T+20 -1.01%), so the honest answer is "no edge".
 * The chips already self-suppress via `scoreBandChip`; this is the single
 * check the static copy uses so it can never contradict them.
 *
 * @returns {{established: boolean, n: number, mean: number|null, ci: object|null, window: string}}
 */
export const TOP_BAND_LABEL = "72+"; // mirrors performance.BUCKET_ORDER[0]

export function topBandEvidence(performance, { minN = 20 } = {}) {
  const cell = performance?.windows?.["T+5"]?.buckets?.[TOP_BAND_LABEL];
  if (!cell || typeof cell.n !== "number" || !cell.ci95) {
    return { established: false, n: cell?.n ?? 0, mean: cell?.mean ?? null, ci: null, window: "T+5" };
  }
  const established = cell.n >= minN && cell.ci95.low > 0;
  return {
    established,
    n: cell.n,
    mean: typeof cell.mean === "number" ? cell.mean : null,
    ci: cell.ci95,
    window: "T+5",
  };
}

/**
 * One sentence describing the top band's measured edge — or its absence.
 * Used by the KPI delta and the shortlist subhead so the copy can never
 * contradict the tracker again.
 */
export function topBandClaim(performance, error) {
  const ev = topBandEvidence(performance);
  // Distinguish "not loaded yet / failed" from "loaded, and it says no edge".
  // Collapsing those into one string is how the dashboard ended up implying the
  // tracker had found nothing when it had simply not arrived.
  if (!performance) {
    return error ? `tracker unavailable (${error})` : "tracker loading…";
  }
  if (ev.established) {
    const mean = ev.mean == null ? "—" : `${ev.mean > 0 ? "+" : ""}${ev.mean.toFixed(2)}%`;
    return `${TOP_BAND_LABEL} band: ${mean} vs Nifty at T+5 (n=${ev.n}, CI ${ev.ci.low}..${ev.ci.high})`;
  }
  if (!ev.n) return `${TOP_BAND_LABEL} band: no closed outcomes yet`;
  return `${TOP_BAND_LABEL} band: no established edge (T+5 CI ${ev.ci ? `${ev.ci.low}..${ev.ci.high}` : "n/a"}, n=${ev.n})`;
}

/**
 * Freshness, computed from the server's own expectation rather than the
 * browser clock alone.
 *
 * `stale_after_minutes` comes from scan_status.json and is derived from
 * measured GitHub scheduler drift. Without it the dashboard used a 30-minute
 * grace and showed "the next scan did not arrive" every trading day, because
 * the morning run is normally ~7 h late.
 */
export function computeStale(generatedAt, scanStatus, nowMs = Date.now()) {
  const graceMs = (() => {
    const minutes = scanStatus?.stale_after_minutes;
    if (typeof minutes === "number" && minutes > 0) return minutes * 60 * 1000;
    return 8 * 60 * 60 * 1000; // documented default; see scan_schedule.py
  })();
  const next = scanStatus?.next_expected_utc;
  if (next) {
    const nextMs = new Date(next).getTime();
    if (Number.isFinite(nextMs)) return nowMs > nextMs + graceMs;
  }
  const genMs = new Date(generatedAt).getTime();
  if (!Number.isFinite(genMs)) return false;
  return nowMs - genMs > 24 * 60 * 60 * 1000;
}

/**
 * IST-formatted scan timestamp. Date and time must come from the same zone:
 * the header used to format the DATE in the browser's zone and the TIME in
 * IST, so a New York visitor saw "03 Nov · 09:00 am IST" for a 04 Nov scan.
 */
export function formatScanTimestamp(iso, { withYear = false } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "Asia/Kolkata",
  });
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  return `${date} · ${time} IST`;
}
