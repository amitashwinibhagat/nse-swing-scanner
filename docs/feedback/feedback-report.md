# Feedback loop report

_Generated 2026-11-28 from 2654 closed rows (of 2779). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.005 | [-0.04, 0.053] | 1882 | yes |
| drawdown_sweetspot | -0.014 | [-0.056, 0.027] | 2654 | yes |
| oversold_positioning | -0.018 | [-0.054, 0.018] | 2654 | yes |
| quality_composite | 0.025 | [-0.01, 0.064] | 2654 | yes |
| valuation_compression | 0.023 | [-0.028, 0.061] | 2379 | yes |
| volume_capitulation | 0.029 | [-0.009, 0.069] | 2654 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.072 | [0.029, 0.116] | 1814 | yes |
| drawdown_sweetspot | 0.002 | [-0.041, 0.04] | 2586 | yes |
| oversold_positioning | -0.021 | [-0.062, 0.017] | 2586 | yes |
| quality_composite | 0.046 | [0.007, 0.086] | 2586 | yes |
| valuation_compression | 0.071 | [0.033, 0.114] | 2319 | yes |
| volume_capitulation | 0.062 | [0.017, 0.1] | 2586 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.027 | [-0.016, 0.077] | 1760 | yes |
| drawdown_sweetspot | 0.01 | [-0.026, 0.05] | 2532 | yes |
| oversold_positioning | 0.003 | [-0.043, 0.049] | 2532 | yes |
| quality_composite | 0.043 | [0.002, 0.081] | 2532 | yes |
| valuation_compression | 0.06 | [0.023, 0.105] | 2271 | yes |
| volume_capitulation | 0.026 | [-0.012, 0.062] | 2532 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | -1.0 (367) | -0.4 (2287) |
| T+10 | -1.59 (359) | -1.6 (2227) |
| T+20 | -3.35 (348) | -3.94 (2184) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.06pp
- Top-band lift vs baseline at T+10: ic_proportional: -0.45pp
- Top-band lift vs baseline at T+20: ic_proportional: -1.46pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
