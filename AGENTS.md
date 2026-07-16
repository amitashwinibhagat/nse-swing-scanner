# AGENTS.md — NSE Swing Scanner

> Operational reference for any agent (Kilo, Cursor, human) working on this
> codebase. README.md is user-facing; this file is the technical contract.
> Last updated: 2026-07-03.

## Project Overview

Hosted dashboard for an NSE/BSE swing-trade screener. Twice daily, a GitHub
Actions workflow runs a Python scanner that evaluates Nifty 500 stocks
against 7 hard gates and a soft ranking score, then commits the result to
the repo. Netlify serves a static React frontend that reads the committed
JSON. Zero always-on servers, zero hosting cost (free tiers).

```
GitHub Actions cron ──► scanner.py ──► frontend/public/data/*.json
                                                  │
                                                  ▼
                                  Netlify (static React frontend)
                                                  │
                                                  ▼
                                              end users
```

**Live:** https://nse-swing-scanner.netlify.app
**Repo:** https://github.com/amitashwinibhagat/nse-swing-scanner

## Architecture & Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│ GitHub Actions  (ubuntu-latest, Python 3.11)                            │
│                                                                          │
│  scan.yml (cron 03:30 + 10:30 UTC, Mon–Fri)                              │
│    │                                                                     │
│    ├── fetch_universe(NIFTY500)             # backend/universe.py       │
│    ├── fetch_surveillance_list()            # backend/surveillance.py    │
│    ├── fetch_bhavcopy()                     # backend/bhavcopy.py        │
│    │      └── NSE → yfinance proxy → BSE   (multi-provider chain)      │
│    ├── compute_nifty50_context()            # backend/technicals.py      │
│    │                                                                     │
│    └── ThreadPoolExecutor(workers=12) → per-stock evaluation:           │
│           ├── fetch_holdings()              # backend/holdings.py       │
│           ├── fetch_corporate_actions()     # backend/corporate_actions │
│           ├── compute_technicals()          # backend/technicals.py      │
│           ├── compute_fscore()              # backend/fscore.py           │
│           ├── approx_5y_avg_pe()            # backend/fscore.py           │
│           └── 7 hard gates + soft score                                   │
│                                                                          │
│    ├── Validate JSON contract                                              │
│    ├── Write scan_status.json               (drift calc, best-effort)      │
│    ├── Commit + push latest_scan.json + scan_status.json                 │
│    └── Trigger Netlify deploy (NETLIFY_AUTH_TOKEN / NETLIFY_SITE_ID)      │
│                                                                          │
│  watchdog.yml (cron */15 1-11 UTC, Mon–Fri)                              │
│    ├── Check latest_scan.json age on main                                │
│    ├── If stale >45 min → gh workflow run scan.yml                        │
│    └── Ping healthchecks.io watchdog URL                                  │
└──────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Netlify  (static SPA + 1 serverless function)                            │
│                                                                          │
│  Frontend (React 18 + Vite 5):                                           │
│    - App.jsx (KPI dashboard, table, drawer)                              │
│    - Components: Kpi, StockCard, ScoreRing, Rationale, DetailDrawer, ... │
│    - Reads /data/latest_scan.json + /data/scan_status.json              │
│                                                                          │
│  Functions:                                                             │
│    - /netlify/functions/trigger-scan.js  (POST, owner-only manual scan)  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Scanner | Python 3.11 | yfinance / pandas / numpy ecosystem |
| HTTP | `requests` + custom session | Simple, no extra deps |
| Frontend | React 18 + Vite 5 | Smallest bundle, no SSR needed for static data |
| Hosting | Netlify free tier | $0, auto-deploys on GH push |
| CI/CD | GitHub Actions | Free for public repos, used for both scan + watchdog |
| Monitoring | healthchecks.io free tier | Cron-drift alerting |
| Secrets | GH repo secrets + Netlify env vars | Standard |

## File Layout

