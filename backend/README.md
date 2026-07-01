# NSE Swing Scanner — Backend

Pipeline that scans the Nifty 500 universe using **100% free data sources**
(NSE public archives, BSE, Screener.in, yfinance) and outputs a ranked
swing-trade candidate list.

> **Not investment advice. Not SEBI-registered research.** See the project
> README for the full Limitations section.

## Files

- `universe.py` — fetches the Nifty 500 constituents from NSE's free CSV
  archive. Has a NiftyIndices.com fallback.
- `technicals.py` — RSI(14), 200EMA, 52W-high drawdown, volume surge,
  ATR(14), ATR-based entry/stop/target, and the shared Nifty 50 200EMA
  context for the relative-strength factor. All yfinance.
- `fscore.py` — self-computed Piotroski F-Score (0-9) and a coarse 5Y
  average P/E reconstruction. Includes the ADR EPS-currency-mismatch
  cross-check.
- `nse_client.py` — shared HTTP session with browser-like headers and
  cookie priming for NSE endpoints.
- `surveillance.py` — T-group / GSM / suspension list. Probes NSE JSON
  endpoints, falls back to BSE, falls back to `flag_only` if both fail.
- `bhavcopy.py` — latest-day delivery volume from NSE bhavcopy.
- `holdings.py` — Promoter / FII / DII percentages from Screener.in.
  Cache-first (90-day TTL); per-stock polite delay.
- `corporate_actions.py` — pending corporate actions from NSE.
- `source_status.py` — shared `source_status` envelope (ok, missing,
  source_failed, fallback_used, flag_only, not_applicable).
- `cache.py` — on-disk JSON cache with TTLs.
- `settings.py` — every tunable threshold in one place.
- `scanner.py` — orchestrator. Per-stock evaluation, named hard-gate
  functions, soft 0–100 score, relative-strength factor, JSON contract
  writer.
- `tests/` — pytest suite for math, gates, parsers, source-status, and
  the JSON output contract.

## How to run

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Full scan (~20-35 min on a warm cache)
.venv/bin/python scanner.py

# Smoke scan (5 stocks, skip slow sources)
.venv/bin/python scanner.py --sample 5 --sleep 0 \
  --skip-holdings --skip-corporate-actions \
  --output /tmp/scan.json
```

## CLI flags

- `--sample N` — limit universe to first N stocks (omit for full 500).
- `--sleep SECS` — yfinance call delay (rate-limit courtesy). Default 0.3.
- `--output PATH` — output JSON path. Default
  `../frontend/public/data/latest_scan.json`.
- `--skip-holdings` — skip the Screener scrape. Drops the holdings hard
  gate and `conviction_holding` sub-score.
- `--skip-corporate-actions` — skip the NSE corp-actions probe. Drops
  the corporate-actions hard gate.

## Hard gates (all fail-closed)

See `docs/methodology.md` for the full table. In short:

- F-Score ≥ 6 (configurable in `settings.py`; spec is >7)
- Drawdown in [-40%, -15%]
- RSI in [25, 40]
- Delivery value ≥ ₹5cr (from NSE bhavcopy)
- Not in T-group / GSM / suspension (NSE → BSE → flag-only)
- Promoter + FII + DII > 50% (Screener consolidated → standalone)
- No excluded corporate action in next 30 days

If any of these sources is `source_failed`, the corresponding gate fails.

## Source-status policy

Every external fetch reports a `status` from the `source_status` envelope.
The scanner uses this to decide whether to:

- Apply the gate normally (`ok` / `fallback_used` / `not_applicable`).
- Flag rather than enforce (`flag_only` — used for surveillance when both
  NSE and BSE probes fail).
- Fail the gate (`source_failed` / `missing`).

The dashboard renders source status per row so users can see which gates
were verified vs. which were skipped.

## Tests

```bash
.venv/bin/pytest -q
```

The suite covers RSI/ATR math, named gate functions, bhavcopy parser,
holdings parser, source-status envelope, and the JSON output contract.
Total: 45 tests. Live network calls are not in the default test path —
they are exercised by the GitHub Actions scan workflow.

## Limitations (carried over from Phase 1)

- **ADR EPS-currency bug** (documented in `fscore.py` docstring): for
  Indian names that are also US-ADR-listed (INFY, WIPRO, IBN, HDB, RDY,
  etc.), yfinance sometimes returns EPS in USD while the `.NS` price is
  in INR, corrupting P/E by ~70-90x. The 3x cross-check catches gross
  mismatches. Affected rows show a blank P/E — that's the system
  working, not a bug.
- **Earnings surprise (last 2Q)** is intentionally not a hard gate.
  Consensus-estimate data is not available from a clean free source for
  Indian mid-caps. Deferred to Phase 2.
- **Soft-score weights and the F-Score threshold are hand-tuned**, not
  backtested. A backtesting harness is needed before treating the score
  as a strategy edge.
- **Free data sources are fragile.** NSE archive paths and Screener
  page structures can change without notice. The scanner reports
  `source_failed` / `flag_only` rather than crashing, and the
  corresponding hard gates fail-closed.
