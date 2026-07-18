import ScoreRing from "./ScoreRing.jsx";
import { computeEntryState, confirmationChip, earningsChip } from "../utils/scanPlan.js";

const fmtINR = (v) =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtNum = (v, d = 1, suffix = "") =>
  v == null ? "—" : `${v.toFixed(d)}${suffix}`;
const tone = (v) =>
  v == null ? "" : v < 0 ? "negative" : v > 0 ? "positive" : "";

function StarButton({ on, onToggle, symbol, stop }) {
  return (
    <button
      type="button"
      className={`watch-star ${on ? "on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(symbol);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-pressed={on}
      aria-label={on ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
    >
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path
          d="M10 2.5l2.47 5 5.53.8-4 3.9.94 5.5L10 14.98 5.06 17.7l.94-5.5-4-3.9 5.53-.8L10 2.5z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export default function StockCard({ stock, expanded, onToggle, watchlist }) {
  const {
    symbol,
    company_name,
    industry,
    swing_score,
    current_price,
    pct_off_52wk_high,
    rsi14,
    f_score,
    target_1,
    stop_loss,
    risk_reward_target_1,
    gate_pass,
    gate_fail_reason,
  } = stock;

  const entryState = computeEntryState(stock);
  const conf = confirmationChip(stock);
  const ea = earningsChip(stock);
  const watched = watchlist?.has?.(symbol) ?? false;

  return (
    <article
      className="stock-card"
      data-pass={gate_pass}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      tabIndex={0}
      role="button"
      aria-expanded={expanded}
      aria-label={`${symbol} ${company_name} — ${gate_pass ? "pass" : "fail"}${
        entryState ? ` — ${entryState.label}` : ""
      }`}
    >
      <header className="stock-card-header">
        <div className="stock-card-id">
          <div className="stock-card-title-row">
            <h3 className="stock-card-symbol">{symbol}</h3>
            {watchlist && (
              <StarButton
                on={watched}
                onToggle={watchlist.toggle}
                symbol={symbol}
              />
            )}
          </div>
          <p className="stock-card-company">{company_name}</p>
          {industry && (
            <span className="stock-card-industry">{industry}</span>
          )}
        </div>
        <ScoreRing score={swing_score} />
      </header>

      <div className="stock-card-metrics">
        <Metric label="Price" value={fmtINR(current_price)} />
        <Metric
          label="% off 52W"
          value={fmtNum(pct_off_52wk_high, 1, "%")}
          tone={tone(pct_off_52wk_high)}
        />
        <Metric label="RSI" value={fmtNum(rsi14, 0)} />
        <Metric
          label="F-Score"
          value={f_score != null ? `${f_score}/9` : "—"}
        />
      </div>

      {entryState && (
        <div
          className={`entry-state entry-${entryState.tone}`}
          title={entryState.tooltip}
        >
          <span className="entry-state-dot" aria-hidden="true" />
          {entryState.label}
          <span className="entry-state-asof">as of scan close</span>
        </div>
      )}

      {ea && (
        <div
          className={`entry-state entry-${ea.tone}`}
          title={ea.tooltip}
        >
          <span className="entry-state-dot" aria-hidden="true" />
          {ea.label}
        </div>
      )}

      {conf && (
        <div
          className={`entry-state entry-${conf.tone}`}
          title={conf.tooltip}
        >
          <span className="entry-state-dot" aria-hidden="true" />
          {conf.label}
        </div>
      )}

      <div className="stock-card-plan">
        {target_1 != null && (
          <span>
            <span className="plan-key">T1</span> {fmtINR(target_1)}
          </span>
        )}
        {stop_loss != null && (
          <span>
            <span className="plan-sep">·</span>
            <span className="plan-key">Stop</span> {fmtINR(stop_loss)}
          </span>
        )}
        {risk_reward_target_1 != null && (
          <span>
            <span className="plan-sep">·</span>
            <span
              className="plan-key"
              title="R:R to T1 is a fixed 1.5×ATR multiple from entry mid (see methodology). Displayed for completeness; it does not discriminate between candidates."
            >
              RR
            </span>{" "}
            <span title="Fixed 1.5×ATR multiple from entry mid; see methodology.">
              {risk_reward_target_1.toFixed(1)}
              <span className="plan-fixed-tag" title="Constant across all candidates">
                {" "}(fixed)
              </span>
            </span>
          </span>
        )}
      </div>

      <footer className="stock-card-footer">
        <span className={`gate-badge ${gate_pass ? "pass" : "fail"}`}>
          {gate_pass ? "PASS" : "FAIL"}
        </span>
        {!gate_pass && gate_fail_reason && (
          <span
            className="stock-card-fail-reason"
            title={gate_fail_reason}
          >
            {gate_fail_reason}
          </span>
        )}
      </footer>
    </article>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="stock-card-metric">
      <div className="kpi-label">{label}</div>
      <div className={`stock-card-value ${tone || ""}`}>{value}</div>
    </div>
  );
}