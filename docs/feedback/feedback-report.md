# Feedback loop report

_Generated 2026-09-19 from 1855 closed rows (of 2674). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.075 | [-0.129, -0.021] | 500 | yes |
| drawdown_sweetspot | -0.049 | [-0.099, -0.008] | 1855 | yes |
| oversold_positioning | -0.01 | [-0.052, 0.035] | 1855 | yes |
| quality_composite | 0.025 | [-0.026, 0.071] | 1855 | yes |
| support_proximity | 0.015 | [-0.04, 0.068] | 1855 | yes |
| valuation_compression | -0.065 | [-0.113, -0.012] | 1701 | yes |
| volume_capitulation | 0.086 | [0.039, 0.128] | 1855 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.158 | [-0.226, -0.097] | 318 | yes |
| drawdown_sweetspot | -0.075 | [-0.136, -0.022] | 1324 | yes |
| oversold_positioning | -0.086 | [-0.14, -0.039] | 1324 | yes |
| quality_composite | 0.072 | [0.014, 0.134] | 1324 | yes |
| support_proximity | 0.095 | [0.037, 0.157] | 1324 | yes |
| valuation_compression | -0.233 | [-0.286, -0.179] | 1224 | yes |
| volume_capitulation | 0.185 | [0.129, 0.234] | 1324 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.098 | [-0.111, 0.266] | 180 | yes |
| drawdown_sweetspot | -0.118 | [-0.183, -0.044] | 762 | yes |
| oversold_positioning | 0.013 | [-0.066, 0.078] | 762 | yes |
| quality_composite | 0.145 | [0.068, 0.209] | 762 | yes |
| support_proximity | 0.25 | [0.183, 0.316] | 762 | yes |
| valuation_compression | -0.4 | [-0.467, -0.33] | 698 | yes |
| volume_capitulation | 0.051 | [-0.027, 0.122] | 762 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | 0.75 (236) | 0.55 (1619) |
| T+10 | 1.73 (177) | 0.99 (1147) |
| T+20 | 1.65 (111) | 1.81 (651) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.25pp
- Top-band lift vs baseline at T+10: ic_proportional: +1.13pp
- Top-band lift vs baseline at T+20: ic_proportional: -0.49pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
