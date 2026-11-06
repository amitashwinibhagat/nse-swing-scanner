# 1.7.0 — What was fixed

Companion to [PROJECT_REVIEW.md](PROJECT_REVIEW.md). Every finding in that
review is addressed below, with the evidence that the fix works.

Validation at time of writing:

```
backend:   314 tests passed (~2s)      pyflakes clean (production code)
           check_cron_consistency     OK
           check_workflows_parse      4/4 valid
           check_workflow_scripts     9/9 ok
           smoke_scan.py              ok (offline, 63 contract fields)
frontend:  32 node --test specs passed  npm run build ok (dist 250 MB -> 14 MB)
live:      120-stock scan -> 3 PASS, 0 degraded gates, 0 CA failures,
           116/120 priced (the 4 are genuine yfinance gaps, not code)
```

Test count by file (`backend/tests/` unless noted; 286 total):

| File | Tests |
|---|---|
| `test_gates.py` | 43 |
| `test_performance.py` | 38 |
| `test_corporate_actions.py` | 28 |
| `test_json_contract.py` | 23 |
| `test_watchdog_check.py` | 17 |
| `test_workflow_guards.py` | 13 |
| `test_evaluate_feedback.py` | 13 |
| `test_surveillance.py` | 11 |
| `test_scan_schedule.py` | 11 |
| `test_cache.py` | 10 |
| `test_bhavcopy.py` | 10 |
| `test_snapshot_writer.py` | 9 |
| `test_yf_retry.py` | 7 |
| `test_write_scan_status.py` | 7 |
| `test_source_status.py` | 7 |
| `test_send_digest.py` | 7 |
| `test_earnings.py` | 7 |
| `test_universe_and_parallel.py` | 6 |
| `test_technicals_nan_rows.py` | 5 |
| `test_adv_math.py` | 5 |
| `test_technicals_math.py` | 4 |
| `test_workflow_scripts.py` | 3 |
| `test_holdings.py` | 2 |
| `frontend/src/utils/*.test.js` | 27 (`npm run test:unit`) |

---

## P0 — broken in production

### 1. Corporate-actions gate zeroed the product (16 scans, 0 picks)

**Two independent bugs, both reproduced before fixing.**

| Bug | Evidence | Fix |
|---|---|---|
| Endpoint called without `index`/`from_date`/`to_date`. NSE answers `200` + body `Missing index`, so `resp.json()` raised and the adapter reported `source_failed` forever. | Live curl: `200 /api/corporates-corporateActions` → `Missing index`; with params → a 58-row JSON array. | `NSE_CA_ENDPOINT` + explicit `index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY`; date window is `[today-3d, today+lookahead]`. |
| `datetime.fromisoformat("06-Nov-2026")` raises, so *every* row was skipped and `_has_excluded_action_within` always returned `False` — the gate would have silently passed a split on the day it happened. | Direct call returned `False` for an ex-date of that same day. | `parse_action_date()` accepts `%d-%b-%Y` (NSE), ISO, `DD-MM-YYYY`, `DD/MM/YYYY`, `DD Mon YYYY`, and dates with a time part. |

Also fixed while in there:
- "today" is now **IST** (`ist_today()`), not UTC — the two differ for every
  run between 18:30 and 24:00 UTC.
- Excluded action types widened to buybacks, capital reduction, scheme of
  arrangement.
- An excluded action whose date cannot be parsed now **fails closed** rather
  than being skipped (a split we cannot date is exactly the contamination risk
  the gate exists for).
- Failures are no longer cached for 12 h (a transient outage used to extend
  itself).
- `make_status(extra={...})` used to nest the dict under a literal `"extra"`
  key — so `payload["delivery_kind"]` was silently `None` through the bhavcopy
  chain too. Now flattened.

Tests: `tests/test_corporate_actions.py` — 28 specs including the exact
`06-Nov-2026` regression, request-parameter assertions, and a
failure-not-cached check.

**Live verification:** 120-stock scan → `corporate_actions` status `ok` on 9
rows, `not_applicable` on 111, **0 rows failing on the gate**, 0 pending
actions missed.

### 2. CI had created zero jobs since 2026-10-27

The stray space at `ci.yml:20` is gone, and the workflow was restructured so
this class of failure cannot hide again:

- new `lint-workflows` job running `backend/scripts/check_workflows_parse.py`,
  which validates YAML **and** structure (top-level keys, jobs, `runs-on`,
  steps with `uses`/`run`). Proven to reject the original file:
  `invalid YAML (line 20, column 13)`.
