import { useEffect, useMemo, useRef, useState } from "react";
import ScoreRing from "./ScoreRing.jsx";
import DonutHoldings from "./DonutHoldings.jsx";
import SubscoreBars from "./SubscoreBars.jsx";
import {
  computeEntryState,
  confirmationChip,
  earningsChip,
  exitWarnings,
  GATE_LABELS,
  relativeStrengthFactor,
  formatScanDate,
  scoredOnCount,
  SCORE_KEY_TOTAL,
} from "../utils/scanPlan.js";

const fmtINR = (v) =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtCr = (v) => (v == null ? "—" : (v / 1_00_00_000).toFixed(1));
const fmtNum = (v, d = 1, suffix = "") =>
  v == null ? "—" : `${v.toFixed(d)}${suffix}`;

const SIZING_KEY = "nseSwingSizing";

function readSizing() {
  if (typeof window === "undefined") return { capital: 500000, riskPct: 1.0 };
  try {
    const raw = localStorage.getItem(SIZING_KEY);
    if (!raw) return { capital: 500000, riskPct: 1.0 };
    const v = JSON.parse(raw);
    const capital = Number.isFinite(+v.capital) && +v.capital > 0 ? +v.capital : 500000;
    const riskPct = Number.isFinite(+v.riskPct) && +v.riskPct > 0 ? +v.riskPct : 1.0;
    return { capital, riskPct };
  } catch {
    return { capital: 500000, riskPct: 1.0 };
  }
}

function PositionSizer({ stock }) {
  const [sizing, setSizing] = useState(readSizing);

  useEffect(() => {
    try {
      localStorage.setItem(SIZING_KEY, JSON.stringify(sizing));
    } catch {
      /* ignore */
    }
  }, [sizing]);

  const calc = useMemo(() => {
    const { capital, riskPct } = sizing;
    const zh = stock.entry_zone_high;
    const stop = stock.stop_loss;
    if (
      !(
        typeof capital === "number" &&
        capital > 0 &&
        typeof riskPct === "number" &&
        riskPct > 0 &&
        typeof zh === "number" &&
        typeof stop === "number" &&
        stop < zh
      )
    ) {
      return null;
    }
    // Size off the TOP of the zone (worst-case fill) so risk is never
    // understated; stop distance from zone-high fill = 1.25·ATR.
    const distance = zh - stop;
    const riskAmount = capital * (riskPct / 100);
    const shares = Math.floor(riskAmount / distance);
    const notional = shares * zh;
    return { shares, notional, riskAmount, distance };
  }, [sizing, stock]);

  return (
    <section className="drawer-section">
      <h4>Position sizing</h4>
      <div className="sizer-grid">
        <label className="sizer-field">
          <span className="sizer-label">Capital ₹</span>
          <input
            type="number"
            min="0"
            step="1000"
            value={sizing.capital}
            onChange={(e) =>
              setSizing((s) => ({ ...s, capital: Math.max(0, +e.target.value || 0) }))
            }
          />
        </label>
        <label className="sizer-field">
          <span className="sizer-label">Risk per trade %</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={sizing.riskPct}
            onChange={(e) =>
              setSizing((s) => ({
                ...s,
                riskPct: Math.max(0, Math.min(100, +e.target.value || 0)),
              }))
            }
          />
        </label>
      </div>
      {calc ? (
        <ul className="kv sizer-results">
          <li>
            <span>Shares (worst-case fill at zone high)</span>
            <b>{calc.shares.toLocaleString("en-IN")}</b>
          </li>
          <li>
            <span>₹ risked ({(sizing.riskPct).toFixed(2)}% of capital)</span>
            <b>{fmtINR(calc.riskAmount)}</b>
          </li>
          <li>
            <span>Position notional</span>
            <b>{fmtINR(calc.notional)}</b>
          </li>
          <li>
            <span>
              Stop distance{" "}
              <span
                className="gate-path"
                title="Sized off zone-high − stop (1.25·ATR), the worst case if price tags the top of the entry zone."
              >
                zone-high
              </span>
            </span>
            <b>{fmtINR(calc.distance)}</b>
          </li>
        </ul>
      ) : (
        <p className="na">Set capital and risk %, and ensure the stock has an entry zone + stop.</p>
      )}
      <p className="sizer-note">
        Sized off entry-zone <em>high</em> − stop (worst-case fill). When price
        is already extended above the zone, the realistic fill is worse than
        this calculation — reduce shares or wait for a pullback.
      </p>
    </section>
  );
}

