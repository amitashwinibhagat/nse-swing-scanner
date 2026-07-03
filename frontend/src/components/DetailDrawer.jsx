import { useEffect, useRef } from "react";
import ScoreRing from "./ScoreRing.jsx";
import DonutHoldings from "./DonutHoldings.jsx";
import SubscoreBars from "./SubscoreBars.jsx";

const fmtINR = (v) =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtCr = (v) => (v == null ? "—" : (v / 1_00_00_000).toFixed(1));
const fmtNum = (v, d = 1, suffix = "") =>
  v == null ? "—" : `${v.toFixed(d)}${suffix}`;

export default function DetailDrawer({ stock, onClose }) {
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
            <h2 id="drawer-title">{stock.symbol}</h2>
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
            </div>
            <ScoreRing score={stock.swing_score} size={104} strokeWidth={7} />
          </section>

          <div className="detail-grid">
            <div>
              <h4>Hard gates</h4>
              <ul className="kv">
                <li>
                  <span>F-Score</span>
                  <b>{stock.f_score ?? "—"}/9</b>
                </li>
                <li>
                  <span>
                    {stock.delivery_kind === "traded_value_proxy" ? "Traded val (₹cr)" : "Delivery (₹cr)"}
                    {stock.delivery_kind === "traded_value_proxy" && (
                      <span className="proxy-badge" title={`Source: ${stock.delivery_source || "yfinance proxy"}. This is total traded value (volume × close), NOT delivery volume — NSE bhavcopy was unreachable so yfinance served as a proxy.`}>
                        proxy
                      </span>
                    )}
                  </span>
                  <b>{fmtCr(stock.delivery_value_inr)}</b>
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
            </div>
            <div>
              <h4>ATR plan</h4>
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
                  <span>Target 1 (R:R)</span>
                  <b>
                    {fmtINR(stock.target_1)} (
                    {stock.risk_reward_target_1?.toFixed(2) ?? "—"})
                  </b>
                </li>
                <li>
                  <span>Target 2 (R:R)</span>
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

          <section className="drawer-section">
            <h4>Soft score breakdown</h4>
            <SubscoreBars subScores={stock.sub_scores} />
          </section>
        </div>
      </aside>
    </div>
  );
}
