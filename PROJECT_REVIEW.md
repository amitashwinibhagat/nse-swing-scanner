# NSE Swing Scanner — full project review

**Date:** 2026-11-06
**Reviewed commit:** `11eb034` (local), cross-checked against `origin/main` `3992088`
**Scope:** backend (scanner, gates, data adapters, performance, scripts, tests),
GitHub Actions, Netlify config/function, React frontend, committed data, docs.
**Method:** read every source file; ran the suite (`209 passed`), both CI guards,
the frontend build and a live 3-stock scan; probed the real NSE corporate-actions
and Screener.in endpoints; analysed all 129 committed snapshots, `performance.json`
(5,796 rows), 60 days of workflow runs and the live repo state. Findings marked
"verified" were reproduced, not inferred from comments.

**Bottom line:** the engineering craft here is high — atomic writes, a coverage
gate, per-cohort statistics, honest digests, 209 fast tests. But the product is
currently **publishing zero picks**, **has no working CI**, runs its "twice daily"
scans **~7.5 hours late**, and its headline claim of an edge is **contradicted by
its own track record**. Fixing four things restores the product; the rest is
polish and hardening.

---

## Executive summary

| # | Finding | Impact | Effort |
|---|---|---|---|
| 1 | NSE corporate-actions adapter has two independent bugs → gate fails for 501/501 → **0 picks for 16 consecutive scans (2026-10-27 → 2026-11-05)** | Product dead | ~1 h |
| 2 | `ci.yml:20` invalid YAML → **CI has created zero jobs since 2026-10-27** (last green 2026-09-15) | No safety net | 1 char |
| 3 | GitHub `schedule` fires **~7.5 h late every day**; the "09:00 IST" scan lands ~16:46 IST, after the close | Data stale all session | 1–2 days |
| 4 | Watchdog duplicate-suppression is dead (`gh` called without `GH_TOKEN`) and the watchdog itself runs **~2×/day, not every 15 min** | Recovery unreliable | 1 h |
| 5 | A zero-share trade **white-screens the entire dashboard** on every reload (no error boundary) | User-facing data loss | 15 min |
| 6 | UI hardcodes "the only band with a measured edge"; the committed tracker says 63+ is **−0.26% T+5, −0.96% T+20** | Credibility | 1 h |

---

## P0 — broken in production now

### 1. Corporate-actions gate zeroes the entire product

**Symptom.** `frontend/public/data/latest_scan.json` (and all 16 snapshots from
2026-10-27 through 2026-11-05) has `gate_pass_count: 0`. 490/501 rows carry
`gate_fail_reason: corporate_actions_source_failed`.

**Root cause A — the endpoint is called without required parameters.**
`backend/corporate_actions.py:37-41` probes:

- `/api/corporates-corporateActions`
- `/api/corporate-actions`
- `/api/equity-corporateActions`

The first is real, but NSE requires
`?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY`. Without them it returns
HTTP 200 with the body `Missing index`, so `resp.json()` raises and
`nse_get_json` returns `None`. The other two paths are 404. Verified live:

```
200 /api/corporates-corporateActions
    Missing index
404 /api/corporate-actions
404 /api/equity-corporateActions
200 /api/corporates-corporateActions?index=equities&from_date=06-11-2026&to_date=06-12-2026
    [{"symbol":"HAPPSTMNDS","subject":"Interim Dividend - ...","exDate":"06-Nov-2026", ...}]
```

**Root cause B — the ex-date parser rejects NSE's date format.**
`backend/corporate_actions.py:66` does
`datetime.fromisoformat(str(ex)[:10])`, but NSE returns `06-Nov-2026`.
`fromisoformat` raises, the row is skipped, and `_has_excluded_action_within`
returns `False` even for a split on the current day. Reproduced directly:

```
rows = _normalise_action_rows({... "exDate": "06-Nov-2026" ...})
_has_excluded_action_within(rows, 30)  ->  False     # should be True
```

So even after fixing the URL, the gate would flip to `ok` and silently never
exclude anything.

