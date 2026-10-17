# Feedback loop report

_Generated 2026-10-17 from 4498 closed rows (of 5166). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.021 | [-0.024, 0.059] | 2114 | yes |
| drawdown_sweetspot | -0.053 | [-0.082, -0.023] | 4498 | yes |
| oversold_positioning | -0.003 | [-0.036, 0.025] | 4498 | yes |
| quality_composite | 0.032 | [0.004, 0.06] | 4498 | yes |
| support_proximity | 0.033 | [0.001, 0.063] | 4498 | yes |
| valuation_compression | -0.016 | [-0.044, 0.014] | 4083 | yes |
| volume_capitulation | 0.022 | [-0.009, 0.052] | 4498 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.029 | [-0.095, 0.028] | 1208 | yes |
| drawdown_sweetspot | -0.068 | [-0.1, -0.031] | 3576 | yes |
| oversold_positioning | -0.036 | [-0.074, -0.002] | 3576 | yes |
| quality_composite | 0.08 | [0.046, 0.112] | 3576 | yes |
| support_proximity | 0.058 | [0.024, 0.088] | 3576 | yes |
| valuation_compression | -0.026 | [-0.061, 0.013] | 3257 | yes |
| volume_capitulation | 0.103 | [0.075, 0.131] | 3576 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.029 | [-0.068, 0.114] | 759 | yes |
| drawdown_sweetspot | -0.069 | [-0.112, -0.027] | 2540 | yes |
| oversold_positioning | 0.006 | [-0.03, 0.046] | 2540 | yes |
| quality_composite | 0.083 | [0.051, 0.121] | 2540 | yes |
| support_proximity | 0.077 | [0.037, 0.117] | 2540 | yes |
| valuation_compression | -0.125 | [-0.172, -0.083] | 2314 | yes |
| volume_capitulation | 0.119 | [0.084, 0.157] | 2540 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | 0.15 (583) | 0.21 (3915) |
| T+10 | 0.39 (492) | 0.3 (3084) |
| T+20 | 0.92 (306) | 0.65 (2234) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.37pp
- Top-band lift vs baseline at T+10: ic_proportional: +1.38pp
- Top-band lift vs baseline at T+20: ic_proportional: +1.43pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
