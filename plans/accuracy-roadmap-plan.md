# Accuracy Roadmap — Plan & Sequencing

> Goal: maximise prediction accuracy while staying honest about sample size.
> Written 2026-07-18. The single biggest insight: **the tool doesn't
> make predictions yet** — it ranks. Accuracy must be *defined and measured*
> before it can be improved. C1/C2 (just shipped) starts the measurement.

## The moat

No free Indian screener publishes its own track record. Chartink, Screener,
Trendlyne screen but never answer "do your signals work?" with live numbers.
Our snapshot + outcome infra already does. The compounding asset is the
**proprietary labelled dataset** of Indian swing setups — every snapshot is
a labelled row once T+20 closes.

## Two kinds of work

**A. Data plumbing that must start today.** Every day without it is a lost
observation. Confirmation flags, exit-warning features, regime tags, and
per-name outcome rows only become measurable if snapshots carry them from
the next scan. This is the entire point of the 1.3.0 release.

**B. Analysis that unlocks in 3-6 months.** Calibration curves, regime-
conditional hit rates, confirmation A/B. Cannot be drawn before cohorts
exist. Build the *plumbing* now; build the *analysis* then.

## 1.3.0 — what ships today (plumbing)

| Lever | What | Where |
|---|---|---|
| Confirmation overlay (A/B flag) | `confirmation_state` ∈ {confirmed, anticipatory} from RSI 3d delta + last-close uptick; raw features also persisted | technicals.py → scanner.py → JSON → chip |
| Exit-side warning #1 | `swing_high_63d`; flag when entry_high < swing_high_63d < target_1 (T1 capped by resistance) | technicals.py → drawer warning |
| Exit-side warning #2 | `atr_expansion_ratio` (now vs 20 sessions ago); flag when > 1.3 | technicals.py → drawer warning |
| Regime tagging | Tag each per-name outcome row risk_on/neutral/risk_off from snapshot's market_index_pct_from_ema200 | performance.py |
| Per-name outcome rows | performance.json gains `per_name` list (snapshot, symbol, score, bucket, regime, confirmation, windows) — calibration raw material | performance.py |
| Regime-split table | PerformanceSection renders windows × regime hit-rate table; honest "insufficient data" cell when N < 5 | PerformanceSection.jsx |

**Critical:** bump `compute_technicals` cache key `v2 → v3` so the new
fields land on the next scan instead of being masked by 12h cache (same
lesson as the 1.2.1 earnings fix).

## Deferred (3-6 months out)

- **Calibration layer** (score → P(excess > 0 | bucket, regime)): isotonic
  or logistic on accumulated per-name rows. Ships as "X% beat Nifty (N=Y)"
  copy wherever a score appears.
- **Confirmation A/B verdict**: split PASS cohorts by confirmation_state,
  publish hit-rate delta. Keep or kill the overlay based on evidence.
- **Exit-warning A/B**: do T1-capped / ATR-expanding names underperform?
  If yes, promote warnings to score penalties.

## Hard exclusions (accuracy traps)

- No ML / XGBoost — guaranteed overfit at this N, breaks transparency.
- No auto-tuning of score weights on in-sample cohorts.
- No new hard gates until existing ones are validated.
- No intraday data — breaks architecture, irrelevant to swing horizon.

## Statistical guardrails (non-negotiable)

- Every accuracy claim ships with N attached.
- Per-scan cohorts, never pooled (overlapping T+20 windows autocorrelate).
- Median + IQR, never mean-only.
- Regime-tagged (a 90-day window is ~one regime).
- Below N=5 per cell: render "insufficient data", not a number.