**Why nothing caught it.** `gate_corporate_actions` fails closed by design
(`backend/scanner.py:276-289`), which is correct policy but has no operational
escape hatch: `--lenient-external-gates` only affects holdings and the liquidity
path (`scanner.py:183-228`, `240-273`). The coverage gate measures *priced* rows
(98%), not *reachable gates*. `scan.yml:134-147` validates that `stocks` is
non-empty but not that any stock passes. No alert exists for
`gate_pass_count == 0` or for a source being in `source_failed` for days.

**Cost of the outage.** On the latest scan (2026-11-05 18:14 UTC):
8 names fail *only* the corporate-actions gate and would pass without it
(highest score 68.7, one above the 63 cutoff); 12 names score ≥ 63 overall and
none is published.

**Fix.**
1. Add the query parameters and a robust date parser
   (`datetime.strptime(s, "%d-%b-%Y")`, with ISO as fallback).
2. Add a unit test using the real NSE shape (`exDate: "06-Nov-2026"`), not the
   invented ISO fixture currently in `tests/test_corporate_actions.py:6`.
3. Add `--allow-degraded-corporate-actions` (or make `--lenient-external-gates`
   cover it) so a source outage degrades rather than zeroes the list.
4. Add a root-level `gate_pass_count == 0` guard + alert (see #6).

### 2. CI has been dead for ~6 weeks

`.github/workflows/ci.yml:20`:

```yaml
      - name: Install backend deps
        working-directory: backend
         run: pip install -r requirements-dev.txt   # 9 spaces, should be 8
```

This is invalid YAML (`PyYAML: mapping values are not allowed here, line 20`).
GitHub rejects the workflow at parse time: the run has `jobs: []` and the
workflow is listed by its path instead of its name. Verified against the API:
last successful CI run **2026-09-15**; the typo was introduced by `45d1264`
(2026-10-27) changing `requirements.txt` → `requirements-dev.txt`.

**Consequence:** no `pytest`, no `check_cron_consistency.py`, no
`check_workflow_scripts.py`, no frontend build on any push or PR. Every claim in
AGENTS.md that "CI catches drift" has been false since then. This is also why the
corporate-actions regression and the broken scan schedule went unnoticed.

**Fix:** delete one space. Then add a guard that cannot be the broken file itself
(a tiny `actionlint`/`yamllint` step in a separate workflow, or a pre-commit hook).

### 3. The twice-daily schedule does not run at the advertised times

From 45 scheduled scan runs (GitHub API):

- Only **8/45** started within 1 h of a window; **37/45** started > 4 h late.
- Median drift **5.4 h**, max 10.0 h.
- The last four weekdays: `11:16`/`18:10`, `11:18`/`18:09`, `11:08`/`17:58`,
  `11:29`/`20:27` UTC.
- GitHub cron cannot fire *early*, so a scheduled run at 11:16 UTC is the
  **03:30** cron arriving 7.8 h late, not the 10:30 one.

**Product effect.** The "09:00 IST" scan completes ~16:46 IST (after the 15:30
close) and the "16:00 IST" scan ~23:40 IST. During the trading session the
dashboard is serving the previous close. The only same-day data before the close
comes from the **watchdog dispatch** at ~07:45 UTC (13:15 IST) — an accident, not
the design. The README still promises "09:00 & 16:00 IST" (`README.md:117`,
`README.md:225`).

**Fix.** Stop using GitHub `schedule` for intraday freshness: trigger via an
external scheduler (cron-job.org, healthchecks.io integration) calling
`workflow_dispatch`, or the existing Netlify function. Keep GH cron as a
fallback. If that is not acceptable, change the advertised cadence to "evening
only" and adjust the T+0/cohort math accordingly (see P1-9).

### 4. The watchdog's dedup is dead, and the watchdog barely runs

**Dedup dead.** `watchdog.yml:77` calls `gh run list` with no `GH_TOKEN`
(`GITHUB_TOKEN` is not automatically exported to `gh`). The production log says
so explicitly: *"To use GitHub CLI in a GitHub Actions workflow, set the
GH_TOKEN environment variable."* The `|| echo "none"` on line 83 swallows it, so
`run_state` is **always** `none`. Check #2 of the 1.3.3 duplicate-suppression
design never fires; only the 45-minute marker cooldown remains, and creation
latency is measured in hours. All 16 watchdog unit tests pass because they inject
`run_state="queued"` directly — nothing tests the wiring.

**Watchdog cadence.** The cron is `*/15 1-13 * * 1-5`, but the last 60 scheduled
runs show exactly **2 per weekday** (e.g. 07:44 and 15:50), not 52. A missed
evening scan is not detected until the next morning; a Friday failure waits for
Monday. The one thing keeping the morning data flowing is this twice-daily
accident.

**Also:** four of the eight documented secrets are **not set** (verified
`gh secret list`): `HEALTHCHECK_PING_URL_CANCELLED`, `HEALTHCHECK_WATCHDOG_URL`,
`NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`. So the watchdog heartbeat is skipped
entirely (which is why its own drift is invisible), the cancellation ping never
fires, and the Netlify deploy step is a no-op.

**Fix.** Add `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to the state step, make
`gh` failure visible, set the watchdog heartbeat URL, and move the heartbeat to
an external monitor.

---

## P1 — high: correctness, trust, and silent failure modes

### 5. Zero-share trade white-screens the dashboard (verified crash)

`frontend/src/utils/trades.js:110-111`:

```js
const pnlAbs = priced > 0 ? value - invested : null;          // 0 when shares = 0
const pnlPct = priced > 0 && invested > 0 ? ... : null;       // null when invested = 0
```

`MyTrades.jsx:24-35` guards on `summary.pnlAbs != null` (true: `0`), then does
`summary.pnlPct.toFixed(1)` (null) → `TypeError`. Reproduced in node.

Reachable two ways: the Shares input accepts `0` (`MyTrades.jsx:65-80`,
`min="0"`), and `TopPickCard.jsx:184-191` logs `shares: size?.shares ?? 0`
whenever the risk budget is below one share. Once stored in `localStorage`,
**every reload crashes** — and there is no error boundary anywhere in `src/`.

**Fix:** render `pnlPct == null ? "—" : ...`; add an error boundary; disable
"Take" with an explanation when `shares === 0`.

### 6. Monitoring reports green before anything is validated, committed, or deployed

`scan.yml:116-132` sends the healthchecks **success** ping immediately after the
scan step. Validation (`:134`), snapshot (`:149`), status (`:174`), commit
(`:238`), build (`:287`) and deploy (`:297`) all run **after** it. The only
`if: failure()` ping is at `:79`, before those steps, so it cannot see their
failures.

If the push-retry loop exhausts (`:261-271`) or validation fails, the workflow is
red but healthchecks has already been reset to green. This is the single most
important reason an 8-day zero-pick outage produced no alert.

**Fix:** move the success ping to the last step and add a final
`if: failure()` ping (or one `always()` status step keyed on `job.status`). Add a
`gate_pass_count > 0` assertion to the JSON-contract step, with an explicit
"degraded" allowlist for genuine zero-signal days.

### 7. The UI asserts an edge its own tracker refutes

- `App.jsx:562`: KPI delta `"score 63+ · only evidenced band"`.
- `App.jsx:811-812`: *"The only band with a measured edge vs the Nifty."*
- `utils/picks.js:1-8`: same claim, citing `docs/feedback/feedback-report.md`.

The committed `performance.json` for the 63+ band:

| Window | n | Median | Mean | 95% CI |
|---|---|---|---|---|
| T+5 | 1,025 | −0.47% | −0.26% | [−0.54, +0.02] |
| T+10 | 863 | −1.00% | −1.03% | [−1.47, −0.55] |
| T+20 | 454 | −1.32% | −0.96% | [−1.71, −0.25] |

The claim was true on 2026-09-08 with n=96 (+3.76% T+5, CI [+2.56, +4.95]) and
the 1.6.0 changelog says so explicitly. It has been false for weeks. The dynamic
components are honest — `ReceiptsBanner` requires `ci95.low > 0` and
`scoreBandChip` returns `null` — but the static prose still ships, and
`README.md:172` promises "no number is ever hardcoded".

**Fix:** gate the copy on the same `ci95.low > 0` check, or replace it with
"top band (rolling tracker; currently no established edge)". Also note the
`TOP_PICK_MIN_SCORE=63` default view is built on a 7-week-stale result.

### 8. The entry-state machine is inert by construction

`backend/technicals.py:148-150` sets `entry_high = current_price`, so every
stock's stored price is exactly the top of its own entry zone. Therefore
`computeEntryState` (`utils/scanPlan.js:78-90`) always returns `IN_ZONE`, and
`entryAction` always says **"In the buy zone — consider entering now"** — for
every pick, every scan. No other branch (`extended`, `below_zone`, `stopped`,
`at_t1`) can ever be reached from the shipped JSON. Likewise,
`delta.js:_entryTag` computes both snapshots' tags from their own self-consistent
plans, so watchlist transitions ("entered zone", "stop hit") can never fire.
`RecentPicksStrip` gets this right (prior plan + latest price) — the two
components disagree.

**Fix:** compute the entry state against the *prior* plan and the *latest* price
(as `RecentPicksStrip` does), or persist a live quote. Until then, remove the
action banner; a systematic "buy now" on every row contradicts the disclaimer.

### 9. The surveillance gate has never actually run

- `surveillance.py:36-41` probes `/api/surveillance/*` paths that do not exist.
- All 501 rows in production carry `surveillance_source_status: "flag_only"`.
- `gate_surveillance` (`scanner.py:231-234`) **passes** on `flag_only`, despite
  the docs calling all seven gates fail-closed.
- The `flag_only` failure is cached for **7 days** (`surveillance.py:188`), so a
  transient outage disables the gate for a week even if NSE recovers.
- Latent false-positive: candidate #4 is
  `/api/equity-stockIndices?index=SECURITIES_IN_FOCUS` (`surveillance.py:40`).
  Stocks "in focus" are not restricted. If it ever succeeds, `_extract_nse_restricted`
  will mark all of them `t_group: True` and exclude them.

**Fix:** remove the bogus candidates, use a real ASM/GSM list source, do not
cache `flag_only` for 7 days, and either fail closed or label the gate as
"unavailable" in the UI instead of rendering a green tick.

### 10. `approx_5y_avg_pe` runs for all 501 stocks, contrary to its own comment and docs

`scanner.py:496-499` says *"Defer the expensive 6-year history/info fetch until
after all safety gates pass"* but calls it unconditionally. `AGENTS.md:47` claims
"gate-passed names only". Evidence: 430/501 **failed** rows have `avg_pe_5y`.
This adds one more yfinance request per stock per scan — directly against the
project's number-one failure mode (429 throttling) — and the value is only used
in the soft score, which is now irrelevant when nothing passes.

**Fix:** move it inside `if result["gate_pass"]:`, or accept that valuation is
computed for everyone and correct the docs.

### 11. The Netlify deploy step is a success-reporting no-op

`scan.yml:297-308` exits 0 with a warning when the two Netlify secrets are unset —
and they are unset. So every run reports the deploy step green while doing
nothing. The site is served only by Netlify's GitHub integration, with no
post-deploy verification. This is the same class of gap as the Klinote incident
documented in AGENTS.md: if the integration breaks, scans stay green and the site
freezes silently. When it is enabled, `npx netlify deploy --dir=frontend/dist`
does not explicitly ship `netlify/functions`, so the admin trigger may be absent.

**Fix:** choose one deploy path, set the secrets, fail loudly when missing, and
finish with a `curl` assertion on `<title>` + `generated_at` freshness.

### 12. Page weight: ~8 MB uncached per visit, 250 MB per deploy

`App.jsx:279-283` loads `latest_scan.json` (1.71 MB) and `performance.json`
(6.19 MB) in a `Promise.all`, both with `cache: "no-store"`, and blocks first
paint on the slowest. `performance.json` is 70% `per_name` rows used only by the
collapsed "track record" panel and the drawer.

`frontend/public/data/snapshots` is **134 MB** (129 files) and Vite copies it into
`dist/`, so each deploy uploads ~250 MB. The frontend only ever fetches
`history_index.json` plus one prior snapshot (for the strips), so the other 128
snapshots are published purely to be ignored.

**Fix:** render on `latest_scan.json` alone; lazy-load performance on `<details>`
open; use `cache: "no-cache"` (revalidate) instead of `no-store`; move snapshots
out of `public/` (they are server-side inputs for the outcome tracker); minify
`latest_scan.json` (it is written with `indent=2`, `scanner.py:1050`).

### 13. Data-quality / methodology biases

- **52-week high is a partial-window high.** `technicals.py:109` uses
  `rolling(252, min_periods=100)` while the minimum history is 210 bars
  (`:81`). A stock with 100–250 bars gets a "52W high" from its available window,
  so a recently listed name can pass the drawdown gate on an artificially small
  drawdown. The high is also computed from **closes**, not intraday highs, which
  systematically understates the drawdown.
- **A 30% partial window is enough to satisfy a gate.** `swing_high_63d`
  (`technicals.py:189-190`) uses `min_periods=21` for a 63-session window.
- **Piotroski is applied to financials.** 98/501 rows are Financial Services;
  their mean F-score is 4.22 vs 5.4–6.2 elsewhere, and only 1% score 9 (vs 9% in
  Healthcare). Current ratio, leverage and gross margin are not meaningful for
  banks/NBFCs/insurers, so the hard F-score gate excludes them for accounting
  structure, not quality. Either exclude financials, use a sector-specific
  quality test, or document the bias.
- **Missing sub-scores are renormalised** (`scanner.py:515-523`): a stock with
  only `quality_composite` available can score 100. The UI warns, but ranking
  across different component counts is not meaningful.

### 14. The outcome tracker's T+0 is wrong for a pre-open scan

`performance.py:413-437` snaps T+0 to the first session **on or after** the
snapshot date. A correctly-timed 03:30 UTC scan is pre-open: its prices are the
*previous* close, but T+0 becomes *today's* close, silently discarding day-one
and shifting every cohort by one session. This is currently masked because the
scan runs at ~11:16 UTC (post-close). Fix the schedule and this becomes live.

Also: both daily runs now land after the close ~7 h apart, so they mostly
describe the same session (54/63 same-day AM/PM pairs have identical pass counts;
9 are identical down to the score). `compute_performance` treats them as
independent cohorts, roughly doubling N (5,796 rows over 129 snapshots) and
overstating precision in the digest/CIs. Dedupe to one cohort per trading date.

### 15. Drift attribution is wrong every morning

`scan_schedule.most_recent_window` picks the *nearest wall-clock* window
(`scan_schedule.py:64-71`). The 11:16 UTC run (actually the delayed 03:30 cron) is
attributed to **10:30** with `drift_minutes: 49` — verified in the committed
status for 2026-11-05. Operators and the dashboard therefore see "49 min late"
when the truth is 7.7 h. The evening run correctly shows 464 min. Use
`github.event.schedule` (already available) as the authoritative window.

### 16. `git add A B C || true` is all-or-nothing

`outcome-tracker.yml:89` stages three paths in one call. Git validates every
pathspec before staging; if any is missing, nothing is staged, `git diff --staged
--quiet` exits 0, and the job prints "No changes" and succeeds — silently losing
the `performance.json` commit. `scan.yml:247-249` does this correctly with
separate calls. Fix by splitting the `git add`s.

---

## P2 — medium and polish

**Frontend**
- Header mixes browser-local date with IST time (`App.jsx:576`): verified
  `"03 Nov · 09:00 am IST"` for a 04 Nov scan when the browser is in New York.
- Drawer effect deps are `[onClose]`, and `onClose` is an inline arrow
  (`App.jsx:839,868`), so the effect re-runs on every parent render, re-focusing
  the close button and thrashing `body.overflow` (`DetailDrawer.jsx:110-122`).
  No focus trap, no focus restore.
- Table `<th>` sort is mouse-only (`App.jsx:880-895`); the watch-star inside a
  `role="button"` row swallows Space/Enter (`App.jsx:899-933` vs `:399-404`).
- `data.stocks` is never validated (`App.jsx:332,355`): `{}` or `stocks:null`
  throws "not iterable"; the `_placeholder` branch at `:493` is dead code.
- 501 cards re-render on every keystroke — no `React.memo`, inline callbacks.
- `SubscoreBars` renders 6 of 7 components; `conviction_holding` (10% of the
  score) is never shown, while the "Scored on n/7" counter counts it.
- CSV export writes `gate_results` as `[object Object]` (`App.jsx:181,186-197`);
  no formula-injection escaping; `Rationale.jsx` overstates coverage.
- Cooldown clock is frozen (`Date.now()` during render, no interval,
  `App.jsx:406-415`).
- Light theme `--text-faint` is 2.43:1 on `#fafaf7` (`styles.css:1731`);
  `outline: none` on two primary focus targets; several `title=`-only
  explanations unreachable by touch/AT.
- Missing/undefined classes: `.perf-grid`, `.selected`, `.skeleton-card`,
  `.ticker-header`, `.score-ring`, `.donut`; `.visually-hidden` and the legacy
  CSS variable block are dead.
- No frontend tests at all, despite `picks.js`, `trades.js`, `sizing.js`,
  `delta.js`, `recentPicks.js`, `scanPlan.js` being written as pure,
  unit-testable modules that duplicate backend business rules.

**Backend**
- `bhavcopy.py:231-234` contains dead placeholder code
  (`_yfinance_fetch_one.cache_info()` behind `if False`) and an unused
  `as_of_dates`; the proxy's `as_of` is `date.today()` (`:240`) even though the
  data is the previous close.
- `fscore.py:68-77` `_safe_get` checks the row label but not the column; a
  fiscal-year mismatch across statements raises `KeyError` and turns a stock
  into a worker-exception row. Add `col in df.columns`.
- `holdings.py:186` sleeps only on success; when Screener blocks the runner it is
  hammered at full thread speed.
- `run_scan` docstring says "defaults to 100" while the default is 500
  (`scanner.py:620`); `--lenient-external-gates` help still says it covers
  delivery (`scanner.py:1078-1081`).
- `gate_holdings` requires `> 50%` while docs say `≥ 50%` (`scanner.py:271`).
- `requirements.txt` is entirely `>=` with no upper bounds or hashes; production
  (Python 3.11) and the local venv (3.14, pandas 3.0.5, yfinance 1.5.1) already
  differ. Pin/lock, and run CI on the same version the scan uses.
- `npm install --no-save netlify-cli@latest` executes arbitrary current code with
  the deploy token in scope.
- All actions use mutable major tags, not SHAs.
- `snapshot_writer` truncates rather than rebuilds a corrupt `history_index.json`
  (`snapshot_writer.py:157-165`).
- `generate_digest.py` exits 2 ("nothing digestable", a normal early state),
  which fails the weekly job and skips the performance commit.
- `actions/cache` is keyed by `run_id`, so every run saves a fresh ~8 MB cache and
  never exact-hits.
- Watchlist/heartbeat/cancellation/Netlify secrets missing (see P0-4).
- `cancelled()` ping cannot fire for a *queued* run that never starts; the
  `if: cancelled()` step never executes in that scenario.

**Docs / drift**
- `AGENTS.md:47` "approx_5y_avg_pe() gate-passed names only" — false.
- `AGENTS.md:205` "npm run build # typecheck + bundle" — there is no typechecker.
- `AGENTS.md:170` says CHANGELOG latest is 1.5.0; it is 1.6.0. File-layout block
  is mangled.
- `README.md:94` and `docs/methodology.md:91` say all gates fail closed;
  surveillance `flag_only` passes.
- `SECURITY.md:13` says "no authentication"; there is an owner-only bearer-token
  endpoint.
- Two methodology sources (`docs/methodology.md`, `frontend/public/methodology.html`)
  are maintained by hand and have already diverged.
- `scan_status.commit_sha` records the trigger SHA, not the data commit.
- AGENTS/README document a 15-minute watchdog and eight secrets; neither matches
  reality.

---

## What is genuinely well done

- **Failure-safe output.** `write_scan_output` refuses to replace last-good below
  85% coverage and writes atomically (`mkstemp` + `fsync` + `os.replace`,
  `scanner.py:1042-1057`). A half-blind scan cannot corrupt the published JSON.
- **Time handling.** Everything is UTC; no DST/IST assumptions; weekend and
  next-window math is correct and unit-tested (`scan_schedule.py`).
- **Concurrency.** `concurrency: group: nse-swing-scan, cancel-in-progress: false`
  genuinely serialises scans; the rebase-retry with `-X theirs` is correct for
  this repo's generated artifacts (tested on diverged and shallow clones).
- **Statistical honesty where it counts.** Per-scan cohorts (never pooled),
  median/IQR/N, deterministic bootstrap CIs, untrackable counted separately, and
  `ReceiptsBanner`/`scoreBandChip` correctly self-suppress when the CI does not
  support the claim.
- **The weekly digest is honest.** It publishes negative numbers and caveats, and
  the feedback report labels a near-zero IC instead of spinning it.
- **Contract discipline.** 60 fields verified across 501 rows; zero
  missing/renamed keys; `gate_pass` agrees with `gate_results` on every row; the
  client's relative-strength mirror matches the backend on all 490 non-null rows.
- **Security basics.** No `dangerouslySetInnerHTML`/`eval`; React escapes all
  external strings; no secrets in the client bundle; least-privilege tokens; no
  untrusted-input interpolation in `run:` blocks.
- **Tests.** 209 tests in 2.3 s, fast enough to actually run; the cache-wrapper
  regression tests and the workflow-path guards are exactly the right idea.

---

## Suggested order of work

**Today (restore the product)**
1. Fix `ci.yml:20` (one space) and confirm a green run.
2. Fix the corporate-actions URL + date parser, add the real-format test, and
   decide the degraded-mode policy. Re-run a scan; expect ~8 picks restored.
3. Move the healthchecks success ping after validation/deploy; add a
   `gate_pass_count == 0` alert.
4. Add `GH_TOKEN` to the watchdog state step; set the watchdog heartbeat secret.

**This week (trust and cadence)**
5. Decide the schedule: external trigger for intraday, or re-document as an
   evening-only product. Fix `scheduled_window_utc` attribution at the same time.
6. Fix the zero-share crash + add an error boundary.
7. Gate the "measured edge" copy on the tracker CI, or remove it.
8. Fix the entry-state computation (prior plan + fresh price) or remove the
   action banner.

**Next (quality and cost)**
9. Surveillance: real source or explicit "unavailable" status; stop caching
   `flag_only` for 7 days.
10. Lazy-load `performance.json`, move snapshots out of `public/`, minify
    `latest_scan.json`, allow revalidation.
11. Pin dependencies (lockfile), pin actions by SHA, pin `netlify-cli`.
12. Add Vitest coverage for the six pure frontend modules; add the missing
    backend tests (CA date format, 52W partial window, T+0 mapping).
13. Fix the `git add` bug, digest exit-2 handling, snapshot-index rebuild, and
    the remaining a11y items.

---

## Appendix — how the main claims were verified

| Claim | Evidence |
|---|---|
| 0 picks for 16 scans | `gate_pass_count: 0` in every snapshot 2026-10-27 → 2026-11-05 on `origin/main` |
| CA endpoint needs params | live curl: 200 `Missing index` without, JSON rows with `index/from_date/to_date` |
| CA date bug | `_has_excluded_action_within` returns `False` for `exDate: "06-Nov-2026"`; `fromisoformat` raises |
| CI dead | PyYAML error; GitHub API run has `jobs: []`; last successful CI 2026-09-15 |
| Scan drift | 45 scheduled runs: median 5.4 h, 37/45 > 4 h; GH cron cannot fire early |
| Watchdog `run_state` | `watchdog.yml:77` has no `GH_TOKEN`; `|| echo none` |
| Watchdog 2×/day | 60 scheduled runs = 2 per weekday |
| Secrets | `gh secret list` shows 4 of the 8 documented |
| Zero-share crash | reproduced in node: `{pnlAbs:0, pnlPct:null}` → `TypeError` |
| Edge claim false | `performance.json` 63+ CIs: T+5 [−0.54,+0.02], T+20 [−1.71,−0.25] |
| Entry state inert | `entry_high = current_price`; every row returns `in_zone` |
| AM/PM double count | same pass count / same prices hours apart; 9/63 pairs byte-identical in symbol+scores |
| Page weight | 1.71 MB + 6.19 MB; `dist` 250 MB; snapshots 134 MB |
