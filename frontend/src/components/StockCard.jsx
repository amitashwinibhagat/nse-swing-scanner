import ScoreRing from "./ScoreRing.jsx";

const fmtINR = (v) =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtNum = (v, d = 1, suffix = "") =>
  v == null ? "—" : `${v.toFixed(d)}${suffix}`;
const tone = (v) =>
  v == null ? "" : v < 0 ? "negative" : v > 0 ? "positive" : "";

export default function StockCard({ stock, expanded, onToggle }) {
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
      aria-label={`${symbol} ${company_name} — ${gate_pass ? "pass" : "fail"}`}
    >
      <header className="stock-card-header">
        <div className="stock-card-id">
          <h3 className="stock-card-symbol">{symbol}</h3>
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
            <span className="plan-key">RR</span>{" "}
            {risk_reward_target_1.toFixed(1)}
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
