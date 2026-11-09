# AGENTS.md — NSE Swing Scanner

> Operational reference for any agent (Kilo, Cursor, human) working on this
> codebase. README.md is user-facing; this file is the technical contract.
> Last updated: 2026-11-09 (1.8.1 scoring + scheduler pass).

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
│  scan.yml (punctual: Netlify scheduler 03:30 + 10:30 UTC, Mon–Fri;      │
│            GitHub cron 03:30 + 10:30 UTC as fallback)                    │
│    │                                                                     │
│    ├── fetch_universe(NIFTY500)             # backend/universe.py       │
│    ├── fetch_surveillance_list()            # backend/surveillance.py    │
│    ├── fetch_bhavcopy()                     # backend/bhavcopy.py        │
│    │      └── NSE → yfinance proxy → BSE   (multi-provider chain)      │
│    ├── compute_nifty50_context()            # backend/technicals.py      │
│    │                                                                     │
│    └── ThreadPoolExecutor(workers=4, sleep=0.5) → per-stock evaluation:           │
│           ├── fetch_holdings()              # backend/holdings.py       │
│           ├── lookup_corporate_actions()    # indexed shared CA payload  │
│           ├── compute_technicals()          # backend/technicals.py      │
│           ├── compute_fscore()              # backend/fscore.py           │
│           ├── approx_5y_avg_pe()            # gate-passed names only      │
│           └── 7 hard gates + soft score                                   │
│                                                                          │
│    ├── Validate JSON contract                                              │
│    ├── Write scan_status.json               (drift calc, best-effort)      │
│    ├── Commit + push latest_scan.json + scan_status.json                 │
│    ├── Deploy + verify the live site (title + generated_at match)         │
│                                                                          ││  watchdog.yml (cron */15 1-20 UTC, Mon–Fri; fires ~2x/day in practice)   │
│    ├── Check latest_scan.json age on main                                │
│    ├── watchdog_check.py: trigger ONLY if late AND no run queued/       │
│    │   in-flight AND cooldown expired (dedup — see 1.3.3)                 │
│    └── Ping healthchecks.io watchdog URL                                  │
└──────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Netlify  (static SPA + 1 serverless function)                            │
│                                                                          │
│  Frontend (React 18 + Vite 8):                                           │
│    - App.jsx (KPI dashboard, table, drawer)                              │
│    - Components: Kpi, StockCard, ScoreRing, Rationale, DetailDrawer, ... │
│    - Reads /data/latest_scan.json + /data/scan_status.json              │
│                                                                          │
│  Functions:                                                             │
│    - /netlify/functions/trigger-scan.cjs (POST, owner-only manual scan)  │
│    - scheduled-scan-{morning,evening}.mjs (PUNCTUAL scan trigger)        │
└──────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Scanner | Python 3.11 | yfinance / pandas / numpy ecosystem |
| HTTP | `requests` + custom session | Simple, no extra deps |
| Frontend | React 18 + Vite 8 | Smallest bundle, no SSR needed for static data |
| Hosting | Netlify free tier | $0, auto-deploys on GH push |
| CI/CD | GitHub Actions + Netlify Scheduled Functions | GH runs the scan; Netlify is the punctual trigger (GH cron drifts hours) |
| Monitoring | healthchecks.io free tier | Cron-drift alerting |
| Secrets | GH repo secrets + Netlify env vars | Standard |

## File Layout

