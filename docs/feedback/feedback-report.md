# Feedback loop report

_Generated 2026-10-24 from 4896 closed rows (of 5784). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.073 | [0.037, 0.111] | 2631 | yes |
| drawdown_sweetspot | -0.034 | [-0.066, -0.005] | 4896 | yes |
| oversold_positioning | 0.016 | [-0.012, 0.048] | 4896 | yes |
| quality_composite | 0.004 | [-0.026, 0.03] | 4896 | yes |
| support_proximity | 0.016 | [-0.012, 0.044] | 4896 | yes |
| valuation_compression | 0.015 | [-0.022, 0.051] | 4459 | yes |
| volume_capitulation | 0.024 | [-0.001, 0.05] | 4896 | yes |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | 0.126 | [0.088, 0.158] | 1907 | yes |
| drawdown_sweetspot | -0.027 | [-0.057, 0.001] | 4172 | yes |
| oversold_positioning | -0.016 | [-0.048, 0.012] | 4172 | yes |
| quality_composite | 0.047 | [0.014, 0.081] | 4172 | yes |
| support_proximity | 0.029 | [-0.005, 0.056] | 4172 | yes |
| valuation_compression | 0.031 | [-0.001, 0.062] | 3802 | yes |
| volume_capitulation | 0.064 | [0.032, 0.091] | 4172 | yes |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | None | — | 828 | no |
| drawdown_sweetspot | -0.069 | [-0.101, -0.031] | 2706 | yes |
| oversold_positioning | 0.018 | [-0.019, 0.056] | 2706 | yes |
| quality_composite | 0.075 | [0.039, 0.113] | 2706 | yes |
| support_proximity | 0.051 | [0.007, 0.093] | 2706 | yes |
| valuation_compression | -0.078 | [-0.126, -0.035] | 2474 | yes |
| volume_capitulation | 0.095 | [0.058, 0.129] | 2706 | yes |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | -0.48 (712) | -0.08 (4184) |
| T+10 | 0.01 (554) | -0.31 (3618) |
| T+20 | -0.61 (407) | 0.5 (2299) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: -0.20pp
- Top-band lift vs baseline at T+10: ic_proportional: -0.18pp
- Top-band lift vs baseline at T+20: ic_proportional: +0.58pp

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
