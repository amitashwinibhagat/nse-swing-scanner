# Analytics — north-star metric and decision log

Last updated: 2026-09-06 (1.5.1).

The dashboard ships **no third-party analytics**. This document survives
because the metric definition is the durable part: it is what we would
measure with, and the standard any future measurement must clear.

## North-star metric (defined, not yet measured)

> **Weekly engaged sessions — visitors who open at least one stock drawer
> in a rolling 7-day window.**

Why this and not raw traffic:

- Raw visits measure curiosity, not utility. The drawer is the deepest
  interaction the product offers: it means someone inspected a specific
  candidate's gates, plan, and evidence — the behavior of a trader using
  the tool, not a passerby scrolling.
- It is the leading indicator for the two downstream outcomes the
  product cares about: repeat visits (retention) and the credibility
  distribution loop (people who found a candidate here and act on it).
- It is robust to the two traffic spikes that would otherwise flatter
  the numbers (a Reddit/finTwit link posting drives one-page-visit
  crowds that do *not* move this metric).

Supporting metrics (secondary, watch but don't optimize blindly):

| Metric | Definition | What it validates |
|---|---|---|
| Return rate | Visitors active in ≥2 distinct weeks / weekly engaged sessions | Stickiness of the scanner loop |
| CSV export rate | CSV exports / engaged sessions | Depth: users taking data into their own workflow |
| Per-symbol lookup rate | Per-symbol accuracy lookups / engaged sessions | Whether the receipts feature is discovered and valued |
| Drawer-open depth | Drawer opens / weekly engaged sessions | Intensity of per-visit usage |

Explicitly non-metrics: page views, unique visitors, session length.

## Decision log

- **2026-09-06 (1.4.3):** Fathom Analytics integrated — cookieless,
  fail-silent, four fixed-name events, CSP scoped to its one origin.
- **2026-09-06 (1.5.1):** Removed by owner decision ("not needed, skip
  it"). All code, env-var plumbing, and the CSP origin reverted; zero
  analytics requests since. The event wiring points (drawer open,
  per-symbol lookup, CSV export, digest click) were exercised and are
  documented here — re-adding any privacy-first provider is a
  single-file loader plus these four hooks.

If measurement ever justifies re-introduction, the standard is in this
file: cookieless, no fingerprinting, unconfigured builds untracked by
construction, CSP scoped to exactly one origin, event names fixed
strings (no user content), and this document updated in the same commit.
