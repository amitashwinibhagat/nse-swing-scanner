const RATIONALE = [
  "Twice a day, the GitHub Actions scan runs the universe through seven hard gates and a 0–100 soft score, then commits the result as frontend/public/data/latest_scan.json. This dashboard renders that JSON — it never calls a live API, never touches your data, and never blocks on a backend.",
  "Three free data sources feed the scan: yfinance for price/action, NSE bhavcopy for delivery, Screener.in for promoter/FII/DII holdings. NSE corporate filings supply the pending-actions screen. All four are best-effort public sources — when any of them changes its URL or rate-limits, the affected gate fails closed and the source-status pill surfaces it row by row.",
  "The CSV export captures every field the scanner emits, including sub-scores, ATR(14), entry zone, both R-multiples, holdings breakdown, source status, and the gate-fail reason. Useful for re-scoring in a notebook without re-running the scan.",
];

const TERMS = [
  {
    term: "GATE",
    body:
      "PASS / FAIL on the seven hard gates (F-Score ≥ 6, drawdown in [-40%, -15%], 25 ≤ RSI ≤ 40, liquidity adequacy ≥ ₹10 cr ADV OR actual delivery ≥ ₹5 cr, no T-group / suspension / GSM flag, holdings conviction > 50%, no pending corporate action in the next 30 days). Hard gates fail closed — if a source is unreachable, that gate fails rather than silently passing. The detail drawer reveals which gate blocked a FAIL.",
  },
  {
    term: "SCORE",
    body:
      "0–100 soft ranking: weighted blend of valuation compression (current P/E vs 5Y mean), RSI positioning, 200-EMA proximity, drawdown sweet-spot, volume capitulation, F-Score, and holdings conviction — multiplied by the Nifty 50's distance from its 200-EMA as a regime filter. Weights are hand-tuned, not backtested; treat the score as a degree-of-match ranking, not an edge.",
  },
  {
    term: "PRICE",
    body:
      "Last complete trading-session close from yfinance, in INR. The scanner drops the most recent row if it has all-NaN OHLCV (an incomplete feed) so you never see a half-printed session.",
  },
  {
    term: "% OFF 52W",
    body:
      "Distance from the 52-week high: (price / 52w_high − 1) × 100. The gate window is −40% to −15% — far enough below the high that the swing has had time to consolidate, not so far that the thesis is broken.",
  },
  {
    term: "RSI-14",
    body:
      "14-period Relative Strength Index from yfinance. The textbook oversold level is 30; the gate window 25–40 admits setups that often sit slightly above textbook oversold.",
  },
  {
    term: "T1",
    body:
      "First profit target at +1.5R above the entry zone, derived from ATR(14). T2 is at +2.5R. If the stock doesn't reach T1, the trade is a scratch; if it does, a trailing stop is not signalled — that's deliberate for v1.",
  },
  {
    term: "STOP",
    body:
      "Initial stop at 1× ATR(14) below the entry zone. Use a hard GTT order; do not manually trail. The scan's R-multiples assume mechanical execution.",
  },
  {
    term: "ADV (₹cr)",
    body:
      "20-session average traded value (volume × close) from yfinance, in ₹ crores. This is the primary metric for the liquidity hard gate: a row PASSes the gate if ADV ≥ ₹10 cr. It is a more reliable proxy for exitability than a single-day traded-value number and is not affected by NSE's Akamai blocks.",
  },
  {
    term: "DEL. VAL (₹cr)",
    body:
      "Latest available day's delivery value in ₹ crores from NSE / BSE bhavcopy when reachable. When real delivery is available and ≥ ₹5 cr, that path satisfies the liquidity hard gate. The single-day yfinance traded-value proxy is shown here for transparency but is NOT used by the gate on its own — it is too noisy and previously inflated the PASS list.",
  },
  {
    term: "HOLD %",
    body:
      "Combined promoter + FII + DII shareholding as a percentage, from Screener.in (consolidated). The 50% threshold aims to filter out stocks with genuinely thin institutional conviction rather than coincidental overlap.",
  },
  {
    term: "F-SCORE",
    body:
      "Joseph Piotroski's 9-point financial-strength score across profitability, leverage / liquidity, and operating efficiency. Gate threshold is 6 — the original 2000 paper uses 8–9 for strict value screens; 6 widens the swing-trade universe.",
  },
  {
    term: "P/E (T / 5Y)",
    body:
      "Trailing P/E (current) compared to the 5-year average P/E. ADR / GDR-listed names (INFY, WIPRO, IBN, HDB, RDY) have a known yfinance bug where diluted EPS is returned in USD while price is in INR; fscore.py explicitly refuses to return a value when the two diverge by more than 3×. Those rows show a blank — that's the system working, not a missing data feed.",
  },
];

export default function Rationale() {
  return (
    <section className="rationale" aria-labelledby="rationale-heading">
      <div className="rationale-col">
        <h3 id="rationale-heading">How this dashboard works</h3>
        {RATIONALE.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <p className="rationale-meta">
          Full methodology, source-policy details, and known limitations live
          in <code>docs/methodology.md</code> and the Limitations section of
          the README.
        </p>
      </div>
      <div className="rationale-col">
        <h3>Field guide</h3>
        <dl className="terms">
          {TERMS.map((t) => (
            <div className="term" key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
