# Feedback loop report

_Generated 2026-09-26 from 2674 closed rows (of 3046). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.054 | [-0.103, -0.007] | 801 | yes |
| drawdown_sweetspot | -0.074 | [-0.111, -0.032] | 2674 | yes |
| oversold_positioning | 0.001 | [-0.038, 0.037] | 2674 | yes |
| quality_composite | 0.044 | [0.002, 0.083] | 2674 | yes |
| support_proximity | 0.047 | [0.004, 0.091] | 2674 | yes |
| valuation_compression | -0.052 | [-0.09, -0.007] | 2433 | yes |
| volume_capitulation | 0.073 | [0.035, 0.109] | 2674 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.137 | [-0.194, -0.071] | 524 | yes |
| drawdown_sweetspot | -0.05 | [-0.095, -0.001] | 1909 | yes |
| oversold_positioning | -0.077 | [-0.121, -0.037] | 1909 | yes |
| quality_composite | 0.084 | [0.043, 0.131] | 1909 | yes |
| support_proximity | 0.05 | [-0.007, 0.103] | 1909 | yes |
| valuation_compression | -0.121 | [-0.163, -0.071] | 1749 | yes |
| volume_capitulation | 0.177 | [0.136, 0.221] | 1909 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.099 | [-0.09, 0.256] | 230 | yes |
| drawdown_sweetspot | -0.087 | [-0.159, -0.027] | 1037 | yes |
| oversold_positioning | -0.011 | [-0.068, 0.044] | 1037 | yes |
| quality_composite | 0.114 | [0.05, 0.177] | 1037 | yes |
| support_proximity | 0.234 | [0.183, 0.293] | 1037 | yes |
| valuation_compression | -0.38 | [-0.431, -0.323] | 960 | yes |
| volume_capitulation | 0.092 | [0.025, 0.154] | 1037 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | 0.69 (358) | 0.68 (2316) |
| T+10 | 1.59 (238) | 0.88 (1671) |
| T+20 | 1.54 (146) | 1.85 (891) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.15pp
- Top-band lift vs baseline at T+10: ic_proportional: +1.01pp
- Top-band lift vs baseline at T+20: ic_proportional: +0.11pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
