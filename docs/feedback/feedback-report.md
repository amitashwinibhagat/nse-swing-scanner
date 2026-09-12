# Feedback loop report

_Generated 2026-09-12 from 1418 closed rows (of 2049). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.079 | [-0.139, -0.019] | 362 | yes |
| drawdown_sweetspot | -0.041 | [-0.098, 0.01] | 1418 | yes |
| oversold_positioning | -0.019 | [-0.069, 0.033] | 1418 | yes |
| quality_composite | 0.036 | [-0.022, 0.095] | 1418 | yes |
| support_proximity | 0.063 | [0.002, 0.123] | 1418 | yes |
| valuation_compression | -0.124 | [-0.175, -0.065] | 1306 | yes |
| volume_capitulation | 0.089 | [0.033, 0.143] | 1418 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.178 | [-0.245, -0.098] | 235 | yes |
| drawdown_sweetspot | -0.086 | [-0.157, -0.026] | 1051 | yes |
| oversold_positioning | -0.037 | [-0.095, 0.024] | 1051 | yes |
| quality_composite | 0.091 | [0.022, 0.161] | 1051 | yes |
| support_proximity | 0.149 | [0.087, 0.212] | 1051 | yes |
| valuation_compression | -0.281 | [-0.338, -0.217] | 973 | yes |
| volume_capitulation | 0.135 | [0.073, 0.2] | 1051 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.101 | [-0.152, 0.29] | 144 | yes |
| drawdown_sweetspot | -0.017 | [-0.096, 0.062] | 572 | yes |
| oversold_positioning | -0.017 | [-0.109, 0.071] | 572 | yes |
| quality_composite | 0.164 | [0.082, 0.232] | 572 | yes |
| support_proximity | 0.229 | [0.149, 0.299] | 572 | yes |
| valuation_compression | -0.366 | [-0.45, -0.283] | 522 | yes |
| volume_capitulation | -0.051 | [-0.135, 0.03] | 572 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | 1.03 (191) | 0.77 (1227) |
| T+10 | 1.7 (147) | 1.08 (904) |
| T+20 | 1.1 (101) | 2.09 (471) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.13pp
- Top-band lift vs baseline at T+10: ic_proportional: +0.98pp
- Top-band lift vs baseline at T+20: ic_proportional: -1.28pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
