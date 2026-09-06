# Feedback loop report

_Generated 2026-09-06 from 1064 closed rows (of 1454). IN-SAMPLE — read with the promotion checklist, not instead of it._

## Sub-score rank IC — T+5

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | None | — | 0 | no |
| drawdown_sweetspot | None | — | 0 | no |
| oversold_positioning | None | — | 0 | no |
| quality_composite | None | — | 0 | no |
| support_proximity | None | — | 0 | no |
| valuation_compression | None | — | 0 | no |
| volume_capitulation | None | — | 0 | no |

## Sub-score rank IC — T+10

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | None | — | 0 | no |
| drawdown_sweetspot | None | — | 0 | no |
| oversold_positioning | None | — | 0 | no |
| quality_composite | None | — | 0 | no |
| support_proximity | None | — | 0 | no |
| valuation_compression | None | — | 0 | no |
| volume_capitulation | None | — | 0 | no |

## Sub-score rank IC — T+20

| Sub-score | IC | 95% CI | n | usable |
|---|---|---|---|---|
| conviction_holding | None | — | 0 | no |
| drawdown_sweetspot | None | — | 0 | no |
| oversold_positioning | None | — | 0 | no |
| quality_composite | None | — | 0 | no |
| support_proximity | None | — | 0 | no |
| valuation_compression | None | — | 0 | no |
| volume_capitulation | None | — | 0 | no |

## Confirmation A/B

| Window | Confirmed mean (n) | Anticipatory mean (n) |
|---|---|---|
| T+5 | 1.0 (148) | 0.63 (916) |
| T+10 | 1.6 (113) | 0.97 (721) |
| T+20 | 1.43 (89) | 1.85 (335) |

## Shadow re-scoring (in-sample)

- Top-band lift vs baseline at T+5: ic_proportional: n/a
- Top-band lift vs baseline at T+10: ic_proportional: n/a
- Top-band lift vs baseline at T+20: ic_proportional: n/a

Full band tables live in `feedback-latest.json` (`shadow.windows`).

## Promotion checklist

- [ ] Out-of-sample: the candidate weights beat baseline on the tracker's top-band mean excess for 4 consecutive weekly runs (not just this in-sample report).
- [ ] The candidate's top-band (63+) T+5 mean CI sits above the baseline's, with n >= 20 in both.
- [ ] No band's hit rate regresses by more than 5 points without a documented trade-off rationale.
- [ ] The weight change is a single commit touching only backend/settings.py WEIGHTS + CHANGELOG.md, so the tracker can attribute the regime change to score_version.
