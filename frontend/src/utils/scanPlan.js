// Pure helpers for turning the static scan JSON into actionable UI state.
// No React, no I/O — safe to unit-test and reuse across card/drawer/table.

export const ENTRY_STATES = {
  IN_ZONE: "in_zone",
  EXTENDED: "extended",
  BELOW_ZONE: "below_zone",
  STOPPED: "stopped",
  AT_T1: "at_t1",
  AT_T2: "at_t2",
};

const SCORE_KEYS = [
  "valuation_compression",
  "oversold_positioning",
  "support_proximity",
  "drawdown_sweetspot",
  "volume_capitulation",
  "quality_composite",
  "conviction_holding",
];

function num(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Derive where price sits relative to the scan's stored trade plan.
 * Order matters: stop/target overrides win over zone labels so a stopped-out
 * name doesn't simultaneously show "in zone" if stop sits inside the zone.
 *
 * @param {{current_price:number, entry_zone_low:number, entry_zone_high:number,
 *          stop_loss:number, target_1:number, target_2:number}} stock
 * @returns {{state:string, label:string, tone:string, tooltip:string}|null}
 *   null when any required field is missing.
 */
export function computeEntryState(stock) {
  if (!stock) return null;
  const p = stock.current_price;
  const zl = stock.entry_zone_low;
  const zh = stock.entry_zone_high;
  const stop = stock.stop_loss;
  const t1 = stock.target_1;
  const t2 = stock.target_2;
  if (![p, zl, zh, stop, t1].every(num)) return null;

  let state = ENTRY_STATES.IN_ZONE;
  let label = "in zone";
  let tone = "success";
  let detail = `entry ₹${zl.toFixed(2)}–₹${zh.toFixed(2)}`;

  if (num(t2) && p >= t2) {
    state = ENTRY_STATES.AT_T2;
    label = `at T2`;
    tone = "accent";
    detail = `T2 ₹${t2.toFixed(2)} reached`;
  } else if (p >= t1) {
    state = ENTRY_STATES.AT_T1;
    label = `at T1`;
    tone = "accent";
    detail = `T1 ₹${t1.toFixed(2)} reached`;
  } else if (p <= stop) {
    state = ENTRY_STATES.STOPPED;
    label = "stopped";
    tone = "danger";
    detail = `stop ₹${stop.toFixed(2)} breached`;
  } else if (p > zh) {
    const over = ((p - zh) / zh) * 100;
    state = ENTRY_STATES.EXTENDED;
    label = `extended +${over.toFixed(1)}%`;
    tone = "warning";
    detail = `${over.toFixed(1)}% above zone high ₹${zh.toFixed(2)}`;
  } else if (p < zl) {
    const under = ((zl - p) / zl) * 100;
    state = ENTRY_STATES.BELOW_ZONE;
    label = `below zone`;
    tone = "warning";
    detail = `${under.toFixed(1)}% below zone low ₹${zl.toFixed(2)}`;
  }

  return {
    state,
    label,
    tone,
    tooltip: `${detail} (as of scan close)`,
  };
}

/**
 * Market-regime chip from Nifty's distance to its 200-EMA (percent).
 * Replicates backend relative_strength_factor thresholds client-side to keep
 * Phase A contract-neutral; see scanner.py::relative_strength_factor.
 */
export function regimeFromMarketIndex(idxPct) {
  if (!num(idxPct)) return null;
  let tone, label;
  if (idxPct > 2) {
    tone = "success";
    label = "Nifty > 200EMA";
  } else if (idxPct < -2) {
    tone = "danger";
    label = "Below 200EMA — be selective";
  } else {
    tone = "warning";
    label = "Near 200EMA";
  }
  const sign = idxPct > 0 ? "+" : "";
  return {
    tone,
    label,
    value: `${sign}${idxPct.toFixed(2)}% vs 200EMA`,
  };
}

/**
 * Relative-strength multiplier applied to the composite score.
 * Client-side mirror of backend/relative_strength_factor — see scanner.py.
 */
export function relativeStrengthFactor(stockPctFromEma200, idxPctFromEma200) {
  if (!num(stockPctFromEma200) || !num(idxPctFromEma200)) return 1.0;
  const delta = stockPctFromEma200 - idxPctFromEma200;
  if (delta < -10) return 0.7;
  if (delta < -5) return 0.85;
  if (idxPctFromEma200 < -5 && stockPctFromEma200 >= idxPctFromEma200 - 2)
    return 1.05;
  return 1.0;
}

/**
 * Count how many of the seven weighted sub-scores actually contributed.
 * Renormalisation means missing components change what the score means;
 * callers should surface this so the user knows.
 */
export function scoredOnCount(subScores) {
  if (!subScores || typeof subScores !== "object") return 0;
  let n = 0;
  for (const k of SCORE_KEYS) {
    const v = subScores[k];
    if (v != null && !(typeof v === "number" && !Number.isFinite(v))) n += 1;
  }
  return n;
}

export const SCORE_KEY_TOTAL = SCORE_KEYS.length;

/**
 * "DD MMM YYYY" from an ISO timestamp (e.g. "15 Jul 2026").
 */
export function formatScanDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * B3: Earnings-proximity chip. Fail-open — when yfinance couldn't fetch
 * a date (status 'missing' / 'source_failed'), returns null so the chip
 * is simply not rendered. Caps at EARNINGS_WARN_DAYS so distant dates
 * don't add noise.
 */
export const EARNINGS_WARN_DAYS = 14;

export function earningsChip(stock) {
  if (!stock) return null;
  const status = stock.earnings_source_status;
  if (status !== "ok") return null;
  const within = stock.earnings_within_days;
  const date = stock.earnings_date;
  if (typeof within !== "number" || !date) return null;
  if (within < 0) return null;
  if (within > EARNINGS_WARN_DAYS) return null;
  // Tone escalates as the date approaches.
  let tone = "warning";
  if (within <= 1) tone = "danger";
  else if (within <= 3) tone = "danger";
  return {
    label: within === 0 ? "Earnings today" : `Earnings in ${within}d`,
    tone,
    tooltip: `Earnings on ${date} (${within} trading day${within === 1 ? "" : "s"} away). Warning only — not a hard gate; yfinance NSE earnings dates are frequently missing.`,
  };
}

/**
 * B4: Human-readable label for a gate_results entry's `gate` key.
 */
export const GATE_LABELS = {
  f_score: "Piotroski F-Score ≥ 6",
  drawdown: "Drawdown −40% to −15%",
  rsi: "RSI(14) in [25, 40]",
  liquidity_adequacy: "Liquidity adequacy",
  surveillance: "Not in T-group / suspended",
  holdings_conviction: "Holdings conviction ≥ 50%",
  corporate_actions: "No pending corp action",
};

/**
 * 1.3.0: Confirmation overlay chip. A/B label, not a gate. "confirmed"
 * means early stabilization evidence (RSI turning up + last close up);
 * "anticipatory" means still a falling knife. Persisted in snapshots so
 * cohort analysis can split hit-rate by it later.
 */
export function confirmationChip(stock) {
  if (!stock) return null;
  const state = stock.confirmation_state;
  if (state !== "confirmed" && state !== "anticipatory") return null;
  const rsiDelta = stock.rsi_delta_3d;
  const volRatio = stock.vol_ratio_3v20;
  const rsiTxt = typeof rsiDelta === "number" ? `RSI 3d Δ ${rsiDelta > 0 ? "+" : ""}${rsiDelta.toFixed(1)}` : "";
  const volTxt = typeof volRatio === "number" ? `vol 3/20 ${volRatio.toFixed(2)}` : "";
  const detail = [rsiTxt, volTxt].filter(Boolean).join(" · ");
  if (state === "confirmed") {
    return {
      label: "Confirmed",
      tone: "success",
      tooltip: `Early stabilization evidence (RSI turning up + last close up). ${detail}. A/B label — cohort analysis will measure whether confirmed entries outperform anticipatory ones.`,
    };
  }
  return {
    label: "Anticipatory",
    tone: "warning",
    tooltip: `No stabilization evidence yet — buying during the decline. ${detail}. A/B label — these are the baseline cohort; do not assume they underperform until the data says so.`,
  };
}

/**
 * 1.3.0: Exit-side expectancy warnings. Computable now from fields already
 * in the JSON; no prediction needed, just R:R asymmetry flags.
 *
 *   warning_1: T1 capped by nearby swing high (entry_high < swing_high_63d < target_1)
 *   warning_2: ATR expanding (atr_expansion_ratio > 1.3 → stop likely too tight)
 */
export function exitWarnings(stock) {
  if (!stock) return [];
  const out = [];
  const eh = stock.entry_zone_high;
  const t1 = stock.target_1;
  const sh = stock.swing_high_63d;
  if (typeof eh === "number" && typeof t1 === "number" && typeof sh === "number") {
    if (eh < sh && sh < t1) {
      const pctBelow = ((t1 - sh) / t1) * 100;
      out.push({
        key: "t1_capped",
        label: `T1 capped by swing high ₹${sh.toFixed(0)}`,
        detail: `Recent 3-month swing high sits ₹${(t1 - sh).toFixed(0)} (${pctBelow.toFixed(1)}%) below T1 — measured-move target is structurally optimistic.`,
        tone: "warning",
      });
    }
  }
  const ae = stock.atr_expansion_ratio;
  if (typeof ae === "number" && ae > 1.3) {
    out.push({
      key: "atr_expanding",
      label: `Volatility expanding (ATR ×${ae.toFixed(2)} vs 20d ago)`,
      detail: `ATR(14) is ${((ae - 1) * 100).toFixed(0)}% above its value 20 sessions ago. The 1.0×ATR stop is likely to be clipped — consider a wider stop or smaller size.`,
      tone: "warning",
    });
  }
  return out;
}