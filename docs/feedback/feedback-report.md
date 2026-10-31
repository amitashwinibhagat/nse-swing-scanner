# Feedback loop report

_Generated 2026-10-31 from 5596 closed rows (of 5796). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.002 | [-0.031, 0.037] | 3468 | yes |
| drawdown_sweetspot | -0.015 | [-0.043, 0.012] | 5596 | yes |
| oversold_positioning | 0.004 | [-0.023, 0.029] | 5596 | yes |
| quality_composite | 0.014 | [-0.01, 0.039] | 5596 | yes |
| support_proximity | -0.01 | [-0.04, 0.017] | 5596 | yes |
| valuation_compression | 0.005 | [-0.025, 0.034] | 5065 | yes |
| volume_capitulation | 0.058 | [0.03, 0.083] | 5596 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.113 | [0.08, 0.147] | 2614 | yes |
| drawdown_sweetspot | -0.004 | [-0.033, 0.025] | 4742 | yes |
| oversold_positioning | -0.017 | [-0.045, 0.013] | 4742 | yes |
| quality_composite | 0.022 | [-0.004, 0.052] | 4742 | yes |
| support_proximity | -0.011 | [-0.041, 0.022] | 4742 | yes |
| valuation_compression | 0.055 | [0.026, 0.085] | 4320 | yes |
| volume_capitulation | 0.072 | [0.041, 0.098] | 4742 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.057 | [0.038, 0.091] | 1035 | yes |
| drawdown_sweetspot | -0.05 | [-0.087, -0.015] | 3126 | yes |
| oversold_positioning | 0.0 | [-0.033, 0.033] | 3126 | yes |
| quality_composite | 0.077 | [0.042, 0.115] | 3126 | yes |
| support_proximity | -0.028 | [-0.064, 0.007] | 3126 | yes |
| valuation_compression | 0.017 | [-0.02, 0.056] | 2865 | yes |
| volume_capitulation | 0.08 | [0.043, 0.114] | 3126 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | -0.63 (744) | -0.26 (4852) |
| T+10 | -0.97 (688) | -0.99 (4054) |
| T+20 | -1.05 (435) | -0.7 (2691) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.26pp
- Top-band lift vs baseline at T+10: ic_proportional: +0.33pp
- Top-band lift vs baseline at T+20: ic_proportional: +0.27pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
