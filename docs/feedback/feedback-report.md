# Feedback loop report

_Generated 2026-11-14 from 2799 closed rows (of 2862). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.008 | [-0.038, 0.054] | 1812 | yes |
| drawdown_sweetspot | -0.013 | [-0.05, 0.023] | 2799 | yes |
| oversold_positioning | 0.002 | [-0.033, 0.038] | 2799 | yes |
| quality_composite | 0.01 | [-0.028, 0.045] | 2799 | yes |
| valuation_compression | 0.003 | [-0.037, 0.038] | 2523 | yes |
| volume_capitulation | 0.059 | [0.025, 0.095] | 2799 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.08 | [0.034, 0.123] | 1812 | yes |
| drawdown_sweetspot | 0.001 | [-0.033, 0.036] | 2799 | yes |
| oversold_positioning | -0.016 | [-0.053, 0.019] | 2799 | yes |
| quality_composite | 0.037 | [-0.001, 0.07] | 2799 | yes |
| valuation_compression | 0.04 | [0.003, 0.081] | 2523 | yes |
| volume_capitulation | 0.085 | [0.048, 0.122] | 2799 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.067 | [0.015, 0.117] | 1239 | yes |
| drawdown_sweetspot | 0.027 | [-0.023, 0.061] | 2226 | yes |
| oversold_positioning | 0.015 | [-0.026, 0.054] | 2226 | yes |
| quality_composite | 0.028 | [-0.012, 0.067] | 2226 | yes |
| valuation_compression | 0.058 | [0.013, 0.103] | 2022 | yes |
| volume_capitulation | 0.032 | [-0.014, 0.07] | 2226 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | -0.83 (374) | -0.28 (2425) |
| T+10 | -1.37 (374) | -1.34 (2425) |
| T+20 | -2.4 (313) | -2.83 (1913) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: +0.86pp
- Top-band lift vs baseline at T+10: ic_proportional: +1.24pp
- Top-band lift vs baseline at T+20: ic_proportional: +1.94pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
