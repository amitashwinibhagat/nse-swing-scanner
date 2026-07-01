import { Fragment } from "react";

const LABELS = {
  valuation_compression: "Valuation vs 5Y",
  oversold_positioning: "RSI positioning",
  support_proximity: "200-EMA proximity",
  drawdown_sweetspot: "Drawdown zone",
  volume_capitulation: "Volume capitulation",
  quality_composite: "Quality (F-Score etc)",
};

const ORDER = [
  "valuation_compression",
  "oversold_positioning",
  "support_proximity",
  "drawdown_sweetspot",
  "volume_capitulation",
  "quality_composite",
];

export default function SubscoreBars({ subScores }) {
  if (!subScores) {
    return <p className="na">No sub-score breakdown available for this stock.</p>;
  }
  return (
    <div className="subscore-grid">
      {ORDER.map((key) => {
        const v = subScores[key];
        const pct = v == null ? 0 : Math.round(v * 100);
        return (
          <Fragment key={key}>
            <div className="subscore-label">{LABELS[key]}</div>
            <div className="subscore-track">
              <div className="subscore-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="subscore-value">{v == null ? "n/a" : pct}</div>
          </Fragment>
        );
      })}
    </div>
  );
}
