// Recent-picks scorecard: "what happened to the last scan's suggestions?"
//
// Pure functions only — no React, no I/O — mirroring the delta.js pattern.
// Data sources (all already committed by the scan workflow):
//   - prior snapshot JSON  → the picks (gate_pass, entry plan, score)
//   - latest scan JSON     → fresh prices for the whole universe
// Nothing is silently dropped: names without a fresh price surface in a
// separate "no price" bucket with their reason.

import { computeEntryState, ENTRY_STATES } from "./scanPlan.js";

/**
 * Resolve the history_index entry matching the currently rendered scan.
 * Mirrors DeltaStrip's heuristic (generated_at exact match, then date+slot
 * derived from the timestamp) but as a pure, reusable function.
 *
 * @param {Array<{date:string, slot:string, file:string, generated_at:string}>} history
 * @param {string} currentGeneratedAt
 * @returns {object|null}
 */
export function resolveIndexEntry(history, currentGeneratedAt) {
  if (!Array.isArray(history) || history.length === 0 || !currentGeneratedAt) {
    return null;
  }
  const match = history.find((e) => e.generated_at === currentGeneratedAt);
  if (match) return match;
  const d = new Date(currentGeneratedAt);
  if (Number.isNaN(d.getTime())) return null;
  const dateStr = d.toISOString().slice(0, 10);
  const slot = d.getUTCHours() >= 8 ? "pm" : "am";
  return history.find((e) => e.date === dateStr && e.slot === slot) || null;
}

/** Display order: actionable states first, outcomes (T1/T2) next, dead last. */
const STATE_ORDER = [
  ENTRY_STATES.IN_ZONE,
  ENTRY_STATES.BELOW_ZONE,
  ENTRY_STATES.AT_T1,
  ENTRY_STATES.AT_T2,
  ENTRY_STATES.EXTENDED,
  ENTRY_STATES.STOPPED,
];

function stateRank(state) {
  const i = STATE_ORDER.indexOf(state);
  return i === -1 ? STATE_ORDER.length : i;
}

/**
 * Build the recent-picks scorecard.
 *
 * @param {{stocks:Array, gate_pass_count?:number}} priorSnapshot
 *   The previous scan's snapshot (full JSON).
 * @param {{stocks:Array}} latestScan
 *   The currently rendered scan (full JSON) — used only as a price lookup.
 * @returns {{picks:Array, summary:{in_zone:number, below_zone:number,
 *   at_t1:number, at_t2:number, extended:number, stopped:number,
 *   no_price:number}, priorCount:number}|null}
 *   null when either input is unusable.
 */
export function buildRecentPicks(priorSnapshot, latestScan) {
  if (!priorSnapshot || !Array.isArray(priorSnapshot.stocks)) return null;
  if (!latestScan || !Array.isArray(latestScan.stocks)) return null;

  const priceBySymbol = new Map();
  for (const s of latestScan.stocks) {
    if (s && s.symbol && typeof s.current_price === "number" && Number.isFinite(s.current_price)) {
      priceBySymbol.set(s.symbol, s.current_price);
    }
  }

  const picks = [];
  const summary = {
    in_zone: 0,
    below_zone: 0,
    at_t1: 0,
    at_t2: 0,
    extended: 0,
    stopped: 0,
    no_price: 0,
  };
  let priorCount = 0;

  for (const s of priorSnapshot.stocks) {
    if (!s || !s.gate_pass || !s.symbol) continue;
    priorCount += 1;

    const nowPrice = priceBySymbol.get(s.symbol);
    if (typeof nowPrice !== "number") {
      summary.no_price += 1;
      picks.push({
        symbol: s.symbol,
        companyName: s.company_name || "",
        score: typeof s.swing_score === "number" ? s.swing_score : null,
        state: "no_price",
        stateLabel: "no fresh price",
        tone: "muted",
        tooltip: "No usable price in the latest scan (coverage gap, rate limit, or dropped from universe).",
        scanPrice: typeof s.current_price === "number" ? s.current_price : null,
        nowPrice: null,
        changePct: null,
        entryZone: null,
      });
      continue;
    }

    // Reclassify the ORIGINAL plan (stored in the prior snapshot) against
    // TODAY's price — computeEntryState needs all of price/zone/stop/t1.
    const plan = { ...s, current_price: nowPrice };
    const entry = computeEntryState(plan);

    const changePct =
      typeof s.current_price === "number" && s.current_price > 0
        ? ((nowPrice - s.current_price) / s.current_price) * 100
        : null;

    let state = entry ? entry.state : "no_price";
    let stateLabel = entry ? entry.label : "plan incomplete";
    let tone = entry ? entry.tone : "muted";
    let tooltip = entry ? entry.tooltip : "Prior snapshot lacked plan fields for this row.";

    // Names that drifted above T2 — keep the outcome label simple.
    if (state === ENTRY_STATES.EXTENDED && typeof s.target_1 === "number" && nowPrice >= s.target_1) {
      state = ENTRY_STATES.AT_T1;
      stateLabel = "at T1";
      tone = "accent";
    }

    if (state in summary) summary[state] += 1;
    else summary.no_price += 1;

    picks.push({
      symbol: s.symbol,
      companyName: s.company_name || "",
      score: typeof s.swing_score === "number" ? s.swing_score : null,
      state,
      stateLabel,
      tone,
      tooltip,
      scanPrice: typeof s.current_price === "number" ? s.current_price : null,
      nowPrice,
      changePct,
      entryZone:
        typeof s.entry_zone_low === "number" && typeof s.entry_zone_high === "number"
          ? { low: s.entry_zone_low, high: s.entry_zone_high }
          : null,
    });
  }

  picks.sort((a, b) => {
    const r = stateRank(a.state) - stateRank(b.state);
    if (r !== 0) return r;
    return (b.score ?? -1) - (a.score ?? -1);
  });

  return { picks, summary, priorCount };
}

/**
 * One-line human summary, e.g. "6 in zone · 3 below zone · 2 at T1 · 1 stopped".
 * Only non-zero groups are listed; returns null when nothing is reportable.
 */
export function picksSummaryLine(summary) {
  if (!summary) return null;
  const parts = [];
  if (summary.in_zone) parts.push(`${summary.in_zone} in entry zone`);
  if (summary.below_zone) parts.push(`${summary.below_zone} below zone`);
  if (summary.at_t1) parts.push(`${summary.at_t1} at T1`);
  if (summary.at_t2) parts.push(`${summary.at_t2} at T2`);
  if (summary.extended) parts.push(`${summary.extended} extended`);
  if (summary.stopped) parts.push(`${summary.stopped} stopped`);
  if (summary.no_price) parts.push(`${summary.no_price} unpriced`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * "Fri Sep 4 · evening" style label from a history_index entry.
 */
export function formatSnapshotLabel(meta) {
  if (!meta || !meta.date) return "";
  const d = new Date(`${meta.date}T00:00:00Z`);
  const day = Number.isNaN(d.getTime())
    ? meta.date
    : d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  return `${day} · ${meta.slot === "pm" ? "evening scan" : "morning scan"}`;
}

/**
 * Guard: only surface the strip when the "receipts" are meaningful.
 * A prior scan with zero gate-passed names has nothing to score.
 */
export function isStripWorthy(built) {
  return Boolean(built && built.priorCount > 0 && built.picks.length > 0);
}
