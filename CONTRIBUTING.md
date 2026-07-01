# Contributing

Thanks for your interest in improving the NSE Swing Scanner.

## What this project is

A twice-daily Nifty 500 swing-trade screener. The hard gates (F-Score,
delivery value, holdings conviction, T-group, RSI, drawdown) intentionally
fail-closed: if a source is unreachable, the scanner reports the failure
rather than passing the gate.

## What this project is NOT

- Not investment advice, not SEBI-registered research.
- Not a real-time or intraday scanner.
- Not a trading platform or order-routing system.
- Not a substitute for verifying candidate stocks against Screener.in, NSE
  filings, or a SEBI-registered advisor.

## Development setup

```bash
# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pytest -q

# Frontend
cd ../frontend
npm install
npm run build
```

## Running a small scan locally

```bash
cd backend
.venv/bin/python scanner.py --sample 5 --sleep 0 \
  --skip-holdings --skip-corporate-actions \
  --output /tmp/scan.json
```

`--skip-holdings` and `--skip-corporate-actions` make the smoke test fast and
network-light. The full scan runs twice daily via GitHub Actions.

## Coding conventions

- Python: standard library typing hints where useful. No new third-party
  dependencies without justification — keep the dependency surface small.
- React: function components, no class components, no global state managers.
  Keep `App.jsx` readable; extract a component if it grows.
- All new external sources should use the `source_status` envelope and
  fail-closed.

## Pull request process

1. Open an issue first for non-trivial changes.
2. Fork the repo and open a PR against `main`.
3. CI must pass: backend pytest, smoke scan, and frontend build.
4. Don't change the gate semantics without updating `docs/methodology.md` and
   the README's Limitations section.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License (see `LICENSE`).
