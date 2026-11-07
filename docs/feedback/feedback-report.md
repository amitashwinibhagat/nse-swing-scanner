# Feedback loop report

_Generated 2026-11-07 from 2880 closed rows (of 2894). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.009 | [-0.041, 0.053] | 1829 | yes |
| drawdown_sweetspot | -0.006 | [-0.042, 0.031] | 2880 | yes |
| oversold_positioning | 0.001 | [-0.034, 0.034] | 2880 | yes |
| quality_composite | 0.012 | [-0.03, 0.048] | 2880 | yes |
| valuation_compression | -0.002 | [-0.048, 0.04] | 2603 | yes |
| volume_capitulation | 0.063 | [0.024, 0.096] | 2880 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.085 | [0.039, 0.124] | 1729 | yes |
| drawdown_sweetspot | 0.006 | [-0.033, 0.045] | 2780 | yes |
| oversold_positioning | -0.012 | [-0.054, 0.021] | 2780 | yes |
| quality_composite | 0.037 | [-0.004, 0.077] | 2780 | yes |
| valuation_compression | 0.034 | [-0.007, 0.077] | 2516 | yes |
| volume_capitulation | 0.09 | [0.051, 0.13] | 2780 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.071 | [0.009, 0.129] | 957 | yes |
| drawdown_sweetspot | 0.018 | [-0.032, 0.062] | 2008 | yes |
| oversold_positioning | 0.005 | [-0.034, 0.048] | 2008 | yes |
| quality_composite | 0.055 | [0.005, 0.103] | 2008 | yes |
| valuation_compression | 0.041 | [-0.005, 0.086] | 1831 | yes |
| volume_capitulation | 0.048 | [-0.006, 0.09] | 2008 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | -0.8 (380) | -0.26 (2500) |
| T+10 | -1.2 (364) | -1.25 (2416) |
| T+20 | -1.64 (249) | -2.0 (1759) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.85pp
- Top-band lift vs baseline at T+10: ic_proportional: +1.40pp
- Top-band lift vs baseline at T+20: ic_proportional: +2.19pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
