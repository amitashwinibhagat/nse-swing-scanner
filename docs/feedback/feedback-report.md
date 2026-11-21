# Feedback loop report

_Generated 2026-11-21 from 2738 closed rows (of 2809). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | -0.001 | [-0.051, 0.048] | 1850 | yes |
| drawdown_sweetspot | -0.004 | [-0.041, 0.035] | 2738 | yes |
| oversold_positioning | -0.013 | [-0.056, 0.023] | 2738 | yes |
| quality_composite | 0.019 | [-0.018, 0.057] | 2738 | yes |
| valuation_compression | 0.01 | [-0.03, 0.058] | 2465 | yes |
| volume_capitulation | 0.039 | [-0.004, 0.078] | 2738 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.079 | [0.033, 0.118] | 1787 | yes |
| drawdown_sweetspot | 0.004 | [-0.035, 0.048] | 2675 | yes |
| oversold_positioning | -0.017 | [-0.057, 0.018] | 2675 | yes |
| quality_composite | 0.039 | [-0.001, 0.078] | 2675 | yes |
| valuation_compression | 0.052 | [0.007, 0.091] | 2409 | yes |
| volume_capitulation | 0.073 | [0.03, 0.111] | 2675 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.033 | [-0.028, 0.077] | 1579 | yes |
| drawdown_sweetspot | 0.012 | [-0.03, 0.054] | 2467 | yes |
| oversold_positioning | 0.008 | [-0.035, 0.043] | 2467 | yes |
| quality_composite | 0.029 | [-0.016, 0.066] | 2467 | yes |
| valuation_compression | 0.066 | [0.025, 0.106] | 2227 | yes |
| volume_capitulation | 0.026 | [-0.015, 0.068] | 2467 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | -0.9 (381) | -0.36 (2357) |
| T+10 | -1.4 (368) | -1.44 (2307) |
| T+20 | -2.83 (350) | -3.51 (2117) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.55pp
- Top-band lift vs baseline at T+10: ic_proportional: +0.43pp
- Top-band lift vs baseline at T+20: ic_proportional: +0.20pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
