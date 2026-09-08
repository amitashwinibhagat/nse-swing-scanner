import ScoreRing from "./ScoreRing.jsx";
import { entryAction } from "../utils/scanPlan.js";
import { pickReasons, upsideToT1 } from "../utils/picks.js";
import { planRiskReward, computePositionSize, readSizing } from "../utils/sizing.js";

const fmtINR = (v) =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function StarButton({ on, onToggle, symbol }) {
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

/**
 * The one card that matters: a gate-passed name in the 63+ band, and the four
 * answers a customer needs to act tonight — what to do now, where to buy,
 * where to exit, and how much to risk. Reasons and the tracker evidence sit
 * alongside so the decision is informed, not just instructed.
 */
export default function TopPickCard({ stock, onOpen, watchlist, journal, scanDate }) {
  const action = entryAction(stock);
  const reasons = pickReasons(stock);
  const upside = upsideToT1(stock);
  const rr = planRiskReward(stock);
  const sizing = readSizing();
  const size = computePositionSize(stock, sizing);
  const watched = watchlist?.has?.(stock.symbol) ?? false;
  const taken = journal?.has?.(stock.symbol) ?? false;
  const hasPlan =
    stock.entry_zone_low != null &&
    stock.entry_zone_high != null &&
    stock.stop_loss != null;

  return (
    <article
      className="pick-card"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${stock.symbol} top pick, score ${Math.round(stock.swing_score)}. ${action ? action.label : "Open plan"}.`}
    >
      <header className="pick-head">
        <div className="pick-id">
          <div className="pick-symbol-row">
            <h3 className="pick-symbol">{stock.symbol}</h3>
            {watchlist && (
              <StarButton on={watched} onToggle={watchlist.toggle} symbol={stock.symbol} />
            )}
          </div>
          <p className="pick-company">
            {stock.company_name}
            {stock.industry ? ` · ${stock.industry}` : ""}
          </p>
        </div>
        <div className="pick-score">
          <ScoreRing score={stock.swing_score} size={52} strokeWidth={4} />
          <span className="pick-score-label">score</span>
        </div>
      </header>

      {action && (
        <div className={`pick-action pick-action--${action.tone}`}>
          <span className="pick-action-label">{action.label}</span>
          <span className="pick-action-detail">{action.detail}</span>
        </div>
      )}

      {hasPlan && (
        <dl className="pick-plan">
          <div>
            <dt>Buy zone</dt>
            <dd>
              {fmtINR(stock.entry_zone_low)} – {fmtINR(stock.entry_zone_high)}
            </dd>
          </div>
          <div>
            <dt>Stop</dt>
            <dd>{fmtINR(stock.stop_loss)}</dd>
          </div>
          <div>
            <dt title="First target. The scan sets it mechanically at 1.5x the risk — it is not a forecast.">
              Target
            </dt>
            <dd>
              {fmtINR(stock.target_1)}
              {upside != null && (
                <span className="pick-upside">
                  {upside > 0 ? "+" : ""}
                  {upside.toFixed(1)}%
                </span>
              )}
            </dd>
          </div>
        </dl>
      )}

      {rr && (
        <div className="pick-risk">
          <span
            className="pick-risk-item"
            title="Per-share risk if you fill at the top of the buy zone (the conservative case, and what the position sizer assumes)."
          >
            Risk {fmtINR(rr.riskPerShare)} ({rr.riskPct.toFixed(1)}%)
          </span>
          <span
            className="pick-risk-item"
            title="Per-share gain to the first target, measured from the top of the buy zone."
          >
            Reward {fmtINR(rr.rewardPerShare)} (
            {rr.rewardPct > 0 ? "+" : ""}
            {rr.rewardPct.toFixed(1)}%)
          </span>
          {size && (
            <span
              className="pick-risk-item pick-risk-size"
              title={`Sized on your saved capital of ${fmtINR(sizing.capital)} at ${sizing.riskPct}% risk per trade (about ${fmtINR(size.riskAmount)} at risk). Change it in the full plan.`}
            >
              {size.budgetTooSmall
                ? "Budget < 1 share"
                : `≈ ${size.shares.toLocaleString("en-IN")} sh`}
            </span>
          )}
        </div>
      )}

      <div className="pick-meta">
        <span className="pick-price">Last {fmtINR(stock.current_price)}</span>
      </div>

      {reasons.length > 0 && (
        <ul className="pick-reasons">
          {reasons.slice(0, 4).map((r) => (
            <li key={r.key} className={`pick-reason pick-reason--${r.tone}`}>
              {r.label}
            </li>
          ))}
        </ul>
      )}

      <footer className="pick-footer">
        <span className="pick-open">Open full plan →</span>
        {journal &&
          (taken ? (
            <span
              className="pick-taken"
              title="This trade is in your private log above. Open it to edit or remove."
            >
              In my trades
            </span>
          ) : (
            <button
              type="button"
              className="pick-take"
              onClick={(e) => {
                e.stopPropagation();
                journal.add({
                  symbol: stock.symbol,
                  entry: stock.current_price,
                  shares: size?.shares ?? 0,
                  stop: stock.stop_loss,
                  target: stock.target_1,
                  takenAt: new Date().toISOString(),
                  scanDate: scanDate || null,
                });
              }}
              onKeyDown={(e) => e.stopPropagation()}
              title="Log this trade in your private journal. Nothing is uploaded."
            >
              I took this
            </button>
          ))}
      </footer>
    </article>
  );
}
