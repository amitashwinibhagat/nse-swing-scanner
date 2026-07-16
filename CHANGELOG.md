# Changelog

## 1.1.9 — Drop Del. val column from UI

### Why

After the 1.1.8 Liquidity Adequacy gate shipped, the yfinance traded-value
proxy (`volume × close`) can no longer satisfy any hard gate and is never
the right answer to the buyer's "is this name liquid?" question. Showing
it as a "Del. val (₹cr)" column with a `proxy` badge just invited
"what does proxy mean?" confusion and visual noise on every row.

### Changed

- `frontend/src/App.jsx`, `DetailDrawer.jsx`: removed the **Del. val
  (₹cr)** column from the table, the CSV export, and the drawer's
  hard-gates block. The drawer now shows a single
  **Liquidity / ADV (₹cr)** row with a small `adv` / `delivery_actual`
  chip on whichever path satisfied the gate.
- `frontend/src/components/Rationale.jsx`: dropped the DEL. VAL term
  entirely; rewrote the intro copy to make clear that the bhavcopy
  delivery signal is optional (only ever tightens the gate, never
  inflates it).
- `frontend/src/styles.css`: removed the unused `.proxy-badge` rule.

### Removed (visual only)

- `proxy-badge` HTML — no remaining consumers. The internal `delivery_*`
  JSON fields stay for traceability.

## 1.1.8 — Liquidity Adequacy gate (proxy delivery demoted)

### Why

The "delivery ≥ ₹5cr" hard gate was being satisfied by the yfinance
single-day traded-value proxy (volume × close) whenever NSE bhavcopy was
unreachable. Traded value is typically 2-3× real delivery, so the
PASS list was inflated and the dashboard's strongest signal was no
longer trustworthy.

### Changed

- `backend/scanner.py`: replaced `gate_delivery_value` with
  `gate_liquidity_adequacy`. A row now PASSes if EITHER real NSE/BSE
  delivery ≥ ₹5cr is available, OR its 20-session average traded value
  (ADV) from yfinance is ≥ ₹10cr. Single-day traded-value proxy is no
  longer a valid gate path on its own.
- `backend/technicals.py`: computes a true 20d ADV (mean of
  `volume * close` over the last 20 valid sessions, min_periods=15) and
  exposes `adv_value_inr` + `adv_sessions`.
- `backend/settings.py`: adds `MIN_ADV_VALUE_INR`, `ADV_LOOKBACK_SESSIONS`,
  `ADV_MIN_SESSIONS`. Existing `MIN_DELIVERY_VALUE_INR` is retained for
  the real-delivery path.
- JSON contract: new fields `adv_value_inr`, `adv_sessions`,
  `liquidity_gate_path` — values are `"delivery_actual"` when real NSE
  delivery satisfied the gate, `"adv"` when the 20d ADV fallback did,
  or `null` when the gate failed. Surfaces which path satisfied the
  gate so the UI can label it.
- `backend/settings.py`: also adds `MIN_ADV_SECONDARY_FLOOR_INR` (₹3cr)
  as a secondary ADV floor when the real-delivery path passes (prevents
  thinly-traded names from sneaking through on a single high-delivery
  day) and `ADV_HARD_CEILING_INR` (₹5000cr) to clamp yfinance volume
  outliers from suspension/resumption sessions.

### UI

- Table gains an **ADV (₹cr)** column ahead of the delivery column.
- The delivery column shows `—` for proxy rows; proxy is now annotated
  as "not used by the gate" in the drawer.
- Detail drawer shows both ADV and (when available) real delivery, with
  a small `gate` chip on whichever one satisfied the liquidity gate.

### Validation

- 93 pytest passes; frontend build green.
- No PASS row with `delivery_kind == "traded_value_proxy"` unless
  `adv_value_inr >= MIN_ADV_VALUE_INR`.

## 1.1.7 — Watchdog window extended + cancellation alert

### Changed

- `.github/workflows/watchdog.yml`: cron window extended from
  `*/15 1-11` to `*/15 1-13` UTC (06:30–19:00 IST, was 06:30–17:00 IST).
  Gives the watchdog an automated recovery path for the 16:00 IST
  evening slot when the 10:30 UTC cron gets cancelled during the GH
  Actions free-tier runner peak (11:30–13:30 UTC).

### Added

- `.github/workflows/scan.yml`: new `if: cancelled() && event == schedule`
  step that pings a dedicated `HEALTHCHECK_PING_URL_CANCELLED` healthchecks
  URL with `/fail` when a scheduled run is cancelled. Operator gets an
  early alert (email/Slack) before the next watchdog tick, so manual
  re-trigger via `gh workflow run scan.yml` or the `trigger-scan.js`
  function can land fresh data within minutes.