```
.
├── .github/workflows/
│   ├── ci.yml             # push/PR: workflow-lint + guards + pytest + smoke + frontend
│   ├── scan.yml           # 2x daily: full scan + snapshot + digest + commit + Netlify deploy
│   ├── watchdog.yml       # 15min: freshness check + auto-trigger + ping
│   └── outcome-tracker.yml # weekly (Sat 04:00 UTC): forward-return attribution
├── backend/
│   ├── scanner.py         # Entry point: run_scan() orchestrates everything
│   ├── scan_schedule.py   # Scan windows + drift/next-window math (single source of truth)
│   ├── universe.py        # Nifty 100/200/500 fetchers (CSV via NSE archives)
│   ├── holdings.py        # Screener.in shareholding scraper + cache
│   ├── corporate_actions.py # NSE corporate-actions endpoint + cache
│   ├── earnings.py        # yfinance earnings-date lookup (gate-passed names only)
│   ├── performance.py     # Forward returns, pass_v4 buckets + bootstrap CI, re-scoring, trackable meta
│   ├── yf_retry.py        # Shared 429 retry + rate-limit cache predicate
│   ├── surveillance.py    # NSE/BSE T-group/suspension/GSM fetcher
│   ├── bhavcopy.py        # Multi-provider delivery data (NSE/yfinance/BSE)
│   ├── technicals.py      # RSI, ATR, EMAs, 200EMA proximity
│   ├── fscore.py          # Piotroski F-Score + 5Y avg P/E (yfinance)
│   ├── source_status.py   # Standardised {status, source, data} envelope
│   ├── settings.py        # All tunable thresholds + TTLs
│   ├── cache.py           # JSON-file cache + cached_call() wrapper
│   ├── nse_client.py      # Akamai-bypass session helpers
│   ├── requirements.txt   # runtime: yfinance, pandas, numpy, requests, bs4, lxml
│   ├── requirements-dev.txt # runtime requirements + pytest
│   ├── scripts/
│   │   ├── check_cron_consistency.py  # CI guard (cron windows + labels)
│   │   ├── check_workflow_scripts.py  # CI guard (script import path)
│   │   ├── check_workflows_parse.py   # CI guard (workflow YAML validity)
│   │   ├── resolve_schedule_context.py # window attribution + duplicate suppression
│   │   ├── smoke_scan.py              # network-free end-to-end smoke
│   │   ├── write_scan_status.py       # scan_status.json writer
│   │   ├── watchdog_check.py          # Watchdog trigger decision (dedup logic)
│   │   ├── snapshot_writer.py         # B1: dated snapshots + history_index + 90d prune
│   │   ├── compute_performance.py     # C1: outcome tracker CLI (weekly workflow)
│   │   ├── evaluate_feedback.py       # 1.5.0: sub-score ICs + shadow re-scoring (report-only)
│   │   ├── generate_digest.py         # 1.4.3: public weekly accuracy digest (markdown)
│   │   └── send_digest.py             # C3: Telegram digest (soft-fail)
│   ├── cache/             # On-disk JSON cache (gitignored, restored/saved via actions/cache)
│   └── tests/             # 340 tests, all run in ~2s
├── frontend/
│   ├── public/data/
│   │   ├── latest_scan.json    # Committed by scan.yml after each run
│   │   ├── scan_status.json    # Committed by scan.yml (drift calc)
│   │   ├── performance.json    # Committed by outcome-tracker.yml (weekly, aggregates only)
│   │   ├── performance-per-name.json # Companion: raw per_name rows (loaded on demand)
│   │   ├── snapshots/          # Dated minified scans + history_index.json (90d window)
│   │   └── .gitkeep
│   ├── src/
│   │   ├── App.jsx              # Top-level dashboard (shortlist-first default)
│   │   ├── main.jsx             # React root
│   │   ├── styles.css           # Single CSS file, ~1900 lines
│   │   ├── utils/
│   │   │   ├── scanPlan.js      # Entry-state, regime, RS factor, earnings chip (pure)
│   │   │   ├── picks.js        # Top-band shortlist tiering, reasons, band mirror (pure)
│   │   │   ├── sizing.js       # Position sizing + risk math (card & drawer)
│   │   │   ├── trades.js       # Trade-journal status/aggregate math (pure)
││   │   ├── delta.js           # Snapshot diffing (new PASS / dropped / watchlist)
│   │   ├── recentPicks.js     # Prior-cohort scorecard join (pure; feeds RecentPicksStrip)
│   │   │   ├── scanData.js    # payload validation, freshness, evidence gate (pure)
│   │   │   ├── usePriorPlans.js # prior-snapshot levels for entry-state
│   │   │   ├── useWatchlist.js  # localStorage watchlist hook
│   │   │   └── useTradeJournal.js # localStorage trade journal hook
│   │   └── components/
│   │       ├── Kpi.jsx          # KPI tile with delta + accent
│   │       ├── TopPickCard.jsx  # Shortlist card (plan + evidence + reasons)
│   │       ├── MyTrades.jsx     # Local-only trade journal panel
│   │       ├── StockCard.jsx    # Card view (entry-state + earnings chips, watch star)
│   │       ├── ScoreRing.jsx    # Soft score donut
│   │       ├── SubscoreBars.jsx # Sub-score breakdown (+ RS adjustment line)
│   │       ├── DonutHoldings.jsx
│   │       ├── Rationale.jsx    # Methodology explainer
│   │       ├── DetailDrawer.jsx # Per-stock detail panel (gate checklist, position sizer)
│   │       ├── DeltaStrip.jsx   # "Since last scan" banner (B2)
│       ├── RecentPicksStrip.jsx # Receipts banner (63+ evidence) + last-cohort scorecard (C2-adjacent)
│   │       ├── PerformanceSection.jsx # Score-bucket hit-rate view (C2)
│   │       ├── SegmentedControl.jsx, Skeleton.jsx, ErrorBoundary.jsx
│   ├── netlify/
│   │   ├── functions/
│   │   │   ├── trigger-scan.cjs          # Owner-only POST trigger (?admin=1)
│   │   │   ├── scheduled-scan-morning.mjs # punctual 03:30 UTC dispatch
│   │   │   └── scheduled-scan-evening.mjs # punctual 10:30 UTC dispatch
│   │   └── lib/dispatch-scan.mjs          # shared repository_dispatch client (POST /dispatches, NOT /actions/workflows/.../dispatches)
│   ├── package.json             # React 18.3, Vite 8.2
│   └── dist/                    # Build output (gitignored, deployed by Netlify)
├── plans/                        # Older planning docs (kept for context)
├── docs/
│   ├── methodology.md        # Methodology page (linked from dashboard footer)
│   └── analytics.md          # North-star metric definition + analytics decision log
├── netlify.toml                  # Build config + cache-control headers
├── README.md                     # User-facing docs
├── CHANGELOG.md                  # Versioned release notes (latest: 1.8.1)
├── PROJECT_REVIEW.md             # full review that drove the 1.7.0 pass
└── AGENTS.md                     # ← you are here
```

