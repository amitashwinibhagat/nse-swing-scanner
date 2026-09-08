# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary customer: the retail Indian swing trader.** Someone with a modest
  trading account who wants a small, trustworthy shortlist of NSE candidates
  and the entry, stop, size and reasoning to act on them — without doing the
  screening or trusting a black box. Uses the dashboard on phone and desktop,
  twice a day.
- **Operator (DataDab LLP).** Runs the scanner, watches scan health and source
  status, and tunes scoring weights through the weekly feedback report.

## Product Purpose

A zero-cost, serverless NSE swing screener that evaluates the Nifty 500 against
seven fail-closed hard gates and a transparent soft score, then publishes the
result as static JSON that a static React dashboard reads. It exists to make a
disciplined, honest shortlist cheap to produce and easy to act on. Success means
the customer can decide in minutes, and the system's own history shows whether
its calls worked.

## Positioning

Not another screener. Its mechanism is **hard gates that fail closed + a soft
score + a public outcome tracker that scores the system's own past picks**.
Bands that do not work are demoted and labeled (e.g. the 55–60 band is shown as
negative at T+5), not hidden. A neighboring screener could copy the gates; it
could not truthfully copy a self-auditing track record.

## Operating Context

- GitHub Actions runs the scan twice daily and commits `latest_scan.json`,
  `scan_status.json`, dated snapshots and `performance.json`.
- Netlify serves a static React frontend (no auth, no database, no live API).
- A watchdog plus healthchecks.io monitor cron drift; GitHub Actions scheduling
  is best-effort and has been observed hours late or dropped.
- Data sources: yfinance (price, volume, ADV, F-Score, P/E), Screener.in
  (shareholding), NSE bhavcopy and NSE corporate filings (best-effort). The
  bhavcopy path falls back to a yfinance traded-value proxy when NSE is blocked.
- The customer checks the dashboard on phone and desktop; the operator reads
  workflow logs and the weekly feedback report.

## Capabilities and Constraints

- Nifty 500 universe; seven hard gates; 0–100 soft score; ATR-based entry zone,
  stop and two targets.
- Free data and free hosting are product constraints, not preferences: no paid
  feeds, no always-on server, no per-user cost.
- Every external fetch returns a source-status envelope; gates fail closed when
  a required source is unavailable.
- The scanner refuses to publish below 85% price coverage; a half-blind scan
  keeps the last good JSON.
- ~90-day snapshot retention drives the outcome tracker and feedback loop.
- Explicitly not investment advice and not SEBI-registered research. Any
  candidate must be cross-checked against authoritative sources before acting.
- **Open decision:** audience scale and distribution are not committed. The URL
  is public; whether the product is personal, a small invited set, or a public
  launch is undecided.

## Brand Commitments

- Name: **NSE Swing Scanner**.
- Byline: an experimental product of DataDab LLP.
- Voice: sober, transparent, non-promotional. Never overclaim. No emojis in
  code or docs unless explicitly requested.
- Every performance claim must trace to `performance.json`; numbers are mirrored
  from the tracker, never hardcoded.

## Evidence on Hand

- `frontend/public/data/performance.json` — forward-return tracker, 69
  snapshots / n=1454, per-band and per-regime cohorts with bootstrap CIs.
- `docs/feedback/feedback-report.md` — sub-score ICs, confirmation A/B, shadow
  re-scoring (report-only).
- `frontend/public/data/snapshots/` + `history_index.json` — dated scan history
  (90-day window).
- **Absences that must not be fabricated:** no testimonials, no named customers,
  no benchmark or revenue claims, no AUM, no win-rate beyond what the tracker
  reports.

## Product Principles

1. **Fail closed.** An unreachable source fails a gate rather than silently
   passing it.
2. **Publish the receipts.** The tracker scores past calls; weak bands are
   demoted and labeled, not buried.
3. **Never overclaim.** Status and evidence are descriptive, not predictive.
4. **Zero marginal cost.** Free data and free hosting are non-negotiable.
5. **The customer's decision is the product.** Show the action — what to do,
   where, how much, what's at risk — not raw data.