### Why

On 2026-07-09 the 10:30 UTC scheduled scan and a follow-up `workflow_dispatch`
at 11:38 UTC both sat in the GH Actions queue for the full 15 min
without ever being assigned a runner, then were auto-cancelled. The
watchdog's previous 11:30 UTC window cutoff meant no automated recovery
was possible until the next morning's cron. Now the watchdog covers
the peak-failure window and the operator gets pinged the moment a
cancellation lands.

### Operator setup required

1. Create a third healthchecks.io check named
   "NSE Swing Scan — Cancelled" (period 1h, grace 30 min).
2. Set the resulting URL as the new GitHub repo secret
   `HEALTHCHECK_PING_URL_CANCELLED`. Absent → no-op with `::notice::`
   log (matches the existing healthchecks secret pattern).

## 1.1.6 — Cron drift monitoring: healthchecks.io pings + watchdog workflow

### Added

- `.github/workflows/scan.yml`: three new ping steps that hit a
  healthchecks.io URL at `/start`, `/fail`, and the success endpoint.
  Optional via `HEALTHCHECK_PING_URL_MORNING` and
  `HEALTHCHECK_PING_URL_EVENING` repo secrets; absent → no-op with
  `::notice::` log. The cron expression that triggered the run is read
  via `github.event.schedule` so the workflow picks the right URL
  based on morning vs evening slot.
- `.github/workflows/watchdog.yml`: redundant cron that runs every 15
  min during market hours (01:00–11:30 UTC). Checks `latest_scan.json`
  age on `main` and, if stale >45 min, fires `gh workflow run scan.yml`
  for self-recovery. Pings its own healthchecks.io URL via
  `HEALTHCHECK_WATCHDOG_URL` with `?stale=` and `?age_min=` query
  params so alerts carry context.
- README § "Monitoring (healthchecks.io + watchdog)" with the full
  one-time setup procedure.

### Why

GitHub Actions scheduled cron is best-effort. The 16:00 IST (10:30 UTC)
cron on 2026-07-03 did not fire at all. Recent prior crons drifted
1h54m–3h18m late. healthchecks.io detects missed/failed runs via
absent or `/fail` pings; the watchdog provides a redundant backstop
that can also auto-trigger a recovery scan.

### Operator setup required

1. Sign up at <https://healthchecks.io> (free).
2. Create two checks for the scan slots (period 12h, grace 4h).
3. Create one check for the watchdog (period 1h, grace 1h).
4. Set three GitHub Actions secrets: `HEALTHCHECK_PING_URL_MORNING`,
   `HEALTHCHECK_PING_URL_EVENING`, and `HEALTHCHECK_WATCHDOG_URL`.
   (See README for details.)

## 1.1.5 — Multi-provider delivery data with yfinance traded-value proxy

### Changed

- `backend/bhavcopy.py`: replaced single-source NSE fetch with a
  three-provider fallback chain. When NSE bhavcopy is blocked by Akamai
  (the persistent state since mid-2026), the scanner now reports
  real-looking data from yfinance's daily OHLCV (`volume × close`) as a
  traded-value proxy, and BSE archives as a last resort.

### Added

- `delivery_kind` field on each stock's record. Values:
  - `"actual"` — real delivery data from NSE or BSE bhavcopy
  - `"traded_value_proxy"` — fallback proxy from yfinance (volume × close;
    typically 2-3× real delivery value because it includes intraday trades)
- `delivery_fallback_from` field naming the original source the proxy
  replaced (e.g. `"nse:bhavcopy"`).
- Frontend proxy badge: rows with `delivery_kind == "traded_value_proxy"`
  display a yellow `proxy` chip next to the value, with a tooltip
  explaining the source. The label switches from "Delivery (₹cr)" to
  "Traded val (₹cr)" so the column header is honest about the data.
- `provider_chain` list in the bhavcopy source_status payload, recording
  which providers were tried and their outcomes.

### Trade-off

The ₹5 cr delivery gate uses the proxy value when NSE is unreachable,
which is approximately 2-3× the real delivery threshold. So rows that
fail the real NSE gate would have passed the proxy gate. The badge in
the UI makes this visible. When NSE returns, the gate tightens back to
real delivery data automatically.

## 1.1.4 — Bump GitHub Actions to drop Node 20 deprecation warning

### Changed

- `actions/checkout` v4 → v7
- `actions/cache` v4 → v6
- `actions/setup-python` v5 → v6
- `actions/setup-node` v4 → v6

