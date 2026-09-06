# Analytics — north-star metric and instrumentation

Last updated: 2026-09-06 (1.4.3).

The dashboard runs **Fathom Analytics**, a privacy-first, cookieless,
GDPR-friendly provider. This document is the contract for why we measure,
what we measure, and what we deliberately refuse to measure.

## Provider and privacy commitments

- **No cookies, no consent banner needed.** Fathom collects no personal
  data and stores no identifiers on visitor devices.
- **No fingerprinting, no cross-site tracking, no data sales.**
- **IP addresses are truncated** (anonymized) before storage; visitor
  identification is a one-way daily salted hash, never reversible.
- **CSP-scoped to one origin.** `netlify.toml` allows exactly one
  third-party script origin (`cdn.usefathom.com`). If Fathom is ever
  removed, that origin comes out of the CSP the same commit.
- **Unconfigured builds are untracked by construction.** The loader
  (`frontend/src/utils/analytics.js`) no-ops unless `VITE_FATHOM_SITE_ID`
  was set at build time — local dev and forks make zero analytics
  requests.

## North-star metric

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
| CSV export rate | `csv_export` events / engaged sessions | Depth: users taking data into their own workflow |
| Per-symbol lookup rate | `per_symbol_lookup` events / engaged sessions | Whether the receipts feature is discovered and valued |
| Drawer-open depth | `drawer_open` events / weekly engaged sessions | Intensity of per-visit usage |

Explicitly non-metrics: page views, unique visitors, session length.
They can be viewed in Fathom for sanity but are not targets.

## Instrumentation map

Events are snake_case, defined once in `frontend/src/utils/analytics.js`
(`EVENTS`), and fired fail-silent. Current map:

| Event | Fires when | Answers |
|---|---|---|
| `drawer_open` | A stock card or table row is expanded into the detail drawer | North-star numerator; the core "used the tool" signal |
| `per_symbol_lookup` | A symbol is selected in the per-symbol accuracy lookup | Are the receipts (per-pick track records) being used? |
| `csv_export` | The current view is exported as CSV | Are users integrating scanner output into their own workflow? |
| `digest_open` | The weekly digest link in the performance section is clicked | Does the public accuracy digest drive return visits? |

**North-star proxy in Fathom:** the `drawer_open` event count, divided by
Fathom's weekly visitors, gives weekly engaged sessions; the "returning
visitors over 7 days" view gives the return rate. Fathom does not
compute "weekly engaged" natively — read `drawer_open` per week as the
operational proxy and treat a week as good when `drawer_open / visitor`
trends up.

Adding a new event: add the name to `EVENTS` in `analytics.js`, fire it
fail-silent at the interaction point, and add a row to this table in the
same commit. Never fire events with user-entered content (symbols,
search text) in the name — event names are fixed strings only, so
per-symbol popularity stays out of the analytics by design.

## What we deliberately do NOT instrument

- Search input contents, watchlist contents, or any locally-stored state
  — those stay client-side, period.
- Individual identity, sessions, or any attempt at cross-visit tracking
  beyond Fathom's anonymous daily aggregates.
- Error/exception tracking — the scanner's public artifacts (source
  status, coverage gates) already surface system health honestly, and
  adding a third-party error reporter would widen the CSP for marginal
  value.
