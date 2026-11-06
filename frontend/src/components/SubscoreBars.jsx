import { Fragment } from "react";
import { scoredOnCount, SCORE_KEY_TOTAL } from "../utils/scanPlan.js";

const LABELS = {
  valuation_compression: "Valuation vs 5Y",
  oversold_positioning: "RSI positioning",
  drawdown_sweetspot: "Drawdown zone",
  volume_capitulation: "Volume capitulation",
  quality_composite: "Quality (F-Score etc)",
  conviction_holding: "Holdings conviction",
};

// Must list every key in WEIGHTS (backend/settings.py). It used to omit
// conviction_holding, so a weighted 10% of the composite was never rendered
// while "Scored on N/7" counted it — the drawer showed six bars and claimed
// settings.WEIGHTS.
const ORDER = [
  "valuation_compression",
  "oversold_positioning",
  "drawdown_sweetspot",
  "volume_capitulation",
  "quality_composite",
  "conviction_holding",
];

export default function SubscoreBars({ subScores, marketCorrectionFactor }) {
  if (!subScores) {
    return <p className="na">No sub-score breakdown available for this stock.</p>;
  }
  const n = scoredOnCount(subScores);
  const showAdj =
    typeof marketCorrectionFactor === "number" &&
    Number.isFinite(marketCorrectionFactor) &&
    Math.abs(marketCorrectionFactor - 1) > 0.001;
  const showShort = n < SCORE_KEY_TOTAL;

  return (
    <div className="subscore-wrap">
      {(showShort || showAdj) && (
        <div className="subscore-meta">
          {showShort && (
            <span
              className="subscore-meta-item"
              title={`Score was computed over ${n} of ${SCORE_KEY_TOTAL} weighted components; missing components renormalise the weight, so this score is not directly comparable to one computed on all components.`}
            >
              Scored on {n}/{SCORE_KEY_TOTAL} components
            </span>
          )}
          {showAdj && (
            <span
              className={`subscore-meta-item rs-adjust rs-${marketCorrectionFactor >= 1 ? "up" : "down"}`}
              title={`Relative-strength adjustment vs Nifty 50 / 200EMA (client-side mirror of scanner.relative_strength_factor).`}
            >
              Market adjustment ×{marketCorrectionFactor.toFixed(2)}
            </span>
          )}
        </div>
      )}
      <div className="subscore-grid">
        {ORDER.map((key) => {
          const v = subScores[key];
          const pct = v == null ? 0 : Math.round(v * 100);
          return (
            <Fragment key={key}>
              <div className="subscore-label">{LABELS[key]}</div>
              <div className="subscore-track">
                <div className="subscore-fill" style={{ transform: `scaleX(${pct / 100})` }} />
              </div>
              <div className="subscore-value">{v == null ? "n/a" : pct}</div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}