# Feedback loop report

_Generated 2026-10-03 from 2950 closed rows (of 3790). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.052 | [-0.099, -0.007] | 891 | yes |
| drawdown_sweetspot | -0.078 | [-0.111, -0.039] | 2950 | yes |
| oversold_positioning | 0.0 | [-0.037, 0.04] | 2950 | yes |
| quality_composite | 0.055 | [0.016, 0.09] | 2950 | yes |
| support_proximity | 0.059 | [0.02, 0.099] | 2950 | yes |
| valuation_compression | -0.038 | [-0.078, 0.003] | 2679 | yes |
| volume_capitulation | 0.069 | [0.031, 0.103] | 2950 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.124 | [-0.172, -0.076] | 777 | yes |
| drawdown_sweetspot | -0.078 | [-0.114, -0.037] | 2580 | yes |
| oversold_positioning | -0.061 | [-0.099, -0.017] | 2580 | yes |
| quality_composite | 0.089 | [0.049, 0.123] | 2580 | yes |
| support_proximity | 0.067 | [0.024, 0.105] | 2580 | yes |
| valuation_compression | -0.086 | [-0.131, -0.04] | 2347 | yes |
| volume_capitulation | 0.156 | [0.122, 0.194] | 2580 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.08 | [-0.098, 0.211] | 310 | yes |
| drawdown_sweetspot | -0.08 | [-0.14, -0.028] | 1290 | yes |
| oversold_positioning | -0.026 | [-0.075, 0.028] | 1290 | yes |
| quality_composite | 0.115 | [0.062, 0.179] | 1290 | yes |
| support_proximity | 0.184 | [0.13, 0.24] | 1290 | yes |
| valuation_compression | -0.303 | [-0.359, -0.25] | 1194 | yes |
| volume_capitulation | 0.121 | [0.064, 0.177] | 1290 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | 0.49 (438) | 0.64 (2512) |
| T+10 | 1.29 (318) | 0.78 (2262) |
| T+20 | 1.82 (163) | 1.77 (1127) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.53pp
- Top-band lift vs baseline at T+10: ic_proportional: +1.37pp
- Top-band lift vs baseline at T+20: ic_proportional: +0.89pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
