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
  // Degenerate plan: the scanner sets entry_zone_high = current_price, so a
  // *fresh* row always sits exactly on the zone boundary. Evaluating the plan
  // against its own close therefore always yields "in zone" — see
  // evaluatePlanState below for the honest version.

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
 * Where a *stored plan* sits relative to a *later* price.
 *
 * The scanner's plan is anchored to the scan close: `entry_zone_high` **is**
 * `current_price` (`technicals.py`). So calling `computeEntryState` on a fresh
 * row always returns `in_zone`, and the card's action banner therefore told
 * every pick "In the buy zone — consider entering now", every day, forever.
 * That is not a signal, it is a tautology dressed as advice.
 *
 * This function takes the plan (from a previous snapshot) and today's price,
 * which is the only combination that can actually be in, above or below the
 * zone. `delta.js` and `recentPicks.js` already do this; the cards now use the
 * same primitive.
 *
 * @param {{entry_zone_low:number, entry_zone_high:number, stop_loss:number,
 *          target_1:number, target_2?:number}} plan
 * @param {number} price  a price observed after the plan was written
 */
export function evaluatePlanState(plan, price) {
  if (!plan || !num(price)) return null;
  const zl = plan.entry_zone_low;
  const zh = plan.entry_zone_high;
  const stop = plan.stop_loss;
  const t1 = plan.target_1;
  const t2 = plan.target_2;
  if (![zl, zh, stop, t1].every(num)) return null;

  if (num(t2) && price >= t2) {
    return { state: ENTRY_STATES.AT_T2, label: "at T2", tone: "accent" };
  }
  if (price >= t1) {
    return { state: ENTRY_STATES.AT_T1, label: "at T1", tone: "accent" };
  }
  if (price <= stop) {
    return { state: ENTRY_STATES.STOPPED, label: "stopped", tone: "danger" };
  }
  if (price > zh) {
    const over = ((price - zh) / zh) * 100;
    return { state: ENTRY_STATES.EXTENDED, label: `extended +${over.toFixed(1)}%`, tone: "warning" };
  }
  if (price < zl) {
    return { state: ENTRY_STATES.BELOW_ZONE, label: "below zone", tone: "warning" };
  }
  return { state: ENTRY_STATES.IN_ZONE, label: "in zone", tone: "success" };
}

/**
 * Customer-facing action for a pick.
 *
 * When a *prior* plan is available the state is computed against the current
 * price (honest). When it is not (first scan ever, or a name that is new to
 * the shortlist), the action is derived from the plan's own geometry and says
 * so — rather than claiming the price is "in the zone" by construction.
 *
 * @param {object} stock current scan row
 * @param {object|null} priorPlan entry/stop/target levels from a prior snapshot
 */
export function planAction(stock, priorPlan) {
  if (!stock) return null;
  if (priorPlan) {
    const state = evaluatePlanState(priorPlan, stock.current_price);
    if (!state) return null;
    const mapped = actionForState(state.state);
    return mapped ? { ...mapped, basis: "prior_plan" } : null;
  }
  const own = computeEntryState(stock);
  if (!own) return null;
  const mapped = actionForState(own.state);
  return mapped ? { ...mapped, basis: "plan_only" } : null;
}

/** Map an entry state to the verb shown on the card. */
export function actionForState(state) {
  switch (state) {
    case ENTRY_STATES.IN_ZONE:
      return { tone: "success", label: "In the buy zone", detail: "Consider entering now — levels are below." };
    case ENTRY_STATES.BELOW_ZONE:
      return { tone: "warning", label: "Below the buy zone", detail: "Wait for a close back above the zone before entering." };
    case ENTRY_STATES.EXTENDED:
      return { tone: "warning", label: "Above the buy zone", detail: "Do not chase — wait for a pullback into the zone." };
    case ENTRY_STATES.AT_T1:
      return { tone: "accent", label: "At target 1", detail: "Book part of the position or trail the stop." };
    case ENTRY_STATES.AT_T2:
      return { tone: "accent", label: "At target 2", detail: "The plan has largely played out — book or trail." };
    case ENTRY_STATES.STOPPED:
      return { tone: "danger", label: "Stop breached", detail: "The setup is invalidated — stand aside." };
    default:
      return null;
  }
}

/**
 * Customer-facing action for a pick, derived from where price sits relative
 * to the stored plan. Turns the mechanical entry-state label into a verb the
 * customer can act on tonight. Levels themselves live in the plan grid.
 *
 * Thin wrapper over `actionForState`: `planAction` is the preferred entry
 * point because this one can only ever see the plan at its own scan close.
 */