## Local Development

```bash
# Backend (Python 3.11+ required, 3.14 tested)
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q                                            # 340 tests, ~2s
python scanner.py --top-n 500 --workers 8 --sleep 0.3 \
    --lenient-external-gates \
    --output ../frontend/public/data/latest_scan.json

# Frontend
cd frontend
npm install
npm run dev               # vite dev server on :5173
npm run build             # production build to dist/
npm run test:unit         # node --test on the pure utils (no deps)
```

**Hot-reloading during development:** the frontend reads `/data/latest_scan.json` from the public dir, so refreshing the dev server picks up backend changes. Fetches use `cache: "no-cache"` (revalidate), which bypasses the HTTP cache for a changed file without forfeiting caching entirely.

## Commands

### Validation (run before every commit)

```bash
cd backend
.venv/bin/python scripts/check_cron_consistency.py   # CI guard (cron windows)
.venv/bin/python scripts/check_workflows_parse.py    # CI guard (workflow YAML)
.venv/bin/python scripts/check_workflow_scripts.py   # CI guard (script imports)
.venv/bin/python -m pyflakes *.py scripts/*.py       # lint
.venv/bin/python scripts/smoke_scan.py               # offline end-to-end smoke
.venv/bin/python -m pytest -q                        # full suite
cd ../frontend && npm run test:unit && npm run build  # unit tests + bundle
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
    --site 360b23fb-e215-46d8-8072-58f589a165b9 \
    --message="manual deploy: <reason>"
```

**`--site` is mandatory, never optional.** Without it the CLI falls back to
whatever site is linked or, with no link, to an interactive picker. On
2026-10-27T07:22Z a manual deploy ran without `--site`, the picker offered the
Klinote site (`luminous-speculoos-4764fd`, id `23f9c904-a146-464e-96eb-3d9db3fd15e0`,
whose generated name gave no clue it was Klinote; renamed to `klinote` on
2026-11-05), and the scanner build shipped
to **klinote.one**. That domain served the trading screener for 9 days until it
was restored from the 2026-10-21 Klinote deploy. The GitHub Action above is
unaffected: it passes `--site="$NETLIFY_SITE_ID"` explicitly.

After any manual deploy, curl the domain and assert the `<title>` is
`NSE Swing Scanner`, not merely that the command exited 0.

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
| `TELEGRAM_BOT_TOKEN` | scan.yml | Bot token for the post-scan digest (optional; absent → no-op) |
| `TELEGRAM_CHAT_ID` | scan.yml | Target chat for the digest (optional; absent → no-op) |

### Netlify env vars (Site settings → Environment variables)