- backend job now also runs `pyflakes` and the **offline** smoke scan.
- frontend job runs `npm ci` (no `|| npm install` fallback) and the new unit
  tests.
- `permissions: contents: read`, concurrency with cancel-in-progress.

### 3. The twice-daily schedule was ~7.5 h late — now it is punctual

**The trigger was replaced, not just documented.** GitHub's `schedule` cannot
be made punctual, so the primary trigger is now a pair of **Netlify Scheduled
Functions** running on Netlify's own UTC scheduler:

| Function | Cron (UTC) | IST | Dispatches |
|---|---|---|---|
| `scheduled-scan-morning` | `30 3 * * 1-5` | 09:00 | `repository_dispatch` with `window: "03:30"` |
| `scheduled-scan-evening` | `30 10 * * 1-5` | 16:00 | `repository_dispatch` with `window: "10:30"` |

They share `frontend/netlify/lib/dispatch-scan.mjs`, which retries transient
failures, does **not** retry 401/403/404, and throws on failure so the
invocation is visibly red (a silent no-op here is exactly how the original drift
went unnoticed). `GITHUB_DISPATCH_TOKEN` is already set in the Netlify env, so
this is live on the next deploy.

Supporting changes:

- **Duplicate suppression** — `backend/scripts/resolve_schedule_context.py`
  (new, unit-tested, covered by `check_workflow_scripts.py`). Because the
  punctual trigger and GitHub's cron can both fire for the same window, the
  workflow now skips itself when the last committed scan is already newer than
  the window occurrence. It never skips when the scan is missing or unreadable.
  The `skip` output gates the scan, validation, snapshot, status, commit,
  digest, build, deploy, post-deploy verification and the success ping.
- **Adaptive staleness** — `scan_status.json` now carries
  `stale_after_minutes` (90 min punctual / 8 h fallback) and `schedule_source`.
  The dashboard's stale banner and the watchdog both read it; the watchdog caps
  recovery grace at 45 min on the punctual path.
- **Pre-open T+0** — now that the morning run is genuinely pre-open,
  `performance.infer_scan_phase()` derives the phase per snapshot from
  `generated_at` (03:45 UTC = 09:15 IST boundary), so morning cohorts anchor T+0
  to the prior session instead of shifting a day.
- **Three-way schedule guard** — `check_cron_consistency.py` now validates
  `netlify.toml`'s function schedules *and* each module's inline
  `config.schedule` against `SCAN_WINDOWS_UTC`. Proven to fail on a mismatch.

The GitHub crons stay as a fallback, so a Netlify outage still produces a (late)
scan:

- `scan.yml` now also accepts `repository_dispatch: [scheduled-scan]`, so an
  external punctual scheduler can drive it.
- `scan_status.json` attributes each run to the cron that actually fired
  (`github.event.schedule`), so drift is reported truthfully: the 11:19 UTC
  morning run now reports **469 minutes late** instead of "49 min late"
  attributed to the 10:30 window.
- The dashboard's staleness grace comes from `scan_status.stale_after_minutes`
  (8 h, derived from the measured distribution: median 5.4 h, p75 6.6 h)
  instead of a 30-minute guess that fired a false "the next scan did not
  arrive" banner on every trading day.
- Both runs land after the same close, so the outcome tracker keeps **one
  cohort per trading date** (was double-counting N).
- README documents the real behaviour and the external-trigger option.

### 4. The watchdog's dedup was dead, and the watchdog barely ran

- `GH_TOKEN` is now set on the state step. Without it `gh run list` failed on
  every tick, `|| echo none` swallowed it, and `run_state` was permanently
  `none`.
- An **unknown** run state now suppresses the trigger (`RUN_UNKNOWN`) instead
  of authorising it — the `|| echo none` fallback was the pre-1.3.3
  duplicate-trigger bug wearing a disguise.
- The `|| echo none` is gone; `gh` failure is now an error + safe skip.
- Window widened to `*/15 1-20` so the evening slot (completes ~18:10 UTC) is
  watched at all; the cron guard was updated to match.
- Documented that GitHub fires it ~2×/day, not 52×/day, so it cannot be the
  only recovery path.

---

## P1 — high

### 5. Zero-share trade white-screened the dashboard

- `summarizeTrades` now returns `pnlAbs: null` when nothing was invested (it
  used to return `0` with `pnlPct: null`, and the header did
  `summary.pnlPct.toFixed(1)`).
- New `summarizeLabel()` always returns a string, so the header can never
  render `null`/`NaN`.
- `ErrorBoundary` wraps the app; a render failure now explains itself instead
  of showing a blank page.
- Tests: `frontend/src/utils/trades.test.js` (6 specs, node --test, no deps).

