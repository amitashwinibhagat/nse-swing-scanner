import { tradeStatus, summarizeTrades } from "../utils/trades.js";

const fmtINR = (v) =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtINR0 = (v) =>
  v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`;
const fmtSignedINR0 = (v) =>
  v == null ? "—" : `${v >= 0 ? "+" : "-"}${fmtINR0(Math.abs(v))}`;

/**
 * The customer's own log. Local-only; compares each fill to the latest scan
 * close. Descriptive status, never a recommendation to exit.
 */
export default function MyTrades({ trades, priceBySymbol, onRemove, onUpdate }) {
  if (!trades || trades.length === 0) return null;
  const summary = summarizeTrades(trades, priceBySymbol);

  return (
    <section className="my-trades" aria-labelledby="my-trades-heading">
      <div className="my-trades-head">
        <h2 id="my-trades-heading">
          My trades <span className="my-trades-count">{trades.length}</span>
        </h2>
        {summary.pnlAbs != null && (
          <span
            className={`my-trades-total ${summary.pnlAbs >= 0 ? "positive" : "negative"}`}
            title={`Across ${summary.priced} priced trade${summary.priced === 1 ? "" : "s"}${summary.unpriced ? `; ${summary.unpriced} without a fresh price` : ""}.`}
          >
            {fmtSignedINR0(summary.pnlAbs)}{" "}
            <span className="my-trades-total-pct">
              ({summary.pnlPct >= 0 ? "+" : ""}
              {summary.pnlPct.toFixed(1)}%)
            </span>
          </span>
        )}
      </div>

      <ul className="my-trades-list">
        {trades.map((t) => {
          const price = priceBySymbol?.[t.symbol];
          const st = tradeStatus(t, price);
          return (
            <li key={t.symbol} className="my-trade-row">
              <div className="my-trade-id">
                <b>{t.symbol}</b>
                <span className={`my-trade-badge my-trade-badge--${st.tone}`}>
                  {st.label}
                </span>
              </div>

              <label className="my-trade-field">
                <span>Entry ₹</span>
                <input
                  type="number"
                  step="0.05"
                  defaultValue={t.entry}
                  onBlur={(e) => {
                    const v = +e.target.value;
                    if (Number.isFinite(v) && v > 0) onUpdate(t.symbol, { entry: v });
                    else e.target.value = t.entry;
                  }}
                />
              </label>

              <label className="my-trade-field">
                <span>Shares</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={t.shares}
                  onBlur={(e) => {
                    const v = +e.target.value;
                    if (Number.isFinite(v) && v >= 0) {
                      onUpdate(t.symbol, { shares: Math.floor(v) });
                    } else {
                      e.target.value = t.shares;
                    }
                  }}
                />
              </label>

              <div className="my-trade-now">
                <span className="my-trade-now-label">Now</span>
                <span>{price != null ? fmtINR(price) : "—"}</span>
              </div>

              <div
                className={`my-trade-pnl ${
                  st.pnlPct == null ? "" : st.pnlPct >= 0 ? "positive" : "negative"
                }`}
              >
                <span>
                  {st.pnlPct == null
                    ? "—"
                    : `${st.pnlPct >= 0 ? "+" : ""}${st.pnlPct.toFixed(1)}%`}
                </span>
                {st.pnlAbs != null && (
                  <span className="my-trade-pnl-abs">{fmtSignedINR0(st.pnlAbs)}</span>
                )}
                {st.rMultiple != null && (
                  <span className="my-trade-r" title="Profit/loss in multiples of the risk you took.">
                    {st.rMultiple >= 0 ? "+" : ""}
                    {st.rMultiple.toFixed(1)}R
                  </span>
                )}
              </div>

              <button
                type="button"
                className="my-trade-remove"
                onClick={() => onRemove(t.symbol)}
                aria-label={`Remove ${t.symbol} from my trades`}
                title="Remove from my trades"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <p className="my-trades-note">
        Your private log — stored only in this browser, never uploaded. Status is
        measured against the latest scan close; it is not advice and not a
        signal to exit.
      </p>
    </section>
  );
}
