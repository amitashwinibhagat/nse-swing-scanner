# Feedback loop report

_Generated 2026-10-10 from 3634 closed rows (of 4570). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.003 | [-0.043, 0.048] | 1250 | yes |
| drawdown_sweetspot | -0.053 | [-0.08, -0.017] | 3634 | yes |
| oversold_positioning | 0.001 | [-0.031, 0.03] | 3634 | yes |
| quality_composite | 0.051 | [0.014, 0.084] | 3634 | yes |
| support_proximity | 0.058 | [0.027, 0.093] | 3634 | yes |
| valuation_compression | -0.014 | [-0.047, 0.022] | 3309 | yes |
| volume_capitulation | 0.051 | [0.021, 0.081] | 3634 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.118 | [-0.167, -0.071] | 891 | yes |
| drawdown_sweetspot | -0.071 | [-0.105, -0.031] | 2950 | yes |
| oversold_positioning | -0.055 | [-0.09, -0.017] | 2950 | yes |
| quality_composite | 0.101 | [0.062, 0.131] | 2950 | yes |
| support_proximity | 0.071 | [0.032, 0.107] | 2950 | yes |
| valuation_compression | -0.054 | [-0.094, -0.012] | 2679 | yes |
| volume_capitulation | 0.125 | [0.091, 0.159] | 2950 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.051 | [-0.073, 0.148] | 490 | yes |
| drawdown_sweetspot | -0.075 | [-0.117, -0.027] | 1805 | yes |
| oversold_positioning | -0.016 | [-0.057, 0.027] | 1805 | yes |
| quality_composite | 0.109 | [0.06, 0.15] | 1805 | yes |
| support_proximity | 0.144 | [0.095, 0.194] | 1805 | yes |
| valuation_compression | -0.196 | [-0.244, -0.149] | 1656 | yes |
| volume_capitulation | 0.126 | [0.075, 0.173] | 1805 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | 0.29 (496) | 0.38 (3138) |
| T+10 | 0.54 (438) | 0.62 (2512) |
| T+20 | 1.59 (236) | 1.17 (1569) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.76pp
- Top-band lift vs baseline at T+10: ic_proportional: +2.07pp
- Top-band lift vs baseline at T+20: ic_proportional: +2.07pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
