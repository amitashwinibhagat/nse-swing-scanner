# NSE Swing Scanner

A hosted dashboard for the NSE/BSE swing-trade screener. GitHub Actions runs
the scan twice daily and commits the results; Netlify serves a static React
frontend that reads them. No servers to run, no secrets to manage, $0 hosting
cost.

> **Not investment advice. Not SEBI-registered research.** Always
> cross-check any candidate stock against authoritative sources
> (Screener.in, NSE filings, a SEBI-registered advisor) before acting.

## Why this architecture (read before changing it)

Netlify Functions **cannot run the actual scan.** Verified against Netlify's
current docs: synchronous functions cap at 60 seconds, scheduled functions
at 30 seconds, and even background functions top out at 15 minutes with no
persistent process support. A full Nifty 500 scan takes ~15-25 minutes
single-threaded due to yfinance rate-limit courtesy sleeps — at or past
even the most permissive Netlify function type.

So the system is split:

- **Compute** (the scan itself) runs on **GitHub Actions**, a normal
  long-lived CI job with no serverless timeout, free tier of 2,000
  min/month (unlimited on public repos).
- **Serving** (the frontend) runs on **Netlify**, which is genuinely good
  at this: static hosting, auto-deploy on git push, CDN, zero config.

The two are connected by the simplest possible contract: GitHub Actions
writes `frontend/public/data/latest_scan.json` and commits it. Netlify
rebuilds on that push. The React app just fetches the JSON file — no API
layer, no database, no auth.

```
.github/workflows/scan.yml  → cron, runs backend/scanner.py, commits JSON
backend/                    → the Python scan pipeline
frontend/public/data/       → latest_scan.json (committed output)
frontend/src/               → React dashboard (Vite)
netlify.toml                → base=frontend, publish=frontend/dist
```

## What's in the scanner

All hard gates are implemented and fail-closed (if a source is unreachable,
the row is marked as failed for that gate, not silently passed):

| Gate | Criterion | Source |
|---|---|---|
| F-Score | Piotroski F-Score ≥ 6 (configurable; spec is >7) | yfinance financials |
| Drawdown | -40% ≤ pct off 52W high ≤ -15% | yfinance |
| RSI | 25 ≤ RSI(14) ≤ 40 | yfinance |
| Delivery value | latest-day delivery value ≥ ₹5cr | NSE bhavcopy |
| T-group / suspension | not in T-group / GSM / suspension | NSE → BSE → flag-only |
| Holdings conviction | promoter + FII + DII > 50% | Screener.in |
| Pending corporate actions | no excluded action in next 30 days | NSE corporate actions |

Plus a soft 0–100 score with seven sub-scores (valuation, RSI, EMA, drawdown,
volume, F-Score, holdings) and a relative-strength-vs-Nifty-50 multiplier.
ATR(14)-based entry zone / stop / targets are shown in the detail panel.

See `docs/methodology.md` for the full formula, weights, and source-status
policy.

## Setup

### 1. Push this to a GitHub repo

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

No secrets/tokens needed for the scan Action — it uses the automatically
provided `GITHUB_TOKEN` to commit back to the repo (wired into
`.github/workflows/scan.yml` via `permissions: contents: write`).

### 2. Verify the scan Action runs

Go to the Actions tab → "NSE Swing Scan" → **Run workflow** (manual
trigger). First run takes ~20-35 min for the full universe (Screener
holdings scraping is the dominant cost; warm caches help). Check that
`frontend/public/data/latest_scan.json` gets committed afterward.

### 3. Verify CI passes

The `CI` workflow runs backend pytest + a 5-stock smoke scan + frontend
build on every push and PR. Both must be green before merging.

### 4. Connect the repo to Netlify

- New site from Git → pick this repo.
- Netlify should auto-detect `netlify.toml` (base directory `frontend`,
  build command `npm run build`, publish directory `frontend/dist`).
- Deploy. No environment variables are required for v1.

### 5. Confirm the schedule

Cron in `scan.yml` is **09:00 and 16:00 IST on weekdays** (UTC `30 3 * * 1-5`
and `30 10 * * 1-5`). GitHub Actions cron can drift by a few minutes under
load — treat these as "approximately," not to-the-second.

## Local development

```bash
# Backend - generate a sample scan for local frontend dev
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scanner.py --sample 20 --output ../frontend/public/data/latest_scan.json

# Backend tests
.venv/bin/pytest -q

# Frontend
cd ../frontend
npm install
npm run dev   # http://localhost:5173
```

## Limitations (read this)

- **Free data sources are fragile.** NSE, BSE, and Screener.in do not
  publish stable public APIs. If any source changes its URL structure,
  the scanner reports `source_failed` or `flag_only` rather than crashing
  — and the corresponding hard gate fails-closed. The dashboard shows the
  source status per row, and the GitHub Action will surface persistent
  failures.
- **ADR-listed names (INFY, WIPRO, IBN, HDB, RDY, etc.)** have a known
  yfinance bug where diluted EPS is returned in USD while the price is in
  INR, producing corrupted P/E ratios. `fscore.py` cross-checks against
  `t.info['trailingPE']` and refuses to return a value when they diverge
  by more than 3x. Affected names show a blank P/E in the table — that's
  the system working, not a bug.
- **Earnings surprise (last 2Q)** is **not a hard gate.** It is deferred to
  Phase 2. There is no clean free source for Indian-stock consensus
  estimates, and the scanner will not pretend to have screened on data
  it doesn't have. See `CHANGELOG.md` and `docs/methodology.md`.
- **Soft-score weights and the F-Score threshold are hand-tuned**, not
  backtested. Treat the score as a degree-of-match ranking, not a strategy
  signal. A backtesting harness against historical NSE data is needed
  before treating this as an edge.
- **This is not a real-time or intraday system.** The scan runs twice
  daily. The data is stale within hours of a market session.

## Known operational risks

- **yfinance/NSE/Screener rate-limiting mid-scan**: the Action step fails
  and the workflow stops *before* the commit step — the frontend keeps
  serving the last good scan rather than a partial one. The dashboard
  shows a "Stale (>18h)" banner when this happens.
- **NSE archive URL changes**: `universe.py` has a fallback URL
  (niftyindices.com). If NSE restructures both, the workflow will fail
  loudly. Watch for Action failures.
- **Corporate actions / delistings mid-universe**: demonstrated live
  (Tata Motors' Oct 2025 demerger broke the old ticker). The scanner
  skips failed tickers gracefully rather than crashing the whole run.

## License

MIT. See `LICENSE`.