export function entryAction(stock) {
  const es = computeEntryState(stock);
  return es ? actionForState(es.state) : null;
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
 * Relative-strength penalty, in score points. Client-side mirror of
 * backend/scanner.py::relative_strength_penalty.
 *
 * ADDITIVE on purpose: the old multiplier capped the attainable score
 * (base x 0.70 <= 70) and made the top band unreachable for heavily-penalised
 * names. Returns 0 / 8 / 15 points.
 */
export function relativeStrengthPenalty(stockPctFromEma200, idxPctFromEma200) {
  if (!num(stockPctFromEma200) || !num(idxPctFromEma200)) return 0;
  const delta = stockPctFromEma200 - idxPctFromEma200;
  if (delta < -10) return HARD_PENALTY;
  if (delta < -5) return MILD_PENALTY;
  return 0;
}

// Mirrors settings.RELATIVE_STRENGTH_HARD/MILD_PENALTY.
const HARD_PENALTY = 15;
const MILD_PENALTY = 8;

/**
 * The penalty expressed as the equivalent multiplier of the base score, for
 * display only ("market adjustment x0.85"). Never multiply a score by this —
 * that is the behaviour the additive change removed.
 */
export function relativeStrengthFactor(stockPctFromEma200, idxPctFromEma200) {
  const penalty = relativeStrengthPenalty(stockPctFromEma200, idxPctFromEma200);
  if (penalty === 0) return 1.0;
  // Without the base score to hand, report the multiplier the penalty implies
  // at the typical base (~65), matching what the scanner publishes per row.
  return Number((1 - penalty / 65).toFixed(2));
}

/**
 * Count how many of the weighted sub-scores actually contributed.
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
 * 1.4.0: Score-band evidence chip from the forward-return tracker.
 *
 * Maps the swing score to its pass_v4 band and surfaces what the outcome
 * tracker currently measures from the supplied performance payload:
 *   - 72+ (the top band; formerly 63+ under pass_v3): chip only when the
 *     mean excess vs Nifty has a 95% bootstrap CI above zero at T+5, T+10 AND
 *     T+20.
 *   - 62-68 (formerly 55-60): chip only when the T+5 CI is BELOW zero, i.e.
 *     the tracker actively measured underperformance.
 *   - everything else: no chip. Absence of a chip is the honest signal for a
 *     band whose interval straddles zero.
 *
 * Deliberately NOT a gate: single market regime, ~6 weeks of data, and the
 * 1.3.0 rule stands — no new hard gates until existing ones are validated.
 * Revisit as cohorts accumulate; the tracker owns the truth, this only
 * mirrors it.
 */
// Mirrors backend/performance.py BUCKET_BANDS (pass_v4). Keep in sync.
const TOP_BAND_LABEL = "74+";
const TOP_BAND_MIN = 74;
const WEAK_BAND_LABEL = "64-70";
const WEAK_BAND_MIN = 64;
const WEAK_BAND_MAX = 70;

export function scoreBandChip(score, performance) {
  if (!num(score)) return null;
  const evidence = (window) => performance?.windows?.[window]?.buckets;
  // Band labels come from the tracker payload, not literals: they were
  // recalibrated in pass_v4 (63+ -> 74+) when the score scale changed.
  if (score >= TOP_BAND_MIN) {
    const cells = ["T+5", "T+10", "T+20"].map((window) => ({
      window,
      cell: evidence(window)?.[TOP_BAND_LABEL],
    }));
    const established = cells.every(({ cell }) =>
      cell && cell.n >= 20 && cell.ci95 && cell.ci95.low > 0
    );
    if (!established) return null;
    const detail = cells
      .map(({ window, cell }) => `${window} n=${cell.n}, CI +${cell.ci95.low} to +${cell.ci95.high}`)
      .join("; ");
    return {
      label: `Top band ${TOP_BAND_LABEL}`,
      tone: "success",
      tooltip:
        `Forward-return tracker: the ${TOP_BAND_LABEL} band's 95% CI is above zero at T+5, T+10 and T+20 (${detail}). Only band with an established edge in the available history; descriptive, not predictive.`,
    };
  }
  if (score >= WEAK_BAND_MIN && score < WEAK_BAND_MAX) {
    const cell = evidence("T+5")?.[WEAK_BAND_LABEL];
    if (!cell || cell.n < 20 || !cell.ci95 || cell.ci95.high >= 0) return null;
    return {
      label: `Weak band ${WEAK_BAND_LABEL}`,
      tone: "warning",
      tooltip:
        `Forward-return tracker: the ${WEAK_BAND_LABEL} band's T+5 CI is below zero (n=${cell.n}, CI ${cell.ci95.low} to ${cell.ci95.high}). This band underperformed in the available history; prefer the ${TOP_BAND_LABEL} band or demand confirmation.`,
    };
  }
  return null;
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
