# Changelog

## 1.0.0 — Public launch

Initial public release. Closes the free-data feature gaps documented in
earlier `backend/README.md`.

### Added

- True delivery value from NSE daily bhavcopy (`bhavcopy.py`).
- T-group / GSM / suspension hard gate with NSE → BSE fallback (`surveillance.py`).
- Promoter / FII / DII conviction hard gate via Screener.in (`holdings.py`).
- Pending corporate actions hard gate (NSE corporate actions).
- ATR(14)-based entry zone / stop-loss / targets (`technicals.py`).
- Relative-strength vs Nifty 50 soft factor (`scanner.py`).
- Source-status envelope (`source_status.py`) — every external fetch reports
  one of `ok`, `missing`, `source_failed`, `fallback_used`, `flag_only`,
  `not_applicable`. Hard gates fail-closed on `source_failed`.
- On-disk JSON cache with per-source TTLs (`cache.py`).
- pytest suite covering RSI/ATR math, named gate functions, bhavcopy parser,
  holdings parser, source-status envelope, and the JSON output contract.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) for backend
  pytest + smoke scan + frontend build.
- Scheduled-scan concurrency, dependency caching, and JSON contract
  validation step (`.github/workflows/scan.yml`).
- Netlify security headers (CSP, X-Frame-Options, Referrer-Policy) and a
  longer cache for `/data/*` (`netlify.toml`).
- Frontend: new columns (delivery, holdings, ATR, T1, Stop), source-status
  badges, CSV export, stale-data warning, keyboard accessibility,
  meta/OG/favicon metadata, a richer expanded detail panel.
- `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, `docs/methodology.md`.

### Changed

- `scanner.py` gate logic refactored into named functions (one per criterion).
- Operator-precedence bug on the original `tech.get("error") or …` line fixed.
- ATR(14) replaces ad-hoc ATR for the entry/target/stop output.
- F-Score threshold made configurable (`settings.py`), default unchanged at
  `>=6`; spec `>7` is documented as stricter and tunable.
- Universe is fetched once; surveillance / bhavcopy / nifty50 / per-symbol
  holdings and corporate actions are fetched once and shared across the
  scan.
- README and `backend/README.md` rewritten to reflect the new gates and to
  move the unresolved items (earnings surprise, backtested weights) into
  an explicit Limitations section.

### Deferred (Phase 2)

- **Earnings surprise** — no negative surprise in last 2 quarters. Requires
  consensus-estimate data, which is not available from a clean free source
  for Indian mid-caps. Defer until a paid source or community-shared estimate
  feed is wired in.
- **Backtested weight calibration** — the soft-score weights and F-Score
  threshold are hand-tuned starting points, not optimized. A separate
  backtesting harness against historical NSE data is needed before treating
  the score as a strategy signal.
- **Real-time / intraday scanning** — out of scope; current cadence is
  twice daily at IST 09:00 and 16:00.
