# Methodology

How the NSE Swing Scanner decides what to show you.

## Overview

The scanner runs a pipeline:

1. **Universe** — the Nifty 500 list from `nsearchives.nseindia.com`.
2. **Per-stock price/volume** — yfinance `Ticker.history(period="1y")`.
3. **Per-stock fundamentals** — yfinance financials + balance sheet.
4. **Per-stock external sources** — NSE bhavcopy (delivery), Screener.in
   (holdings), NSE corporate-actions (where available), NSE/BSE surveillance
   (T-group / GSM / suspension).
5. **Shared market context** — Nifty 50 vs its 200EMA (relative-strength
   factor).
6. **Hard gates** — explicit pass/fail criteria. Fail-closed.
7. **Soft score** — weighted 0–100 from degree-of-match criteria. Used to
   rank stocks that pass the hard gates.
8. **Output** — JSON contract at `frontend/public/data/latest_scan.json`.
9. **Frontend** — Vite-built React dashboard on Netlify.

## Hard gates

Every hard gate returns `passed: bool, reason: str`. The stock passes only if
all gates pass.

| Gate | Criterion | Source | Defaults |
|---|---|---|---|
| `gate_f_score` | Piotroski F-Score ≥ MIN_F_SCORE | yfinance | MIN_F_SCORE=6 |
| `gate_drawdown` | -40% ≤ pct off 52W high ≤ -15% | yfinance | -40, -15 |
| `gate_rsi` | 25 ≤ RSI(14) ≤ 40 | yfinance | 25, 40 |
| `gate_delivery_value` | latest-day delivery value ≥ ₹5cr | NSE bhavcopy | 5_00_00_000 INR |
| `gate_surveillance` | not in T-group / GSM / suspension | NSE → BSE → flag-only | — |
| `gate_holdings` | promoter + FII + DII > 50% | Screener.in | 50% |
| `gate_corporate_actions` | no excluded action in next 30 days | NSE corporate actions | 30 days |

If any external source returns `source_failed`, the corresponding gate
fails-closed — the row gets `gate_pass: false` and the source status is
visible in the JSON and the UI.

## Soft score

Sum of weighted sub-scores in [0, 1], each in [0, 1].

| Sub-score | Source | Weight |
|---|---|---|
| `valuation_compression` | trailingPE vs 5Y avg PE | 0.20 |
| `oversold_positioning` | RSI(14) | 0.15 |
| `support_proximity` | pct from 200EMA | 0.15 |
| `drawdown_sweetspot` | pct off 52W high | 0.10 |
| `volume_capitulation` | peak down-day volume / 30d avg | 0.10 |
| `quality_composite` | F-Score | 0.20 |
| `conviction_holding` | promoter+FII+DII | 0.10 |

Missing inputs are excluded from the denominator (not silently zeroed).

`base_score = 100 * sum(weight_i * sub_i) / sum(weight_i over non-NaN)`

## Relative-strength factor

A multiplier in [0.7, 1.05] applied to `base_score`:

- Stock ≥ 5pp worse than index from 200EMA → penalty (0.85x or 0.7x)
- Index correcting and stock tracking it → small bonus (1.05x)
- Otherwise → neutral (1.0x)

`swing_score = base_score * relative_strength_factor`

## ATR-based targets

The frontend shows `entry_zone_low` and `entry_zone_high` (current price
minus 0.5×ATR(14)), `stop_loss` (entry midpoint minus 1.0×ATR(14)),
`target_1` (entry midpoint plus 1.5×ATR(14)), and `target_2` (entry midpoint
plus 2.5×ATR(14)). Risk-reward ratios are computed against the stop.

These are **heuristic**, not backtested. They replace the original
Fibonacci 61.8% targets which were oversized for a 15–30 day window.

## Source-status policy

Every external fetch returns a `source_status`:

- `ok` — source returned usable data
- `missing` — source is reachable, no record for this symbol/date
- `source_failed` — source was unreachable / returned an error
- `fallback_used` — primary source failed, secondary source returned data
- `flag_only` — could not confirm; scanner must flag, not auto-pass
- `not_applicable` — source does not apply for this symbol

Hard gates fail-closed on `source_failed` for delivery, holdings, and
corporate actions. Surveillance `flag_only` does not fail the gate (we
don't know, so we don't claim the stock is restricted); the source status
is visible in the JSON/UI.

## Cache policy

| Source | TTL | Reason |
|---|---|---|
| Shareholding (Screener) | 90 days | Changes quarterly |
| Bhavcopy rollup | 12 hours | Daily, but rarely changes within a day |
| Surveillance list | 7 days | Weekly cadence |
| Corporate actions | 12 hours | Daily refresh |

The CI workflow restores `backend/cache/` between runs so cache-warm fetches
are fast on subsequent scans.

## What this is not

- Not investment advice.
- Not SEBI-registered research.
- Not a backtested strategy — the score weights and gate thresholds are
  hand-tuned starting points, not optimized.
- Not a real-time system — the scan runs twice daily at NSE market open and
  close (IST 09:00 and 16:00).
