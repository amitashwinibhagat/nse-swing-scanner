// Pure shortlist logic: which gate-passed names have an evidenced edge, why,
// and how strong. No React, no I/O.
//
// The shortlist threshold is the top band of the tracker's CURRENT bucket
// scheme (pass_v4), which is itself a recalibration of the old pass_v3 "63+"
// band onto the weights-2026-11-v2 score scale — same 18% selection share, not
// a new hypothesis. This module mirrors backend/performance.py so the
// dashboard can never drift from the tracker (check_cron_consistency.py
// asserts the top cut matches performance.BUCKET_BANDS[0]).

export const TOP_PICK_MIN_SCORE = 74;

// Descending inclusive lower bounds — mirrors BUCKET_BANDS in
// backend/performance.py (pass_v4). Update both together; the backend CI guard
// and picks.test.js pin the top label.
const BUCKET_BANDS = [
  ["74+", 74],
  ["70-74", 70],
  ["64-70", 64],
  ["53-64", 53],
];

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

export function bandOf(score) {
  if (!isNum(score)) return null;
  for (const [label, lower] of BUCKET_BANDS) {
    if (score >= lower) return label;
  }
  return "<53";
}

// Mirrors regime_tag in backend/performance.py.
export function regimeKeyOf(idxPctFromEma200) {
  if (!isNum(idxPctFromEma200)) return "unknown";
  if (idxPctFromEma200 > 2) return "risk_on";
  if (idxPctFromEma200 < -2) return "risk_off";
  return "neutral";
}

/** Upside to T1 from the scan close, as a percentage. Null when incomputable. */
export function upsideToT1(stock) {
  if (!stock) return null;
  const p = stock.current_price;
  const t1 = stock.target_1;
  if (!isNum(p) || !isNum(t1) || p <= 0) return null;
  return ((t1 - p) / p) * 100;
}

/**
 * Why this name cleared the shortlist. Ordered positives first, then caution.
 * Every reason is derived from a field already in the scan JSON — nothing is
 * inferred or invented.
 */
export function pickReasons(stock) {
  if (!stock) return [];
  const out = [];
  const push = (key, label, tone = "accent") => out.push({ key, label, tone });
  const sub = stock.sub_scores || {};

  if (stock.confirmation_state === "confirmed") {
    const d = isNum(stock.rsi_delta_3d)
      ? ` (RSI 3d ${stock.rsi_delta_3d > 0 ? "+" : ""}${stock.rsi_delta_3d.toFixed(0)})`
      : "";
    push("confirmed", `Turning up${d}`, "success");
  }
  if (isNum(stock.f_score) && stock.f_score >= 8) {
    push("fscore", `Quality ${stock.f_score.toFixed(0)}/9 F-Score`, "success");
  }
  if (isNum(stock.holdings_conviction_pct) && stock.holdings_conviction_pct >= 70) {
    push(
      "conviction",
      `${stock.holdings_conviction_pct.toFixed(0)}% held by promoters/institutions`,
      "success"
    );
  }
  if (isNum(stock.rsi14) && stock.rsi14 <= 35) {
    push("rsi", `Oversold RSI ${stock.rsi14.toFixed(0)}`, "accent");
  }
  if (isNum(stock.pct_from_ema200) && stock.pct_from_ema200 <= 2) {
    push(
      "ema",
      stock.pct_from_ema200 >= 0 ? "At the 200-day EMA" : "Below the 200-day EMA",
      "accent"
    );
  }
  if (isNum(sub.volume_capitulation) && sub.volume_capitulation >= 0.8) {
    push("vol", "Volume capitulation", "accent");
  }
  if (isNum(sub.valuation_compression) && sub.valuation_compression >= 0.7) {
    push("valuation", "Cheap vs own 5Y P/E", "accent");
  }

  if (isNum(stock.earnings_within_days) && stock.earnings_within_days >= 0 && stock.earnings_within_days <= 7) {
    push(
      "earnings",
      stock.earnings_within_days === 0 ? "Earnings today" : `Earnings in ${stock.earnings_within_days}d`,
      "warning"
    );
  }
  if (stock.confirmation_state === "anticipatory") {
    push("anticipatory", "No reversal signal yet", "warning");
  }
  return out;
}

export function isTopPick(stock) {
  return Boolean(
    stock &&
      stock.gate_pass &&
      isNum(stock.swing_score) &&
      stock.swing_score >= TOP_PICK_MIN_SCORE
  );
}

/**
 * Split a scan's stocks into the three surfaces the simplified dashboard
 * needs: top picks (evidenced edge), on-deck (gates passed, no evidenced
 * edge), and the rest. Sorting is stable and score-descending.
 */
export function splitShortlist(stocks) {
  const all = Array.isArray(stocks) ? stocks : [];
  const byScoreDesc = (a, b) => (b.swing_score || 0) - (a.swing_score || 0);
  const topPicks = all.filter(isTopPick).sort(byScoreDesc);
  const passed = all.filter((s) => s.gate_pass);
  const onDeck = passed.filter((s) => !isTopPick(s)).sort(byScoreDesc);
  const screened = all.filter((s) => !s.gate_pass);
  return {
    topPicks,
    onDeck,
    screened,
    passed,
    counts: {
      universe: all.length,
      passed: passed.length,
      topPicks: topPicks.length,
      onDeck: onDeck.length,
      screened: screened.length,
    },
  };
}