### 6. Monitoring reported green before validation/commit/deploy

- The success ping is now the **last** step. The failure ping is `if:
  failure()` and therefore sees every earlier step.
- The JSON-contract step now also checks `source_health` and warns on a
  universe-wide gate outage.
- A cancellation *while queued* can never run a step; that is documented and
  left to healthchecks' Period+Grace, which is the only mechanism that can
  observe a run that never started.

### 7. The UI asserted an edge the tracker refutes

- `topBandEvidence()` / `topBandClaim()` in `utils/scanData.js` gate the copy
  on the same `ci95.low > 0` check the chips already used.
- KPI delta, shortlist subhead and the drawer table now read, e.g.,
  "63+ band: no established edge (T+5 CI -0.54..0.02, n=1025)".
- README/Rationale/methodology updated to say the same thing.
- Tests: 4 specs pinning that a negative or tiny cohort never produces an
  edge claim.

### 8. The entry-state machine was inert by construction

`technicals.py` sets `entry_zone_high = current_price`, so evaluating a fresh
row against its own plan always returned `in_zone` — every card said "In the
buy zone — consider entering now", every day.

- New `evaluatePlanState(plan, price)` and `planAction(stock, priorPlan)`.
- New `usePriorPlans` hook loads the previous snapshot's levels; cards, table
  chips and the drawer now evaluate **yesterday's plan against today's price**.
- When there is no prior snapshot the action is labelled `plan_only`
  ("Plan only — no prior scan to compare against yet") instead of asserting a
  zone.
- Tests: 6 specs covering every state transition and the basis labelling.

### 9. The surveillance gate had never actually run

- Replaced four invented endpoints (all 404) with the **real** ones:
  - `GET /api/reportASM` → `{longterm:{data:[…]}, shortterm:{data:[…]}}`
    (141 + 50 rows live)
  - `GET nsearchives.nseindia.com/content/equities/sec_list.csv` → 3,608 rows;
    `Series in {BE,BZ,T1T,T2T}` and `Remarks ≈ "GSM STAGE - N"` drive the flags.
- `flag_only` now **fails closed** (`surveillance_unverified`), with
  `--lenient-external-gates` as the explicit escape hatch.
- Failures are cached for 30 minutes, not 7 days.
- Live: 442 restricted symbols resolved; a 120-stock scan produced status `ok`
  on 120/120 and correctly excluded 2 restricted names.
- Tests: `tests/test_surveillance.py` — 11 specs.

### 10–11. PE fetch, stats correctness, deploy truthfulness

- `approx_5y_avg_pe` now runs **only for gate-passed names** (verified: 0
  failed rows carry `avg_pe_5y` in a live scan; it used to run for all 501).
- `t_plus_session(scan_phase="pre_open")` snaps T+0 to the prior session for a
  pre-open scan; `--scan-phase` is exposed on `compute_performance.py`.
- Cohorts deduped per trading date (`dedupe_snapshots_by_date`), with the
  policy recorded in `meta.cohort_policy`.
- Netlify deploy step reports `deployed=false` (a notice, not a false success)
  and a new **post-deploy verification** step asserts the site title and that
  the served `generated_at` matches the committed one.

### 12. Page weight

- `performance.json` (6.2 MB) loads **on demand** — when the track-record or
  delta panel is opened — instead of in the first `Promise.all`.
- `/data/*` fetches use `cache: "no-cache"` (revalidate), not `no-store`.
- `latest_scan.json` is written minified (`separators=(",",":")`).
- A Vite plugin prunes `dist/data/snapshots` to the newest 12 files after
  build: dist went from **250 MB → ~14 MB** (117 files dropped).

### 13. Data-quality biases

- 52-week high: **intraday highs**, **full 252-session window**, fetched over
  `period="2y"` so the window can actually be complete; names with less
  history are flagged `fifty_two_wk_high_partial` and fail the drawdown gate
  with an explicit reason.
- `swing_high_63d` requires all 63 sessions (a 21-session "63-day high"
  understated resistance).
- First attempt at (a) with `period="1y"` failed the *whole* universe (a 1y
  fetch returns ~248 rows, so nothing had 252) — caught by the live
  verification scan and fixed by fetching 2y.

### 14–16. Tracker and workflow correctness

- Cohort dedupe + T+0 phase (above).
- `scheduled_window_utc`/`drift_minutes` attribution fixed (above).
- `git add A B C || true` split into separate adds in the outcome tracker; the
  digest's exit 2 ("nothing digestable yet") is no longer a step failure.