export default function DetailDrawer({ stock, onClose, watchlist, scanDate }) {
  const closeRef = useRef(null);

  // Esc to close + scroll lock
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!stock) return null;

  const entryState = computeEntryState(stock);
  const conf = confirmationChip(stock);
  const exits = exitWarnings(stock);
  const ea = earningsChip(stock);
  const watched = watchlist?.has?.(stock.symbol) ?? false;
  const rsFactor = relativeStrengthFactor(
    stock.pct_from_ema200,
    stock.market_index_pct_from_ema200,
  );
  const n = scoredOnCount(stock.sub_scores);
  const dateLabel = formatScanDate(scanDate);

  return (
    <div
      className="drawer-overlay"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <header className="drawer-header">
          <div className="drawer-title-block">
            <div className="drawer-title-row">
              <h2 id="drawer-title">{stock.symbol}</h2>
              {watchlist && (
                <button
                  type="button"
                  className={`watch-star lg ${watched ? "on" : ""}`}
                  onClick={() => watchlist.toggle(stock.symbol)}
                  aria-pressed={watched}
                  aria-label={
                    watched
                      ? `Remove ${stock.symbol} from watchlist`
                      : `Add ${stock.symbol} to watchlist`
                  }
                  title={watched ? "Remove from watchlist" : "Add to watchlist"}
                >
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <path
                      d="M10 2.5l2.47 5 5.53.8-4 3.9.94 5.5L10 14.98 5.06 17.7l.94-5.5-4-3.9 5.53-.8L10 2.5z"
                      fill={watched ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
            <p className="drawer-sub">
              {stock.company_name}
              {stock.industry ? ` · ${stock.industry}` : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close detail"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-hero">
            <div className="drawer-hero-left">
              <div className="drawer-price-block">
                <span className="drawer-price">{fmtINR(stock.current_price)}</span>
                <span
                  className={
                    stock.pct_off_52wk_high == null
                      ? ""
                      : stock.pct_off_52wk_high < 0
                      ? "negative"
                      : "positive"
                  }
                >
                  {fmtNum(stock.pct_off_52wk_high, 1, "%")} off 52W
                </span>
              </div>
              <span
                className={`gate-badge ${stock.gate_pass ? "pass" : "fail"}`}
                style={{ marginTop: 8 }}
              >
                {stock.gate_pass ? "GATES PASSED" : "GATES FAILED"}
              </span>
              {!stock.gate_pass && stock.gate_fail_reason && (
                <div className="fail-reason" style={{ marginTop: 8 }}>
                  Gate fail: {stock.gate_fail_reason}
                </div>
              )}
              {entryState && (
                <div
                  className={`entry-state lg entry-${entryState.tone}`}
                  title={entryState.tooltip}
                >
                  <span className="entry-state-dot" aria-hidden="true" />
                  {entryState.label}
                  {dateLabel && (
                    <span className="entry-state-asof">as of {dateLabel} close</span>
                  )}
                </div>
              )}
              {ea && (
                <div
                  className={`entry-state lg entry-${ea.tone}`}
                  title={ea.tooltip}
                >
                  <span className="entry-state-dot" aria-hidden="true" />
                  {ea.label}
                </div>
              )}
              {conf && (
                <div
                  className={`entry-state lg entry-${conf.tone}`}
                  title={conf.tooltip}
                >
                  <span className="entry-state-dot" aria-hidden="true" />
                  {conf.label}
                </div>
              )}
            </div>
            <ScoreRing score={stock.swing_score} size={104} strokeWidth={7} />
          </section>

          <div className="detail-grid">
            <div>
              <h4>Hard gates</h4>
              {Array.isArray(stock.gate_results) && stock.gate_results.length > 0 ? (
                <ul className="kv gate-checklist">
                  {stock.gate_results.map((g) => {
                    const detail = _gateDetail(g.gate, stock);
                    return (
                      <li key={g.gate} className={g.passed ? "gate-passed" : "gate-failed"}>
                        <span>
                          <span className={`gate-tick ${g.passed ? "yes" : "no"}`} aria-hidden="true">
                            {g.passed ? "✓" : "✗"}
                          </span>
                          {GATE_LABELS[g.gate] || g.gate}
                          {detail && <span className="gate-inline-value"> · {detail}</span>}
                        </span>
                        <b title={g.reason || ""}>
                          {g.passed ? "pass" : (g.reason || "fail")}
                        </b>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <ul className="kv">
                  <li>
                    <span>F-Score</span>
                    <b>{stock.f_score ?? "—"}/9</b>
                  </li>
                  <li>
                    <span>Liquidity / ADV (₹cr){stock.liquidity_gate_path && <span className="gate-path"> {stock.liquidity_gate_path}</span>}</span>
                    <b>{fmtCr(stock.adv_value_inr)}</b>
                  </li>
                  <li>
                    <span>Holdings conviction</span>
                    <b>{fmtNum(stock.holdings_conviction_pct, 1, "%")}</b>
                  </li>
                  <li>
                    <span>T-group / suspension</span>
                    <b>
                      {stock.surveillance_is_restricted
                        ? `YES (${stock.surveillance_restriction_type})`
                        : "no"}
                    </b>
                  </li>
                  <li>
                    <span>Pending corp action</span>
                    <b>{stock.pending_corporate_action ? "YES" : "no"}</b>
                  </li>
                </ul>
              )}
            </div>
            <div>
              <h4>
                ATR plan
                {dateLabel && (
                  <span className="plan-asof">
                    as of {dateLabel} close
                  </span>
                )}
              </h4>
              <ul className="kv">
                <li>
                  <span>ATR(14)</span>
                  <b>{fmtINR(stock.atr14)}</b>
                </li>
                <li>
                  <span>Entry zone</span>
                  <b>
                    {stock.entry_zone_low != null
                      ? `${fmtINR(stock.entry_zone_low)} – ${fmtINR(
                          stock.entry_zone_high
                        )}`
                      : "—"}
                  </b>
                </li>
                <li>
                  <span>Stop</span>
                  <b>{fmtINR(stock.stop_loss)}</b>
                </li>
                <li>
                  <span>
                    Target 1 (R:R){" "}
                    <span
                      className="gate-path"
                      title="R:R to T1 is a fixed 1.5×ATR multiple from entry mid; does not discriminate between candidates."
                    >
                      fixed
                    </span>
                  </span>
                  <b>
                    {fmtINR(stock.target_1)} (
                    {stock.risk_reward_target_1?.toFixed(2) ?? "—"})
                  </b>
                </li>
                <li>
                  <span>
                    Target 2 (R:R){" "}
                    <span
                      className="gate-path"
                      title="R:R to T2 is a fixed 2.5×ATR multiple from entry mid."
                    >
                      fixed
                    </span>
                  </span>
                  <b>
                    {fmtINR(stock.target_2)} (
                    {stock.risk_reward_target_2?.toFixed(2) ?? "—"})
                  </b>
                </li>
              </ul>
            </div>
            <div>
              <h4>Source status</h4>
              <ul className="kv">
                <li>
                  <span>Delivery</span>
                  <b className={`src-${stock.delivery_source_status || "missing"}`}>
                    {stock.delivery_source_status || "missing"}
                  </b>
                </li>
                <li>
                  <span>Surveillance</span>
                  <b className={`src-${stock.surveillance_source_status || "missing"}`}>
                    {stock.surveillance_source_status || "missing"}
                  </b>
                </li>
                <li>
                  <span>Holdings</span>
                  <b className={`src-${stock.holdings_source_status || "missing"}`}>
                    {stock.holdings_source_status || "missing"}
                  </b>
                </li>
                <li>
                  <span>Corp actions</span>
                  <b className={`src-${stock.corporate_actions_status || "missing"}`}>
                    {stock.corporate_actions_status || "missing"}
                  </b>
                </li>
                <li>
                  <span>Nifty 50 vs 200EMA</span>
                  <b>{fmtNum(stock.market_index_pct_from_ema200, 2, "%")}</b>
                </li>
              </ul>
            </div>
            <div>
              <h4>Holdings mix</h4>
              {stock.holdings_promoter_pct != null ? (
                <div className="donut-block">
                  <DonutHoldings
                    promoter={stock.holdings_promoter_pct}
                    fii={stock.holdings_fii_pct}
                    dii={stock.holdings_dii_pct}
                    size={96}
                  />
                  <ul className="kv donut-legend">
                    <li>
                      <span>
                        <span className="dot dot-accent" /> Promoter
                      </span>
                      <b>{fmtNum(stock.holdings_promoter_pct, 1, "%")}</b>
                    </li>
                    <li>
                      <span>
                        <span className="dot dot-success" /> FII
                      </span>
                      <b>{fmtNum(stock.holdings_fii_pct, 1, "%")}</b>
                    </li>
                    <li>
                      <span>
                        <span className="dot dot-warning" /> DII
                      </span>
                      <b>{fmtNum(stock.holdings_dii_pct, 1, "%")}</b>
                    </li>
                  </ul>
                </div>
              ) : (
                <p className="na">No holdings breakdown available</p>
              )}
            </div>
          </div>

          <PositionSizer stock={stock} />

          {exits.length > 0 && (
            <section className="drawer-section exit-warnings">
              <h4>Exit-side warnings</h4>
              <ul className="kv">
                {exits.map((w) => (
                  <li key={w.key} className="exit-warning-row">
                    <span title={w.detail}>{w.label}</span>
                    <b className="exit-warning-detail">{w.detail}</b>
                  </li>
                ))}
              </ul>
              <p className="sizer-note">
                Expectancy warnings — not predictions. These flag structural
                R:R asymmetry (T1 capped by nearby resistance, or stop too
                tight given expanding volatility) so you can adjust size or
                skip the trade.
              </p>
            </section>
          )}

          <section className="drawer-section">
            <h4>
              Soft score breakdown{" "}
              {n < SCORE_KEY_TOTAL && (
                <span
                  className="plan-asof"
                  title={`Composite score was computed over ${n} of ${SCORE_KEY_TOTAL} weighted components; missing components renormalise the weight — score not directly comparable to a 7-component score.`}
                >
                  scored on {n}/{SCORE_KEY_TOTAL}
                </span>
              )}
            </h4>
            <SubscoreBars
              subScores={stock.sub_scores}
              marketCorrectionFactor={rsFactor}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}

// Compact inline value shown next to each gate's ✓/✗ so the underlying
// numbers (F-Score, ADV, holdings %, etc.) stay one glance away.
function _gateDetail(gate, stock) {
  switch (gate) {
    case "f_score":
      return stock.f_score != null ? `F-Score ${stock.f_score}/9` : null;
    case "liquidity_adequacy":
      return stock.adv_value_inr != null
        ? `ADV ₹${fmtCr(stock.adv_value_inr)} cr${stock.liquidity_gate_path ? ` (${stock.liquidity_gate_path})` : ""}`
        : null;
    case "holdings_conviction":
      return stock.holdings_conviction_pct != null
        ? `${stock.holdings_conviction_pct.toFixed(1)}%`
        : null;
    case "drawdown":
      return stock.pct_off_52wk_high != null
        ? `${stock.pct_off_52wk_high.toFixed(1)}% off 52W`
        : null;
    case "rsi":
      return stock.rsi14 != null ? `RSI ${stock.rsi14.toFixed(1)}` : null;
    case "surveillance":
      return stock.surveillance_is_restricted
        ? `${stock.surveillance_restriction_type || "restricted"}`
        : "clear";
    case "corporate_actions":
      return stock.pending_corporate_action ? "excluded action in window" : "clear";
    default:
      return null;
  }
}