```
.
├── .github/workflows/
│   ├── ci.yml             # push/PR: cron guard + pytest + frontend build
│   ├── scan.yml           # 2x daily: full scan + commit + Netlify deploy
│   └── watchdog.yml       # 15min: freshness check + auto-trigger + ping
├── backend/
│   ├── scanner.py         # Entry point: run_scan() orchestrates everything
│   ├── universe.py        # Nifty 100/200/500 fetchers (CSV via NSE archives)
│   ├── holdings.py        # Screener.in shareholding scraper + cache
│   ├── corporate_actions.py # NSE corporate-actions endpoint + cache
│   ├── surveillance.py    # NSE/BSE T-group/suspension/GSM fetcher
│   ├── bhavcopy.py        # Multi-provider delivery data (NSE/yfinance/BSE)
│   ├── technicals.py      # RSI, ATR, EMAs, 200EMA proximity
│   ├── fscore.py          # Piotroski F-Score + 5Y avg P/E (yfinance)
│   ├── source_status.py   # Standardised {status, source, data} envelope
│   ├── settings.py        # All tunable thresholds + TTLs
│   ├── cache.py           # JSON-file cache + cached_call() wrapper
│   ├── nse_client.py      # Akamai-bypass session helpers
│   ├── requirements.txt   # yfinance, pandas, numpy, requests, bs4, lxml
│   ├── scripts/
│   │   └── check_cron_consistency.py  # CI guard (runs in ci.yml)
│   ├── cache/             # On-disk JSON cache (gitignored, restored via actions/cache@v6)
│   └── tests/             # 87 tests, all run in <1s
├── frontend/
│   ├── public/data/
│   │   ├── latest_scan.json    # Committed by scan.yml after each run
│   │   ├── scan_status.json    # Committed by scan.yml (drift calc)
│   │   └── .gitkeep
│   ├── src/
│   │   ├── App.jsx              # Top-level dashboard
│   │   ├── main.jsx             # React root
│   │   ├── styles.css           # Single CSS file, ~1370 lines
│   │   └── components/
│   │       ├── Kpi.jsx          # KPI tile with delta + accent
│   │       ├── StockCard.jsx    # Card view
│   │       ├── ScoreRing.jsx    # Soft score donut
│   │       ├── SubscoreBars.jsx # Sub-score breakdown
│   │       ├── DonutHoldings.jsx
│   │       ├── Rationale.jsx    # Methodology explainer
│   │       ├── DetailDrawer.jsx # Per-stock detail panel
│   │       ├── SegmentedControl.jsx, Skeleton.jsx
│   ├── netlify/functions/
│   │   └── trigger-scan.js      # Owner-only POST trigger (?admin=1)
│   ├── package.json             # React 18.3, Vite 5.4
│   └── dist/                    # Build output (gitignored, deployed by Netlify)
├── plans/                        # Older planning docs (kept for context)
├── netlify.toml                  # Build config + cache-control headers
├── README.md                     # User-facing docs
├── CHANGELOG.md                  # Versioned release notes (latest: 1.1.6)
└── AGENTS.md                     # ← you are here
```

## Local Development

```bash
# Backend (Python 3.11+ required, 3.14 tested)
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q                                            # 87 tests, ~0.3s
python scanner.py --top-n 500 --workers 8 --sleep 0.3 \
    --lenient-external-gates \
    --output ../frontend/public/data/latest_scan.json

# Frontend
cd frontend
npm install
npm run dev               # vite dev server on :5173
npm run build             # production build to dist/
```

**Hot-reloading during development:** the frontend reads `/data/latest_scan.json` from the public dir, so refreshing the dev server picks up backend changes. `cache: "no-store"` on the fetch bypasses HTTP cache.

## Commands

### Validation (run before every commit)

```bash
cd backend
.venv/bin/python scripts/check_cron_consistency.py   # CI guard
.venv/bin/python -m pytest -q                        # 87 tests
cd ../frontend && npm run build                      # typecheck + bundle
```

### Trigger a fresh scan

```bash
# Manual via gh CLI (always works)
gh workflow run scan.yml --repo amitashwinibhagat/nse-swing-scanner

# Or via the owner-only Netlify function
curl -X POST -H "Authorization: Bearer $SCAN_TRIGGER_SECRET" \
    https://nse-swing-scanner.netlify.app/.netlify/functions/trigger-scan

# Or via the watchdog (manual trigger to test wiring)
gh workflow run watchdog.yml --repo amitashwinibhagat/nse-swing-scanner
```

### Deploy manually (Netlify CLI)

```bash
netlify deploy --prod --dir=frontend/dist \
    --message="manual deploy: <reason>"
```

This bypasses the GitHub-Integration auto-deploy and uploads directly. Used when:
- Workflow's `Trigger Netlify production deploy` step skipped (missing secrets).
- You want to deploy without committing.