| Variable | Used by | Purpose |
|---|---|---|
| `SCAN_TRIGGER_SECRET` | trigger-scan.cjs | Owner-only auth token for `?admin=1` POST endpoint |
| `GITHUB_REPO` | scheduled functions | Optional; `owner/repo` override for forks. Defaults to this repo. |
| `VITE_FATHOM_SITE_ID` | ~~frontend build~~ | Removed in 1.5.1 — analytics skipped by owner decision; see docs/analytics.md decision log |
| `GITHUB_DISPATCH_TOKEN` | trigger-scan.js | PAT with `repo` scope to call `repos/{owner}/{repo}/dispatches` |

**Note:** The `trigger-scan.js` function is the documented owner-only manual
trigger (`?admin=1` in the README). The Netlify-deploy step in scan.yml is
a fallback; the GitHub-Integration auto-deploy handles most updates.

## Hard Gates & Thresholds (settings.py)

| Constant | Value | Meaning |
|---|---|---|
| `UNIVERSE_DEFAULT_TOP_N` | 500 | Nifty 500 universe |
| `MIN_F_SCORE` | 6 | Piotroski F-Score ≥ 6 (relaxed from spec's ≥ 7) |
| `MIN_F_SCORE_COMPONENTS` | 9 | Require all Piotroski components before the gate can pass |
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
| `HOLDINGS_CACHE_TTL_SECONDS` | 90 days | Successful Screener results (failures are not cached) |
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
| Corporate actions | NSE `corporate-actions` API, fetched once per scan | (fail-closed) |
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
- GitHub `actions/cache/restore@v6` + `actions/cache/save@v6` with a
  **versioned per-run key** (`nse-swing-cache-v1-${{ github.run_id }}`) and
  `restore-keys: nse-swing-cache-v1-` so each run restores the newest entry and
  writes its own. GitHub cache entries are immutable — a fixed key can be
  written once and then never updated, which would freeze the cache after the
  first eviction. Untouched entries are evicted after 7 days, which bounds
  growth. The save step runs only after a successful scan.

### Important: cache file naming

The cache key for the yfinance proxy used to be `",".join(yf_tickers)`,
which produced a ~7000-char filename for the full Nifty 500 universe —
exceeding most filesystems' 255-byte filename limit. Fixed in 1.1.5 by
hashing the joined ticker list with SHA-256 (16-char prefix). If you add
a new cached call with a long key, hash it.

## CI/CD Workflows

### `scan.yml` (the main scan)

- Triggers: `schedule` (fallback cron), `workflow_dispatch`, and
  `repository_dispatch` (`scheduled-scan`) from the **punctual Netlify
  scheduler**
- Crons: `30 3 * * 1-5` and `30 10 * * 1-5` (UTC). **The GitHub ones fire hours
  late** (median 5.4 h measured; a cron cannot fire early, so an 11:16 UTC run
  is the 03:30 cron) — that is why the primary trigger is
  `frontend/netlify/functions/scheduled-scan-{morning,evening}.mjs`, which runs
  on Netlify's scheduler and dispatches this workflow with
  `client_payload.window`. The GitHub crons remain as a fallback.
- **Duplicate suppression**: `scripts/resolve_schedule_context.py` emits
  `skip=true` when the last committed scan is already newer than the window
  occurrence, so a late GitHub cron does not re-scan a window the punctual
  trigger already covered. A missing/unreadable scan never skips.
- Concurrency: `group: nse-swing-scan, cancel-in-progress: false`
  (queue duplicate runs, don't cancel)
- Timeout: 60 minutes (cold-cache + recovery-pass headroom)
- Steps:
  1. Checkout + Python 3.11
  2. `actions/cache@v6` (backend/cache/)
  3. `pip install -r backend/requirements.txt` (runtime-only dependencies)
  4. `Resolve schedule context` — `scripts/resolve_schedule_context.py` maps the
     trigger to (window label, healthcheck URL, snapshot slot) and decides
     whether to skip an already-covered window. This replaced four duplicated
     `case` blocks.
  5. Ping the scheduled healthcheck `/start` endpoint
  6. `Run full scan` (scanner.py with --top-n 500 --workers 4 --sleep 0.5
     --lenient-external-gates; exits 2 below 85% coverage, **3 when a
     fail-closed gate could not verify**)
  7. Validate JSON contract (asserts `generated_at` + `stocks` non-empty and
     warns when `source_health.critical_source_failed` is set)
  8. **Write dated compact snapshot** (`snapshot_writer.py`: minified
     tracker/delta fields in `data/snapshots/YYYY-MM-DD-{am|pm}.json` + `history_index.json` +
     rolling 90-day prune)
  9. Write `scan_status.json` via `scripts/write_scan_status.py`, attributing
     the run to the cron that fired (`github.event.schedule`)
  10. Commit + push latest_scan.json + scan_status.json + snapshots/
  11. **Telegram digest** (`send_digest.py`, secrets-gated, soft-fails)
  12. Frontend build + Netlify deploy (gated by `if: success()`)
  13. Verify the deployed site: title is `NSE Swing Scanner` and the served
      `generated_at` matches the committed one
  14. **Success ping last** — it used to fire before validation/commit/deploy,
      so those failures reported green to healthchecks.io

### `watchdog.yml` (cron drift detector)

- Triggers: `schedule` (cron `*/15 1-20 * * 1-5` UTC, Mon-Fri) + `workflow_dispatch`
- Window covers 06:30–01:30 IST. The 1–20 range is needed because the evening
  scan now completes ~18:10 UTC; a 13:00 cutoff left the whole evening slot
  unmonitored. **In practice GitHub fires this ~2x/day, not 52x/day.**
- `gh run list` needs `GH_TOKEN`; the state step now sets it. Without it the
  check failed silently (`|| echo none`), so `run_state` was always `none` and
  the duplicate-suppression guard never ran.
- Permissions: `contents: write, actions: write` (marker commit push + `gh workflow run`)
- Dedup logic (1.3.3): the decision lives in `scripts/watchdog_check.py`
  (unit-tested). A scan is "late" only past `next_expected_utc` + 30 min
  grace; the trigger fires ONLY when no scan run is queued/in-flight
  (`gh run list`) AND the 45-min cooldown marker (`.github/
  .watchdog_last_trigger`, committed) has expired. Pre-1.3.3 it fired on
  every stale tick, queueing 3-4 duplicate runs per drifted scan.
- Steps:
  1. Check freshness of `latest_scan.json` on `main` + scan run state
  2. `watchdog_check.py` decides; on TRIGGER (exit 10): commit the marker,
     then `gh workflow run scan.yml`. `run_state=unknown` (gh failed) now
     suppresses the trigger instead of authorising it.
  3. Ping `HEALTHCHECK_WATCHDOG_URL` with
     `?stale=...&age_min=...&run_state=...` query

### `ci.yml` (push/PR gate)

- Runs on every push and PR to `main`
- `lint-workflows` job: `check_workflows_parse.py` validates every workflow's
  YAML **and** structure. A workflow cannot lint itself — `ci.yml` was invalid
  YAML from 2026-10-27 to 2026-11-05 and created zero jobs, so nothing else ran.
- Backend job: cron guard + workflow-script guard + pyflakes + pytest +
  `smoke_scan.py` (offline; stubs every external source)
- Frontend job: `npm ci` (no fallback) + `npm run test:unit` + build
- Both jobs green = merge-eligible

### `outcome-tracker.yml` (weekly attribution)

- Triggers: `schedule` (cron `0 4 * * 6` — Saturday 09:30 IST) + `workflow_dispatch`
- Reads `data/snapshots/*`, fetches T+5/T+10/T+20 forward returns for each
  snapshot's gate-passed cohort (per-name excess vs ^NSEI), writes
  `data/performance.json`, commits + pushes
- Statistical discipline is enforced in `backend/performance.py`: per-scan
  cohorts (never pooled), median + IQR + N, untrackable symbols counted
  separately, **one cohort per trading date** (am+pm describe the same close),
  and `--scan-phase` so a pre-open snapshot's T+0 is the prior session. Frontend `PerformanceSection.jsx` renders the per-bucket
  table and hides gracefully until the first payload lands.
- First useful score-bucket cohorts appear after ~3-4 weeks of accumulated
  snapshots (T+20 needs 20 trading days to close).

## healthchecks.io + Watchdog Setup

This is critical because **GitHub Actions cron is best-effort** —
observed 3h+ late runs and missed slots in 2026-07.

### Two-check setup (current state)

| Check | Cron | Grace | UUID | URL pattern |
|---|---|---|---|---|
| Morning | `30 3 * * 1-5` (UTC) | 4 h | `d31b1ec5-…085f` | `https://hc-ping.com/d31b1ec5-04a3-4401-a7b6-2ac9d162085f` |
| Evening | `30 10 * * 1-5` (UTC) | 4 h | `1e6082f1-…77db` | `https://hc-ping.com/1e6082f1-d26d-46fe-96c8-b914f4aa77db` |

scan.yml resolves the URL from the cron that fired in one place
("Resolve schedule context" step, backed by `scan_schedule.WINDOW_LABELS`),
instead of four duplicated `case` blocks.

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

A run cancelled *while queued* never starts a job, so no step (including
`if: cancelled()`) can run. That case is caught only by healthchecks.io's own
Period+Grace alert.

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
6. If the gate depends on an external source, add it to
   `CRITICAL_GATE_SOURCES` in `scanner.py` so a universe-wide outage surfaces
   in `source_health` instead of looking like a quiet market

### Add a new scheduled window

Three places, kept in sync by `backend/scripts/check_cron_consistency.py`:

1. Add `- cron: "M H * * 1-5"` to `.github/workflows/scan.yml` (the fallback)
2. Update `SCAN_WINDOWS_UTC` in `backend/settings.py` — the single source
   of truth consumed by `scan_schedule.py` (scan_status attribution +
   watchdog staleness) and by the CI guard
3. Add the window's display label + snapshot slot to `WINDOW_LABELS` /
   `WINDOW_SLOTS` in `backend/scan_schedule.py`. The CI guard fails if a
   window has no label (a new window without one silently loses its pings and
   its `--slot`).
4. Add a Netlify scheduled function `scheduled-scan-<name>.mjs` calling
   `runScheduledWindow("HH:MM")`, and its `[functions."..."] schedule` entry in
   `netlify.toml`. The CI guard validates all three copies against
   `SCAN_WINDOWS_UTC`.
5. Add a new healthchecks.io check + secret if you want independent alerts

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
  **or `flag_only`** and the gate depends on it, the gate fails.
  `--lenient-external-gates` is the explicit override. Every fail-closed source
  gate is listed in `CRITICAL_GATE_SOURCES`; a universe-wide failure there is
  published as `source_health.critical_source_failed` and exits 3, so an outage
  can never masquerade as "no candidates today".
- **Numeric values**: `delivery_value_inr` is in INR (not lakhs, not cr).
  Frontend converts to crores for display (`fmtCr()`).
- **Numpy**: scanner uses pandas DataFrames. Code paths avoid global
  state; per-stock eval uses thread-local safety because yfinance
  releases the GIL during I/O.
- **Workflow scripts path bootstrap** — GH Actions runs
  `python scripts/<name>.py` with `working-directory: backend`. That puts
  `scripts/` on `sys.path`, **not** `backend/`. Any script that imports a
  backend module (`performance`, `scanner`, …) must insert the parent
  dir onto `sys.path` before those imports (see
  `compute_performance.py`). Unit tests that path-hack before `import`
  will **not** catch this. CI runs `scripts/check_workflow_scripts.py`
  to smoke every entrypoint the same way production does.
- **No emojis** in code or docs unless the user explicitly asks.

## Known Issues & Limitations

1. **GH Actions cron drift is structural, not a bug to fix.** Measured median
   5.4 h late. The punctual trigger is now Netlify Scheduled Functions
   (`scheduled-scan-{morning,evening}.mjs`); the GitHub crons are a fallback and
   the workflow skips an already-covered window. If Netlify is down AND the
   fallback drifts, scans are late rather than lost — the watchdog still fires.
   **The scheduler function MUST post to `/repos/{owner}/{repo}/dispatches`**
   (repository_dispatch), never `/actions/workflows/scan.yml/dispatches`: the
   workflow_dispatch endpoint rejects `client_payload` with HTTP 422, and that
   silently lost every scheduled run from 2026-11-07 to 2026-11-09. 422 is
   treated as permanent (no retry) and its message is surfaced.
2. **GH Actions free-tier runner scarcity** (1.1.7 mitigation: extended
   watchdog window + cancellation healthchecks ping). During the
   11:30–13:30 UTC peak the scheduler can fail to provision a runner for
   scheduled runs; the job sits in the queue for 15 min and is then
   auto-cancelled. Operationally, the operator gets a cancellation alert
   and can re-trigger via `gh workflow run scan.yml` or the
   `trigger-scan.js` function.
3. **NSE bhavcopy blocked by Akamai** (1.1.5 mitigation: yfinance proxy).
4. **12 h price-field TTL unsafe across splits** — would show stale price
   for up to 12 h after a 2-for-1 split. Documented in CHANGELOG.
5. **GitHub Actions secrets require manual setup** — `NETLIFY_AUTH_TOKEN`
   + `NETLIFY_SITE_ID`, `HEALTHCHECK_PING_URL_CANCELLED` and
   `HEALTHCHECK_WATCHDOG_URL` are still unset. The deploy step now reports
   `deployed=false` (a notice, not a false success) and the workflow verifies
   the live site after every run, so a broken GitHub-Integration auto-deploy
   is caught instead of silently freezing the dashboard.
6. **Schedule attribution is exact, drift is not eliminated.** Each run is
   attributed to the window that actually fired it (`github.event.schedule` or
   `client_payload.window`), so `scan_status.json` reports the true delay. The
   Netlify scheduler is what makes the delay small; GitHub's is the fallback.
7. **No backtest / paper-trade validation**, and the committed tracker shows
   **no established edge for any score band** (74+ T+5 mean −0.39%, CI
   −0.78..−0.00). The dashboard derives its copy from the tracker instead of
   asserting an edge.
8. **yfinance rate-limits on GHA egress** (1.3.1 mitigation: yf_retry,
   coverage gate at 85%, rate-limit results not cached; 1.3.2 mitigation:
   workers=4/sleep=0.5 + poison-cache eviction on read + serial recovery
   pass). A half-blind scan exits 2 and keeps last-good JSON.
9. **Outcome tracker empty cache poison** (1.3.1 fix: never cache empty
   closes; session-index T+N; window_not_closed ≠ untrackable).

## Tests

```bash
cd backend
.venv/bin/python -m pytest -q          # 340 tests in ~2s
```

Coverage (manual map):

| File | Tests | What's covered |
|---|---|---|
| `test_cache.py` | 10 | JSON read/write/expire/clear; `_safe_key` sanitisation; **cache-wrapper regression tests** (4 functions × read + write + replay) |
| `test_bhavcopy.py` | 10 | CSV parser; multi-provider chain (NSE ok, NSE→yf proxy, all-fail); per-symbol lookup; yfinance_fetch_one edge cases |
| `test_technicals_math.py` | 4 | RSI, ATR, EMA, etc. math correctness |
| `test_technicals_nan_rows.py` | 5 | Trailing NaN handling; mock yfinance |
| `test_universe_and_parallel.py` | 6 | Universe top_n fallback; run_scan ThreadPool usage; worker exception handling |
| `test_scan_schedule.py` | 11 | Window attribution, next-window/weekend math, cron-vs-settings sync |
| `test_watchdog_check.py` | 21 | Watchdog dedup decision (run-state incl. unknown, cooldown, staleness), marker I/O, CLI exit codes |
| `test_corporate_actions.py` | 28 | NSE date formats, excluded-action window, request params, failure not cached |
| `test_surveillance.py` | 11 | reportASM + sec_list parsing, restriction severity, status policy |
| `test_write_scan_status.py` | 7 | Cron-based window attribution, drift, staleness grace |
| `test_resolve_schedule_context.py` | 13 | Trigger→window mapping, duplicate suppression, weekend window math |
| `test_workflow_guards.py` | 23 | The guards catch the failures they exist for; plus workflow-step assertions (GH_TOKEN, ping ordering, absolute deploy paths, single-path `git add`, dispatch trigger) |
| `test_performance.py` | 54 | Cohort dedupe, T+0 phase, bootstrap CI, bucketing, current-scheme re-scoring, payload split |

The `test_cache.py` regression suite was added in 1.1.6 after the
`YF_CACHE_TTL_SECONDS` import-bug incident. They exercise the cache
wrapper path with `NSE_SWING_NO_CACHE` unset — the same path that
breaks in production if any TTL constant is missing from the import
list.

## See also

- `README.md` — user-facing docs (setup, methodology, operational risks)
- `CHANGELOG.md` — versioned release notes (current: 1.8.1)
- `netlify.toml` — build config + cache-control headers
- `backend/scripts/check_cron_consistency.py` — CI guard (cron windows)
- `backend/scripts/check_workflow_scripts.py` — CI guard (script import path)
- `plans/owner-only-scan-trigger-plan.md` — historical design doc