GitHub is deprecating Node 20 on hosted runners; the v4/v5 action pins
were being forced onto Node 24 and emitting a deprecation warning on
every workflow run. The bumped versions target Node 24 natively.

## 1.1.3 — Expand universe to Nifty 500 with ~5–7 min cold-cache runtime

### Changed

- Workflow `--top-n 200` → `--top-n 500`: full Nifty 500 universe, up from
  top 200. Coverage now includes mid/small-cap names that actually drive
  swing-trade volume.
- Drift calculation in the "Write scan_status.json" step now picks the
  scheduled window whose HH:MM is closest to `now`'s wall-clock (circular
  minute-distance). Replaces the previous `max(past)` heuristic which
  misattributed multi-hour-delayed crons to the wrong slot.

### Added

- yfinance result caching: `compute_technicals`, `compute_fscore`,
  `approx_5y_avg_pe`, and `compute_nifty50_context` now read/write
  on-disk JSON caches keyed on ticker symbol with 12 h TTL (24 h for
  fundamentals). Warm-cache scans complete in ~30-90 s instead of 3-5 min.
  Tests bypass the cache via the `NSE_SWING_NO_CACHE=1` env var (set
  automatically in `backend/tests/conftest.py`).
- `UNIVERSE_DEFAULT_TOP_N = 500` in `backend/settings.py`.
- `YF_CACHE_TTL_SECONDS` (12 h) and `YF_FUNDAMENTAL_CACHE_TTL_SECONDS`
  (24 h) in `backend/settings.py`.
- Frontend drift pill now surfaces `scheduled_window_utc` so the user can
  see which scheduled slot the run was attributed to
  (e.g. `12 min ago • 17 min late (03:30 UTC)`).
- `Write scan_status.json` and `Commit and push updated scan` workflow
  steps now both gate on `if: success()`, preventing `scan_status.json`
  from lagging `latest_scan.json` if the Write step fails.
- Regression tests in `backend/tests/test_cache.py` that exercise the
  cache wrapper paths with `NSE_SWING_NO_CACHE` unset, catching the
  NameError-on-missing-import class of bug.

### Performance (projected, not yet measured)

- Cold-cache Nifty 500 scan with `workers=12, sleep=0.2`: **~5-7 min**
  (vs ~12-20 min projected for 500 stocks with the old 200-stock
  config). The yfinance cache is the main speedup — per-stock cost drops
  from ~6 s (cold) to ~0.4 s (warm).
- Warm-cache scan (same day, second run): **~30-90 s** (vs ~5-10 min).

### Fixed

- `backend/fscore.py`: `approx_5y_avg_pe` now imports
  `YF_CACHE_TTL_SECONDS` (was missing, caused `NameError` at runtime
  in production; masked by `NSE_SWING_NO_CACHE=1` in tests).

### Known limitations

- 12 h TTL on price-derived fields (current_price, 52W high, ATR, ADTV)
  is unsafe across stock splits / demergers. The cached scalars will
  reflect the pre-split snapshot for up to 12 h after a corporate action.
  Documented; revisit if NSE-listed splits become more frequent.
- `--workers 16 / --sleep 0.1` was tried and reverted to the safer
  `12 / 0.2` config after empirical rate-limit concerns (Screener.in
  HTML scrape + yfinance burst on a shared GH Actions egress IP).
- Multi-hour cron delays can still misattribute the scheduled window in
  `scan_status.json` (GitHub Actions does not expose which cron
  expression fired). The closest-clock-time heuristic handles small/medium
  drift; very-large drifts (rare) may surface a misleading window.

## 1.1.2 — Live freshness indicator + tighter edge cache

### Added

- `frontend/public/data/scan_status.json`, committed alongside
  `latest_scan.json` by `.github/workflows/scan.yml`. Contains
  `generated_at`, `triggered_at`, `commit_sha`, `run_id`, `trigger`
  (`schedule` | `workflow_dispatch`), `scheduled_window_utc`,
  `scheduled_cron`, and `drift_minutes` (for scheduled runs).
- "Last scan" KPI on the dashboard now shows relative age
  (e.g. `12 min ago`) and a drift indicator
  (e.g. `• 17 min late vs schedule`). Accent colour: green < 14 h,
  amber 14–20 h, red > 20 h. Falls back gracefully when
  `scan_status.json` is unavailable.
- Stale-data banner now links to the GitHub Actions tab.

### Changed

- `netlify.toml`: `/data/*` cache-control tightened from
  `public, max-age=300, stale-while-revalidate=600` to
  `public, max-age=60, must-revalidate`. Perceived staleness drops
  from ~15 min to ~60 s after a successful scan push.