### Watch workflow logs

```bash
RUN_ID=$(gh run list --repo amitashwinibhagat/nse-swing-scanner \
    --workflow=scan.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RUN_ID --repo amitashwinibhagat/nse-swing-scanner --exit-status
```

## Configuration & Secrets

### GitHub repo secrets (Settings → Secrets and variables → Actions)

| Secret | Used by | Purpose |
|---|---|---|
| `HEALTHCHECK_PING_URL_MORNING` | scan.yml | `https://hc-ping.com/d31b1ec5-…085f` (09:00 IST cron) |
| `HEALTHCHECK_PING_URL_EVENING` | scan.yml | `https://hc-ping.com/1e6082f1-…77db` (16:00 IST cron) |
| `HEALTHCHECK_PING_URL_CANCELLED` | scan.yml | `/fail` ping when a scheduled run is cancelled (GH Actions runner-provisioning failure). Period 1h, grace 30 min recommended. |
| `HEALTHCHECK_WATCHDOG_URL` | watchdog.yml | Watchdog heartbeat (period 1h, grace 1h) |
| `NETLIFY_AUTH_TOKEN` | scan.yml | Netlify deploy trigger (optional; auto-deploy via GH integration is preferred) |
| `NETLIFY_SITE_ID` | scan.yml | Netlify site ID for the above |

### Netlify env vars (Site settings → Environment variables)

| Variable | Used by | Purpose |
|---|---|---|
| `SCAN_TRIGGER_SECRET` | trigger-scan.js | Owner-only auth token for `?admin=1` POST endpoint |
| `GITHUB_DISPATCH_TOKEN` | trigger-scan.js | PAT with `repo` scope to call `repos/{owner}/{repo}/dispatches` |

**Note:** The `trigger-scan.js` function is the documented owner-only manual
trigger (`?admin=1` in the README). The Netlify-deploy step in scan.yml is
a fallback; the GitHub-Integration auto-deploy handles most updates.

## Hard Gates & Thresholds (settings.py)