- `snapshot_writer` now **rebuilds** a corrupt `history_index.json` from disk
  instead of truncating it to one entry.

---

## P2 — polish and hardening

**Frontend**
- Header date+time in one timezone (was mixing browser-local date with IST
  time; verified `03 Nov` vs `04 Nov`).
- Drawer: focus trap, focus restore, and an effect that no longer re-runs on
  every parent render.
- Table headers are real buttons (keyboard-sortable); the star button no
  longer swallows Space/Enter; table wrapped in a scroll container.
- `React.memo` on the two card components, stable per-symbol callbacks.
- `conviction_holding` is rendered (7 bars, not 6).
- CSV export serialises `gate_results` and escapes formula injection.
- `localStorage` reads cannot throw during render; cooldown ticks.
- Light-theme contrast 2.43:1 → 5.1:1; focus rings restored on cards, inputs
  and sortable headers; 8 missing CSS classes defined.
- `main.jsx` wraps the app in `ErrorBoundary`; pre-paint theme script (CSP-safe
  external file) removes the light-theme flash; `<noscript>` added.
- `trigger-scan.cjs`: constant-time secret compare, per-IP throttle,
  no config disclosure, no GitHub error echo.

**Backend**
- `_safe_get` checks the column too (a fiscal-year mismatch used to raise
  `KeyError` and lose the whole row).
- Screener politeness on failure (it only slept on success, so a block was
  hammered at full pool concurrency).
- `bhavcopy` proxy `as_of` is the real session date, not `date.today()`; dead
  placeholder removed.
- Removed unused imports; `pyflakes` is now a CI step.
- `cache_disabled()` exposed so modules that manage their own cache honour
  `NSE_SWING_NO_CACHE` (a test was reading another test's cached payload).

**Docs**
- README, methodology, AGENTS.md and CHANGELOG rewritten where they were
  factually wrong (fail-closed claims, "no number is ever hardcoded", the
  15-minute watchdog, `gate-passed names only`, secret inventory, test count).
- `PROJECT_REVIEW.md` is committed as the record of what was found.

---

## 1.8.0 — scoring defects found by asking why zero picks

Two real bugs in the *formula*, not the data pipeline:

1. **`support_proximity` was a constant.** 0.00 for **80%** of gate-passed names
   (mean 0.09, rank IC negative at T+5/T+10/T+20), because the gates select
   names 15–40% off their high and those sit far from the 200EMA — the same
   input the relative-strength factor already used. With it at zero the maximum
   attainable base score was 85, and `85 × 0.70 = 59.5` sat below the 63 cut:
   **14.3% of tracked rows could never be a top pick**, regardless of quality.
2. **The `1.05×` "index correcting" bonus marked the worst cohort** — T+20 excess
   −6.45% vs −0.00% at 1.0× and +0.66% at 0.70×. It rewarded weakness in a weak
   tape. Removed; the factor is now penalty-only.

Fixing (1) exposed the same ceiling one layer down: a `×0.70` multiplier caps a
score at 70, and the band is 74 — still an arithmetic exclusion for 13.5% of
rows. The penalty is therefore **additive** (−15 / −8 points), which demotes a
name without forbidding the top of the scale.

The bands were recalibrated (`pass_v3` → `pass_v4`) to keep the *same selection
share* per band, since the fixes lifted the distribution ~7 points:
**63→74, 60→70, 55→64, 45→53**. This is not a loosened threshold — it re-scores
the same names, and the top band's measured outcome is unchanged (T+5 −0.25%
vs −0.26%, T+20 −0.63% vs −0.96%) and still has **no established edge**.

Verified live: `ATUL` — base 92.6, penalty 15.0 (19.3pp worse than the index),
swing score 77.6, six components, all gates verified.

## Still not fixed (and why)

| Item | Reason |
|---|---|
| GitHub cron punctuality *of the fallback* | GitHub's own scheduler cannot be made punctual. That is why the primary trigger moved to Netlify; the GitHub cron remains a deliberately-late safety net. |
| 3 unset repo secrets (`NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, `HEALTHCHECK_WATCHDOG_URL`) | Requires repo-admin action. The scanner's own scheduler does **not** depend on them: `GITHUB_DISPATCH_TOKEN` is already set in Netlify, so the punctual trigger works on the next deploy. |
| Dependency pinning / action SHA-pinning | Left as an explicit follow-up: pinning without a lockfile generator in CI risks breaking the scan mid-week. `engines`, `NODE_VERSION` and `netlify-cli@27` are pinned. |
| Committed-artifact growth | Minified + deploy-pruned now; moving `performance.json` out of git or gzipping it is a separate migration. |