## 1.1.1 — Expand universe to Nifty 200

### Changed

- Default universe bumped from Nifty 100 to **Nifty 200** (top 200 by
  free-float market cap). The top 200 covers large- and mid-cap names that
  actually see swing-trade volume, with ~5-8 min cold / ~2-4 min warm
  runtime at 12 workers.
- Workflow bumped to `--top-n 200 --workers 12` to compensate for the
  larger universe.

## 1.1.0 — Top-N universe + parallel scan

### Changed

- Default universe is now the **Nifty 100** (top 100 by free-float market cap) instead of the full Nifty 500.
  The top 100 covers the names that swing traders actually watch and gives the
  best signal-to-noise. Use `--top-n 500` for the full list when needed.
- Scanner is now **multi-threaded** via `ThreadPoolExecutor` (default 8 workers).
  yfinance releases the GIL during HTTP I/O, so this is effective without
  switching to multiprocessing. Typical Nifty 100 cold-cache runtime: ~1-3
  minutes (was ~30 minutes single-threaded on Nifty 500).
- Workflow now invokes `python scanner.py --top-n 100 --workers 8 --sleep 0.2`.

### Added

- New `fetch_universe(top_n)` and per-index fetchers `fetch_nifty100`,
  `fetch_nifty200`, `fetch_nifty500` in `universe.py`.
- New CLI flags `--top-n {100,200,500}` and `--workers N`.
- Per-stock work factored into `_evaluate_one_stock` for testability.
- Progress logging every 25 stocks with elapsed time, rate, and ETA.
- `KeyboardInterrupt` cleanly cancels the worker pool.
- 6 new tests for top-N selection and the parallel path.

## 1.0.0 — Public launch

Initial public release. Closes the free-data feature gaps documented in
earlier `backend/README.md`.

### Added

- True delivery value from NSE daily bhavcopy (`bhavcopy.py`).
- T-group / GSM / suspension hard gate with NSE → BSE fallback (`surveillance.py`).
- Promoter / FII / DII conviction hard gate via Screener.in (`holdings.py`).
- Pending corporate actions hard gate (NSE corporate actions).
- ATR(14)-based entry zone / stop-loss / targets (`technicals.py`).
- Relative-strength vs Nifty 50 soft factor (`scanner.py`).
- Source-status envelope (`source_status.py`) — every external fetch reports
  one of `ok`, `missing`, `source_failed`, `fallback_used`, `flag_only`,
  `not_applicable`. Hard gates fail-closed on `source_failed`.
- On-disk JSON cache with per-source TTLs (`cache.py`).
- pytest suite covering RSI/ATR math, named gate functions, bhavcopy parser,
  holdings parser, source-status envelope, and the JSON output contract.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) for backend
  pytest + smoke scan + frontend build.
- Scheduled-scan concurrency, dependency caching, and JSON contract
  validation step (`.github/workflows/scan.yml`).
- Netlify security headers (CSP, X-Frame-Options, Referrer-Policy) and a
  longer cache for `/data/*` (`netlify.toml`).
- Frontend: new columns (delivery, holdings, ATR, T1, Stop), source-status
  badges, CSV export, stale-data warning, keyboard accessibility,
  meta/OG/favicon metadata, a richer expanded detail panel.
- `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, `docs/methodology.md`.

### Changed

- `scanner.py` gate logic refactored into named functions (one per criterion).
- Operator-precedence bug on the original `tech.get("error") or …` line fixed.
- ATR(14) replaces ad-hoc ATR for the entry/target/stop output.
- F-Score threshold made configurable (`settings.py`), default unchanged at
  `>=6`; spec `>7` is documented as stricter and tunable.
- Universe is fetched once; surveillance / bhavcopy / nifty50 / per-symbol
  holdings and corporate actions are fetched once and shared across the
  scan.
- README and `backend/README.md` rewritten to reflect the new gates and to
  move the unresolved items (earnings surprise, backtested weights) into
  an explicit Limitations section.

### Deferred (Phase 2)

- **Earnings surprise** — no negative surprise in last 2 quarters. Requires
  consensus-estimate data, which is not available from a clean free source
  for Indian mid-caps. Defer until a paid source or community-shared estimate
  feed is wired in.
- **Backtested weight calibration** — the soft-score weights and F-Score
  threshold are hand-tuned starting points, not optimized. A separate
  backtesting harness against historical NSE data is needed before treating
  the score as a strategy signal.
- **Real-time / intraday scanning** — out of scope; current cadence is
  twice daily at IST 09:00 and 16:00.