| Constant | Value | Meaning |
|---|---|---|
| `UNIVERSE_DEFAULT_TOP_N` | 500 | Nifty 500 universe |
| `MIN_MARKET_CAP_CR` | 500 | ₹500 cr market cap floor |
| `MAX_DE_RATIO` | 1.0 | Debt/Equity ceiling |
| `MIN_F_SCORE` | 6 | Piotroski F-Score ≥ 6 (relaxed from spec's ≥ 7) |
| `MIN_DELIVERY_VALUE_INR` | 5_00_00_000 | ₹5 cr/day delivery floor (only used when `delivery_kind == "actual"`) |
| `MIN_ADV_VALUE_INR` | 10_00_00_000 | 20d average traded value floor (liquidity adequacy fallback path) |
| `MIN_ADV_SECONDARY_FLOOR_INR` | 3_00_00_000 | ADV floor when real delivery path passes (anti-thin-stock guard) |
| `ADV_HARD_CEILING_INR` | 5_000_00_00_000 | Per-symbol ADV clamp (yfinance outlier protection) |
| `ADV_LOOKBACK_SESSIONS` | 20 | Sessions in the ADV window |
| `ADV_MIN_SESSIONS` | 15 | Min valid sessions to compute ADV |
| `MIN_HOLDINGS_CONVICTION_PCT` | 50 | Promoter+FII+DII ≥ 50% |
| `DRAWDOWN_LOWER_PCT` | -40.0 | Drawdown gate lower bound |
| `DRAWDOWN_UPPER_PCT` | -15.0 | Drawdown gate upper bound |
| `RSI_LOWER` / `RSI_UPPER` | 25 / 40 | RSI-14 must be in [25, 40] |
| `CORPORATE_ACTION_LOOKAHEAD_DAYS` | 30 | Forward-looking CA window |

### Cache TTLs

| Constant | Value | Notes |
|---|---|---|
| `HOLDINGS_CACHE_TTL_SECONDS` | 90 days | Screener (quarterly cadence) |
| `BHAVCOPY_CACHE_TTL_SECONDS` | 12 hours | Half a day |
| `SURVEILLANCE_CACHE_TTL_SECONDS` | 7 days | Weekly |
| `CORPORATE_ACTIONS_CACHE_TTL_SECONDS` | 12 hours | Half a day |
| `YF_CACHE_TTL_SECONDS` | 12 hours | Price-derived (current_price, RSI, etc.) |
| `YF_FUNDAMENTAL_CACHE_TTL_SECONDS` | 24 hours | Balance-sheet (F-Score) |

**Known limitation:** 12 h TTL on price fields is unsafe across stock splits
/demergers. Cached scalars reflect the pre-event snapshot for up to 12 h.
Documented in CHANGELOG 1.1.6; revisit if NSE splits become more frequent.

## Data Sources & Fallback Chains

| Source | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Universe CSV | NSE archives (`nsearchives.nseindia.com`) | niftyindices.com | (fail-closed) |
| Shareholding | Screener.in | (no fallback — fail-closed) |
| Surveillance | NSE + BSE consolidated | (fail-closed) |
| Corporate actions | NSE `corporate-actions` API | (fail-closed) |
| Delivery value | NSE archives bhavcopy | **yfinance traded-value proxy** (volume × close) | BSE archives |
| yfinance (technicals, F-Score, P/E) | yfinance | (no fallback — fail-closed) |
| Nifty 50 context | yfinance `^NSEI` | (no fallback — fail-closed) |

### bhavcopy.py fallback chain (the one that mattered)

```
fetch_bhavcopy(universe_symbols, universe_yf_tickers)
  ├─ 1. _try_nse_archives()                  → ok | source_failed
  ├─ 2. _try_yfinance_traded_value()         → ok | source_failed
  └─ 3. _try_bse_archives()                  → ok | source_failed
  ↓
result.data[symbol] = {
    delivery_qty, delivery_value_inr, delivery_pct,
    delivery_kind: "actual" | "traded_value_proxy"
}
```

When NSE is blocked (the persistent state since mid-2026), the yfinance
proxy reports `volume × close` per stock — typically 2-3× real delivery
value. The frontend surfaces this via:

- Per-cell `proxy` chip with tooltip
- "Delivery (₹cr)" → "Traded val (₹cr)" label swap in the detail drawer
- `delivery_source` JSON field set to `"yfinance:traded_value_proxy"`

When NSE returns, `delivery_kind: "actual"` and the label reverts.

## Caching Strategy

### On-disk JSON cache (`backend/cache/`)

- Simple JSON-per-key: `{safe_key}.json` with mtime-based TTL
- Cache key sanitisation: `_safe_key()` strips non-alnum/`._-` chars
- `cached_call(key, ttl, fn, *args)` helper in `cache.py`:
  - Reads cache first (unless `NSE_SWING_NO_CACHE` env var set)
  - Calls `fn` on miss
  - Writes result to disk
  - Single bypass flag (one read site)
- GitHub `actions/cache@v6` with `key: nse-swing-cache-${{ github.run_id }}`
  and `restore-keys: nse-swing-cache-` restores the most recent prior
  cache on each run

### Important: cache file naming

The cache key for the yfinance proxy used to be `",".join(yf_tickers)`,
which produced a ~7000-char filename for the full Nifty 500 universe —
exceeding most filesystems' 255-byte filename limit. Fixed in 1.1.5 by
hashing the joined ticker list with SHA-256 (16-char prefix). If you add
a new cached call with a long key, hash it.

## CI/CD Workflows

### `scan.yml` (the main scan)

- Triggers: `schedule` (cron) + `workflow_dispatch`
- Crons: `30 3 * * 1-5` and `30 10 * * 1-5` (UTC)
- Concurrency: `group: nse-swing-scan, cancel-in-progress: false`
  (queue duplicate runs, don't cancel)
- Timeout: 30 minutes (cold-cache 5-7 min + retry headroom)
- Steps:
  1. Checkout + Python 3.11
  2. `actions/cache@v6` (backend/cache/)
  3. `pip install -r backend/requirements.txt`
  4. `Run full scan` (scanner.py with --top-n 500 --workers 12 --sleep 0.2)
  5. **3× healthchecks.io pings** (start, fail, success — gated by secrets)
  6. Validate JSON contract (asserts `generated_at` + `stocks` non-empty)
  7. Write `scan_status.json` (drift calc, best-effort, try/except-wrapped)
  8. Commit + push (gated by `if: success()`)
  9. Netlify deploy (gated by `if: success()`, env-gated by NETLIFY_AUTH_TOKEN)

### `watchdog.yml` (cron drift detector)

- Triggers: `schedule` (cron `*/15 1-13 * * 1-5` UTC, Mon-Fri) + `workflow_dispatch`
- Window covers 06:30–19:00 IST; the 1–13 hour range (extended from 1–11
  in 1.1.7) gives an automated recovery path for the evening slot when
  the 10:30 UTC cron gets cancelled during the GH Actions free-tier
  runner peak (11:30–13:30 UTC).
- Permissions: `contents: read, actions: write` (the latter for `gh workflow run`)
- Steps:
  1. Check freshness of `latest_scan.json` on `main`
  2. If age > 45 min, fire `gh workflow run scan.yml`
  3. Ping `HEALTHCHECK_WATCHDOG_URL` with `?stale=...&age_min=...` query

### `ci.yml` (push/PR gate)

- Runs on every push and PR to `main`
- Backend job: cron guard + pytest + 5-stock smoke scan
- Frontend job: npm ci + build
- Both jobs green = merge-eligible

## healthchecks.io + Watchdog Setup

This is critical because **GitHub Actions cron is best-effort** —
observed 3h+ late runs and missed slots in 2026-07.

### Two-check setup (current state)

| Check | Cron | Grace | UUID | URL pattern |
|---|---|---|---|---|
| Morning | `30 3 * * 1-5` (UTC) | 4 h | `d31b1ec5-…085f` | `https://hc-ping.com/d31b1ec5-04a3-4401-a7b6-2ac9d162085f` |
| Evening | `30 10 * * 1-5` (UTC) | 4 h | `1e6082f1-…77db` | `https://hc-ping.com/1e6082f1-d26d-46fe-96c8-b914f4aa77db` |

scan.yml picks the right URL via `case "${{ github.event.schedule }}" in …`.

### Three-check setup (recommended, third pending)

Add a third check for the watchdog:

| Check | Period | Grace | UUID | Notes |
|---|---|---|---|---|
| Watchdog | 1 h | 1 h | TBD | Set once user creates the third check |

URL goes into `HEALTHCHECK_WATCHDOG_URL` repo secret.

### How scan.yml pings

| Step | URL suffix | When |
|---|---|---|
| Scan started | `/start` | First step (after checkout) |
| Scan failed | `/fail` | Any step errored (`if: failure()`) |
| Scan cancelled | `/fail` (separate URL) | Job was cancelled (`if: cancelled()`, schedule only) |
| Scan succeeded | (none) | Job completed cleanly |

`continue-on-error: true` on all three so a curl failure can't fail the
workflow.

### Alert wiring

healthchecks.io → Integrations → add Email (on by default) +
Slack/Discord/PagerDuty as desired. Each check sends alerts
independently when the ping doesn't arrive within Period+Grace.

## Common Tasks

### Add a new hard gate

1. Add the threshold constant to `backend/settings.py`
2. Add a new gate function in `backend/scanner.py` near the existing
   `gate_f_score`, `gate_drawdown`, etc.
3. Wire it into the per-stock evaluation block
4. Add a test in `backend/tests/`
5. Update README "Hard gates" + Rationale.jsx if user-facing

### Add a new scheduled window

Single source of truth lives in two places, kept in sync by
`backend/scripts/check_cron_consistency.py`:

1. Add `- cron: "M H * * 1-5"` to `.github/workflows/scan.yml`
2. Update `WINDOWS = [(h1, m1), (h2, m2), ...]` in scan.yml's
   Write scan_status.json step
3. Update `EXPECTED_WINDOWS` in `backend/scripts/check_cron_consistency.py`
4. Add a new healthchecks.io check + secret if you want independent alerts

### Add a new data source

1. Implement the fetch in `backend/` (follow `source_status.py` envelope)
2. Cache via `cached_call()` (see `cache.py`)
3. Wire into `run_scan()` in `scanner.py`
4. Surface `source_status` and `source` per row in `to_json_records()`
5. Add a UI source-status pill in `App.jsx` / `DetailDrawer.jsx`
6. Add tests

### Add a new KPI / column

1. Add the field to `to_json_records()` in `scanner.py`
2. Add to the `cols` array near line 150 of `App.jsx` (this is the
   filter-export schema; not display columns)
3. Add a `<Kpi>` block or table cell in `App.jsx`
4. Add CSS if a new accent class is needed (existing: `accent`, `success`,
   `warning`, `danger`)

## Conventions & Style

- **JSON contract field names** are the public API between scanner and
  frontend. They live in `to_json_records()` in `scanner.py`. Change
  in both places at once or the dashboard silently shows blanks.
- **Source-status envelope**: every external fetch returns
  `make_status(source=..., status=..., as_of=..., data=..., error=...)`.
  `status` is from `SOURCE_STATUSES = {"ok", "missing", "source_failed",
  "fallback_used", "flag_only", "not_applicable"}`. See `source_status.py`.
- **Hard gates fail closed by default** — if a source is `source_failed`
  and the gate depends on that source, the gate fails. `--lenient-external-gates`
  override passes them (used when external sources are persistently
  blocked — e.g., NSE bhavcopy behind Akamai).
- **Numeric values**: `delivery_value_inr` is in INR (not lakhs, not cr).
  Frontend converts to crores for display (`fmtCr()`).
- **Numpy**: scanner uses pandas DataFrames. Code paths avoid global
  state; per-stock eval uses thread-local safety because yfinance
  releases the GIL during I/O.
- **No emojis** in code or docs unless the user explicitly asks.

## Known Issues & Limitations

1. **GH Actions cron drift** (1.1.6 mitigation: healthchecks.io + watchdog).
2. **GH Actions free-tier runner scarcity** (1.1.7 mitigation: extended
   watchdog window 1–13 UTC + cancellation healthchecks ping). During the
   11:30–13:30 UTC peak the scheduler can fail to provision a runner for
   scheduled runs; the job sits in the queue for 15 min and is then
   auto-cancelled. Operationally, the operator gets a cancellation alert
   and can re-trigger via `gh workflow run scan.yml` or the
   `trigger-scan.js` function.
3. **NSE bhavcopy blocked by Akamai** (1.1.5 mitigation: yfinance proxy).
4. **12 h price-field TTL unsafe across splits** — would show stale price
   for up to 12 h after a 2-for-1 split. Documented in CHANGELOG.
5. **GitHub Actions secrets require manual setup** — `NETLIFY_AUTH_TOKEN`
   + `NETLIFY_SITE_ID` are unset in the repo (visible as `::warning::` in
   the workflow log). Netlify auto-deploys via the GitHub Integration
   webhook, so this is non-critical but the manual-deploy step in the
   workflow is currently a no-op.
6. **Multi-hour cron delays misattribute `scheduled_window_utc`** in
   `scan_status.json`. Closest-clock-time heuristic handles small/medium
   drift; very-large drifts (rare) show the wrong window. Documented
   in CHANGELOG 1.1.6.
7. **No backtest / paper-trade validation** — the soft score weights
   are hand-tuned, not backtested. Treat the score as a ranking, not
   an edge.

## Tests

```bash
cd backend
.venv/bin/python -m pytest -q          # 87 tests in ~0.3s
```

Coverage (manual map):

| File | Tests | What's covered |
|---|---|---|
| `test_cache.py` | 10 | JSON read/write/expire/clear; `_safe_key` sanitisation; **cache-wrapper regression tests** (4 functions × read + write + replay) |
| `test_bhavcopy.py` | 10 | CSV parser; multi-provider chain (NSE ok, NSE→yf proxy, all-fail); per-symbol lookup; yfinance_fetch_one edge cases |
| `test_technicals_math.py` | ? | RSI, ATR, EMA, etc. math correctness |
| `test_technicals_nan_rows.py` | 2 | Trailing NaN handling; mock yfinance |
| `test_universe_and_parallel.py` | 6 | Universe top_n fallback; run_scan ThreadPool usage; worker exception handling |
| `test_nse_client.py` | ? | Akamai session helpers |

The `test_cache.py` regression suite was added in 1.1.6 after the
`YF_CACHE_TTL_SECONDS` import-bug incident. They exercise the cache
wrapper path with `NSE_SWING_NO_CACHE` unset — the same path that
breaks in production if any TTL constant is missing from the import
list.

## See also

- `README.md` — user-facing docs (setup, methodology, operational risks)
- `CHANGELOG.md` — versioned release notes (current: 1.1.6)
- `netlify.toml` — build config + cache-control headers
- `backend/scripts/check_cron_consistency.py` — CI guard
- `plans/owner-only-scan-trigger-plan.md` — historical design doc